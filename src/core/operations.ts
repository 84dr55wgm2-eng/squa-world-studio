/**
 * Opérations atomiques sur un SceneDocument.
 *
 * Toute modification de la scène passe par ici — interface, raccourcis clavier,
 * et plus tard l'IA. Chaque opération :
 * - est pure (ne modifie jamais le document reçu, en renvoie un nouveau),
 * - ne recopie que ce qui change (les objets non touchés gardent la même référence,
 *   ce qui évite de re-rendre tout le viewport),
 * - renvoie son opération inverse exacte → undo/redo sans cas particulier.
 *
 * Les opérations sont des données JSON : une IA pourra produire une Transaction
 * (liste d'opérations locales) plutôt que du code Three.js.
 */
import { getChildIds, getObject, getSubtreeIds, indexInParent, SceneError } from './scene.ts';
import type {
  AssetId,
  AssetRecord,
  ObjectChanges,
  ObjectChangeKey,
  ObjectId,
  ProjectInfo,
  SceneDocument,
  SceneObject,
  SceneSettings,
} from './types.ts';

export type Operation =
  | {
      type: 'insert';
      /** Sous-arbre à insérer : objects[0] est la racine, suivie de ses descendants. */
      objects: SceneObject[];
      parentId: ObjectId | null;
      /** Position parmi les enfants du parent ; -1 ou hors limites = à la fin. */
      index: number;
    }
  | { type: 'delete'; id: ObjectId }
  | { type: 'update'; id: ObjectId; changes: ObjectChanges }
  | { type: 'settings'; changes: Partial<SceneSettings> }
  | { type: 'project'; changes: Partial<Pick<ProjectInfo, 'name'>> }
  /** Ajoute / remplace (record) ou retire (null) une entrée de la table d'assets. */
  | { type: 'asset'; id: AssetId; record: AssetRecord | null }
  /** Change le parent d'un objet (sans toucher à son transform local : voir commands pour conserver la position monde). */
  | { type: 'move'; id: ObjectId; parentId: ObjectId | null; index: number }
  /** Remplace les métadonnées de la scène. */
  | { type: 'docMetadata'; metadata: Record<string, unknown> };

export interface Transaction {
  /** Libellé lisible, affiché dans l'historique (ex. « Déplacer Cube »). */
  label: string;
  ops: Operation[];
}

const TYPE_SPECIFIC_KEYS: Partial<Record<ObjectChangeKey, SceneObject['type'][]>> = {
  material: ['box', 'sphere'],
  light: ['light'],
  camera: ['camera'],
  model: ['model'],
  element: ['element'],
};

function assertAssetExists(doc: SceneDocument, obj: SceneObject): void {
  if (obj.type === 'model' && !doc.assets[obj.model.assetId]) {
    throw new SceneError(`Asset inconnu pour « ${obj.name} » : ${obj.model.assetId}`);
  }
}

const clone = <T>(value: T): T => structuredClone(value);

function withChildList(
  doc: SceneDocument,
  objects: Record<ObjectId, SceneObject>,
  parentId: ObjectId | null,
  children: ObjectId[],
): { rootIds: ObjectId[]; objects: Record<ObjectId, SceneObject> } {
  if (parentId === null) return { rootIds: children, objects };
  const parent = objects[parentId] ?? getObject(doc, parentId);
  return { rootIds: doc.rootIds, objects: { ...objects, [parentId]: { ...parent, children } } };
}

function applyInsert(doc: SceneDocument, op: Extract<Operation, { type: 'insert' }>) {
  if (op.objects.length === 0) throw new SceneError('Insertion vide.');
  if (op.parentId !== null) getObject(doc, op.parentId);
  const [root] = op.objects;
  const objects = { ...doc.objects };
  for (const obj of op.objects) {
    if (objects[obj.id]) throw new SceneError(`Identifiant déjà utilisé : ${obj.id}`);
    assertAssetExists(doc, obj);
    objects[obj.id] = clone(obj);
  }
  objects[root.id] = { ...objects[root.id], parentId: op.parentId };

  const siblings = [...getChildIds(doc, op.parentId)];
  const index = op.index < 0 || op.index > siblings.length ? siblings.length : op.index;
  siblings.splice(index, 0, root.id);

  const next = withChildList(doc, objects, op.parentId, siblings);
  const inverse: Operation = { type: 'delete', id: root.id };
  return { doc: { ...doc, ...next }, inverse };
}

function applyDelete(doc: SceneDocument, op: Extract<Operation, { type: 'delete' }>) {
  const target = getObject(doc, op.id);
  const subtree = getSubtreeIds(doc, op.id);
  const index = indexInParent(doc, op.id);

  const objects = { ...doc.objects };
  for (const id of subtree) delete objects[id];
  const siblings = getChildIds(doc, target.parentId).filter((id) => id !== op.id);
  const next = withChildList(doc, objects, target.parentId, siblings);

  const inverse: Operation = {
    type: 'insert',
    objects: subtree.map((id) => clone(doc.objects[id])),
    parentId: target.parentId,
    index,
  };
  return { doc: { ...doc, ...next }, inverse };
}

function applyUpdate(doc: SceneDocument, op: Extract<Operation, { type: 'update' }>) {
  const obj = getObject(doc, op.id);
  const previous: Record<string, unknown> = {};
  for (const key of Object.keys(op.changes) as ObjectChangeKey[]) {
    const allowed = TYPE_SPECIFIC_KEYS[key];
    if (allowed && !allowed.includes(obj.type)) {
      throw new SceneError(`Le champ « ${key} » ne s'applique pas à un objet de type ${obj.type}.`);
    }
    previous[key] = clone((obj as unknown as Record<string, unknown>)[key]);
  }
  const updated = { ...obj, ...clone(op.changes) } as SceneObject;
  assertAssetExists(doc, updated);
  const inverse: Operation = { type: 'update', id: op.id, changes: previous as ObjectChanges };
  return { doc: { ...doc, objects: { ...doc.objects, [op.id]: updated } }, inverse };
}

function applySettings(doc: SceneDocument, op: Extract<Operation, { type: 'settings' }>) {
  const previous: Partial<SceneSettings> = {};
  for (const key of Object.keys(op.changes) as (keyof SceneSettings)[]) {
    (previous as Record<string, unknown>)[key] = doc.settings[key];
  }
  const inverse: Operation = { type: 'settings', changes: previous };
  return { doc: { ...doc, settings: { ...doc.settings, ...op.changes } }, inverse };
}

function applyProject(doc: SceneDocument, op: Extract<Operation, { type: 'project' }>) {
  const previous: Partial<Pick<ProjectInfo, 'name'>> = {};
  if (op.changes.name !== undefined) previous.name = doc.project.name;
  const inverse: Operation = { type: 'project', changes: previous };
  return { doc: { ...doc, project: { ...doc.project, ...op.changes } }, inverse };
}

function applyAsset(doc: SceneDocument, op: Extract<Operation, { type: 'asset' }>) {
  if (op.record === null) {
    const user = Object.values(doc.objects).find((o) => o.type === 'model' && o.model.assetId === op.id);
    if (user) throw new SceneError(`L'asset ${op.id} est encore utilisé par « ${user.name} ».`);
  } else if (op.record.id !== op.id) {
    throw new SceneError('Identifiant d’asset incohérent.');
  }
  const previous = doc.assets[op.id] ? clone(doc.assets[op.id]) : null;
  const assets = { ...doc.assets };
  if (op.record) assets[op.id] = clone(op.record);
  else delete assets[op.id];
  const inverse: Operation = { type: 'asset', id: op.id, record: previous };
  return { doc: { ...doc, assets }, inverse };
}

function applyMove(doc: SceneDocument, op: Extract<Operation, { type: 'move' }>) {
  const obj = getObject(doc, op.id);
  if (op.parentId !== null) {
    getObject(doc, op.parentId);
    if (op.parentId === op.id || getSubtreeIds(doc, op.id).includes(op.parentId)) {
      throw new SceneError(`Impossible de placer « ${obj.name} » dans l'un de ses propres enfants.`);
    }
  }
  const oldParent = obj.parentId;
  const oldIndex = indexInParent(doc, op.id);
  // Retrait de l'ancienne liste.
  let objects = { ...doc.objects };
  let rootIds = doc.rootIds;
  const removeFrom = (parentId: ObjectId | null) => {
    if (parentId === null) rootIds = rootIds.filter((id) => id !== op.id);
    else objects[parentId] = { ...objects[parentId], children: objects[parentId].children.filter((id) => id !== op.id) };
  };
  const insertInto = (parentId: ObjectId | null, index: number) => {
    const list = parentId === null ? [...rootIds] : [...objects[parentId].children];
    const i = index < 0 || index > list.length ? list.length : index;
    list.splice(i, 0, op.id);
    if (parentId === null) rootIds = list;
    else objects[parentId] = { ...objects[parentId], children: list };
  };
  removeFrom(oldParent);
  insertInto(op.parentId, op.index);
  objects = { ...objects, [op.id]: { ...objects[op.id], parentId: op.parentId } };
  const inverse: Operation = { type: 'move', id: op.id, parentId: oldParent, index: oldIndex };
  return { doc: { ...doc, objects, rootIds }, inverse };
}

function applyDocMetadata(doc: SceneDocument, op: Extract<Operation, { type: 'docMetadata' }>) {
  const inverse: Operation = { type: 'docMetadata', metadata: clone(doc.metadata ?? {}) };
  return { doc: { ...doc, metadata: clone(op.metadata) }, inverse };
}

export function applyOperation(doc: SceneDocument, op: Operation): { doc: SceneDocument; inverse: Operation } {
  switch (op.type) {
    case 'insert':
      return applyInsert(doc, op);
    case 'delete':
      return applyDelete(doc, op);
    case 'update':
      return applyUpdate(doc, op);
    case 'settings':
      return applySettings(doc, op);
    case 'project':
      return applyProject(doc, op);
    case 'asset':
      return applyAsset(doc, op);
    case 'move':
      return applyMove(doc, op);
    case 'docMetadata':
      return applyDocMetadata(doc, op);
  }
}

/**
 * Applique toutes les opérations dans l'ordre (tout ou rien : si une opération échoue,
 * l'exception remonte et le document d'origine reste intact car jamais muté).
 * L'inverse contient les opérations inverses dans l'ordre opposé.
 */
export function applyTransaction(doc: SceneDocument, tx: Transaction): { doc: SceneDocument; inverse: Transaction } {
  let current = doc;
  const inverses: Operation[] = [];
  for (const op of tx.ops) {
    const result = applyOperation(current, op);
    current = result.doc;
    inverses.push(result.inverse);
  }
  return { doc: current, inverse: { label: tx.label, ops: inverses.reverse() } };
}
