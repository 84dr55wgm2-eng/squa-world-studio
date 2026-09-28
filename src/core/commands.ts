/**
 * Commandes de haut niveau : chacune construit une Transaction (données pures)
 * à partir de l'état courant. L'interface, les raccourcis et plus tard l'IA
 * passent tous par ces fonctions puis par `commit` (history.ts).
 *
 * Aucune de ces fonctions ne modifie le document.
 */
import { DEFAULT_OBJECT_NAMES, createObject, uniqueName, type CreateObjectOptions } from './factory.ts';
import { createId } from './ids.ts';
import type { Operation, Transaction } from './operations.ts';
import { groundedY, type Box } from './bounds.ts';
import { getObject, getSubtreeIds, indexInParent } from './scene.ts';
import type {
  AssetRecord,
  ModelProps,
  ObjectChanges,
  ObjectId,
  SceneDocument,
  SceneObject,
  SceneObjectType,
  SceneSettings,
  Transform,
  Vec3,
} from './types.ts';

export function addObjectTx(
  doc: SceneDocument,
  type: SceneObjectType,
  opts: CreateObjectOptions & { parentId?: ObjectId | null } = {},
): { tx: Transaction; id: ObjectId } {
  const obj = createObject(type, { ...opts, name: uniqueName(doc, opts.name ?? DEFAULT_OBJECT_NAMES[type]) });
  return {
    id: obj.id,
    tx: { label: `Ajouter ${obj.name}`, ops: [{ type: 'insert', objects: [obj], parentId: opts.parentId ?? null, index: -1 }] },
  };
}

export function deleteObjectTx(doc: SceneDocument, id: ObjectId): Transaction {
  const obj = getObject(doc, id);
  return { label: `Supprimer ${obj.name}`, ops: [{ type: 'delete', id }] };
}

const DUPLICATE_OFFSET: Vec3 = [1, 0, 0];

/**
 * Duplique un objet et tout son sous-arbre (nouveaux identifiants, relations parent/enfants
 * recâblées). La copie est placée juste après l'original, décalée de 1 m en X,
 * et n'est jamais verrouillée (pour pouvoir la déplacer immédiatement).
 */
export function duplicateObjectTx(doc: SceneDocument, id: ObjectId): { tx: Transaction; id: ObjectId } {
  const source = getObject(doc, id);
  const subtree = getSubtreeIds(doc, id);
  const idMap = new Map<ObjectId, ObjectId>(subtree.map((oldId) => [oldId, createId()]));

  const copies: SceneObject[] = subtree.map((oldId) => {
    const original = structuredClone(doc.objects[oldId]);
    return {
      ...original,
      id: idMap.get(oldId)!,
      parentId: original.parentId && idMap.has(original.parentId) ? idMap.get(original.parentId)! : original.parentId,
      children: original.children.map((c) => idMap.get(c)!),
    };
  });

  const root = copies[0];
  root.name = uniqueName(doc, source.name);
  root.locked = false;
  const p = root.transform.position;
  root.transform.position = [p[0] + DUPLICATE_OFFSET[0], p[1] + DUPLICATE_OFFSET[1], p[2] + DUPLICATE_OFFSET[2]];

  return {
    id: root.id,
    tx: {
      label: `Dupliquer ${source.name}`,
      ops: [{ type: 'insert', objects: copies, parentId: source.parentId, index: indexInParent(doc, id) + 1 }],
    },
  };
}

export function updateObjectTx(doc: SceneDocument, id: ObjectId, changes: ObjectChanges, label?: string): Transaction {
  const obj = getObject(doc, id);
  return { label: label ?? `Modifier ${obj.name}`, ops: [{ type: 'update', id, changes }] };
}

export function renameObjectTx(doc: SceneDocument, id: ObjectId, name: string): Transaction {
  const obj = getObject(doc, id);
  const trimmed = name.trim();
  if (!trimmed || trimmed === obj.name) return { label: 'Renommer', ops: [] };
  return { label: `Renommer ${obj.name} → ${trimmed}`, ops: [{ type: 'update', id, changes: { name: trimmed } }] };
}

export function setVisibleTx(doc: SceneDocument, id: ObjectId, visible: boolean): Transaction {
  const obj = getObject(doc, id);
  if (obj.visible === visible) return { label: '', ops: [] };
  return { label: `${visible ? 'Afficher' : 'Masquer'} ${obj.name}`, ops: [{ type: 'update', id, changes: { visible } }] };
}

export function setLockedTx(doc: SceneDocument, id: ObjectId, locked: boolean): Transaction {
  const obj = getObject(doc, id);
  if (obj.locked === locked) return { label: '', ops: [] };
  return { label: `${locked ? 'Verrouiller' : 'Déverrouiller'} ${obj.name}`, ops: [{ type: 'update', id, changes: { locked } }] };
}

const EPSILON = 1e-6;
const sameVec = (a: Vec3, b: Vec3) => a.every((v, i) => Math.abs(v - b[i]) < EPSILON);
export const sameTransform = (a: Transform, b: Transform) =>
  sameVec(a.position, b.position) && sameVec(a.rotation, b.rotation) && sameVec(a.scale, b.scale);

export function setTransformTx(doc: SceneDocument, id: ObjectId, transform: Transform, label?: string): Transaction {
  const obj = getObject(doc, id);
  if (sameTransform(obj.transform, transform)) return { label: '', ops: [] };
  return { label: label ?? `Transformer ${obj.name}`, ops: [{ type: 'update', id, changes: { transform } }] };
}

export function updateSettingsTx(changes: Partial<SceneSettings>): Transaction {
  return { label: 'Modifier la scène', ops: [{ type: 'settings', changes }] };
}

export function renameProjectTx(doc: SceneDocument, name: string): Transaction {
  const trimmed = name.trim();
  if (!trimmed || trimmed === doc.project.name) return { label: '', ops: [] };
  return { label: `Renommer le projet → ${trimmed}`, ops: [{ type: 'project', changes: { name: trimmed } }] };
}

export interface AddModelOptions {
  name?: string;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  model?: Partial<Omit<ModelProps, 'assetId'>>;
  parentId?: ObjectId | null;
}

/**
 * Ajoute une instance de modèle. Si l'asset n'est pas encore dans la table de la scène,
 * il y est enregistré dans la même transaction (un seul undo retire les deux).
 */
export function addModelTx(doc: SceneDocument, asset: AssetRecord, opts: AddModelOptions = {}): { tx: Transaction; id: ObjectId } {
  const obj = createObject('model', {
    name: uniqueName(doc, opts.name ?? asset.name),
    position: opts.position,
    rotation: opts.rotation,
    scale: opts.scale,
    model: { ...opts.model, assetId: asset.id },
    semanticRole: asset.semanticRole,
    category: asset.category,
    source: { kind: 'user', ref: asset.id },
  });
  const ops: Operation[] = [];
  if (!doc.assets[asset.id]) ops.push({ type: 'asset', id: asset.id, record: structuredClone(asset) });
  ops.push({ type: 'insert', objects: [obj], parentId: opts.parentId ?? null, index: -1 });
  return { id: obj.id, tx: { label: `Ajouter ${obj.name}`, ops } };
}

/** Pose l'objet au sol : son point le plus bas passe exactement à Y = 0. */
export function placeOnGroundTx(doc: SceneDocument, id: ObjectId, localBox: Box): Transaction {
  const obj = getObject(doc, id);
  const y = Math.round(groundedY(localBox, obj.transform) * 1e5) / 1e5;
  const p = obj.transform.position;
  return setTransformTx(doc, id, { ...obj.transform, position: [p[0], y, p[2]] }, `Poser ${obj.name} au sol`);
}
