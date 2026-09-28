/**
 * Commandes de hiérarchie et de sélection multiple : grouper, dégrouper, reparenter
 * (en conservant la position monde), supprimer / dupliquer / verrouiller / masquer plusieurs
 * objets, changer un matériau, appliquer un placement relationnel.
 *
 * Toutes renvoient une Transaction (un seul undo), aucune ne modifie le document.
 */
import { duplicateObjectTx } from './commands.ts';
import { createObject, uniqueName } from './factory.ts';
import { compose, localTransformFor, worldMatrix, worldTransform } from './math.ts';
import type { Operation, Transaction } from './operations.ts';
import { applyTransaction } from './operations.ts';
import { solvePlacement, type RelationSpec } from './placement.ts';
import { getObject, getSubtreeIds, indexInParent, SceneError } from './scene.ts';
import { ancestorsOf, objectSpatial, type BoundsContext } from './spatial.ts';
import type { MaterialOverride, MaterialProps, ObjectId, SceneDocument, Transform, Vec3 } from './types.ts';

/** Retire les objets dont un ancêtre est aussi dans la liste (agir sur le parent suffit), en gardant l'ordre. */
export function topLevelIds(doc: SceneDocument, ids: ObjectId[]): ObjectId[] {
  const set = new Set(ids.filter((id) => doc.objects[id]));
  return [...set].filter((id) => !ancestorsOf(doc, id).some((a) => set.has(a)));
}

const r5 = (v: number) => {
  const x = Math.round(v * 1e5) / 1e5;
  return Object.is(x, -0) ? 0 : x;
};
const roundT = (t: Transform): Transform => ({ position: t.position.map(r5) as Vec3, rotation: t.rotation.map(r5) as Vec3, scale: t.scale.map(r5) as Vec3 });

/** Ops pour déplacer `id` sous `parentId` sans qu'il bouge à l'écran. */
export function reparentOps(doc: SceneDocument, id: ObjectId, parentId: ObjectId | null, index = -1): Operation[] {
  const obj = getObject(doc, id);
  const world = worldMatrix(doc, id);
  const ops: Operation[] = [{ type: 'move', id, parentId, index }];
  // Le transform local doit être recalculé dans le repère du nouveau parent.
  const moved = applyTransaction(doc, { label: '', ops }).doc;
  const local = roundT(localTransformFor(moved, parentId, world));
  ops.push({ type: 'update', id, changes: { transform: local } });
  void obj;
  return ops;
}

export function reparentTx(doc: SceneDocument, ids: ObjectId[], parentId: ObjectId | null): Transaction {
  const tops = topLevelIds(doc, ids);
  if (parentId && tops.some((id) => id === parentId || getSubtreeIds(doc, id).includes(parentId))) {
    throw new SceneError('Un objet ne peut pas devenir enfant de lui-même.');
  }
  let current = doc;
  const ops: Operation[] = [];
  for (const id of tops) {
    const step = reparentOps(current, id, parentId);
    current = applyTransaction(current, { label: '', ops: step }).doc;
    ops.push(...step);
  }
  const target = parentId ? getObject(doc, parentId).name : 'la racine';
  return { label: `Déplacer ${tops.length > 1 ? `${tops.length} objets` : getObject(doc, tops[0]).name} dans ${target}`, ops };
}

/**
 * Groupe des objets : le groupe est créé au centre-bas de leur boîte commune, sous le parent
 * commun (sinon à la racine), à l'emplacement du premier objet. Les objets ne bougent pas.
 */
export function groupObjectsTx(doc: SceneDocument, ids: ObjectId[], ctx: BoundsContext, name = 'Groupe'): { tx: Transaction; id: ObjectId } {
  const tops = topLevelIds(doc, ids);
  if (tops.length === 0) throw new SceneError('Rien à grouper.');
  const parents = new Set(tops.map((id) => doc.objects[id].parentId));
  const parentId = parents.size === 1 ? [...parents][0] : null;
  // Pivot : centre-bas de l'union des boîtes monde (ou moyenne des positions si inconnues).
  let min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const id of tops) {
    const s = objectSpatial(doc, id, ctx);
    const pts = s ? [s.aabb.min, s.aabb.max] : [worldTransform(doc, id).position];
    for (const p of pts) for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
  }
  const pivotWorld: Vec3 = [r5((min[0] + max[0]) / 2), r5(min[1]), r5((min[2] + max[2]) / 2)];
  const local = roundT(localTransformFor(doc, parentId, compose({ position: pivotWorld, rotation: [0, 0, 0], scale: [1, 1, 1] })));
  const group = createObject('group', { name: uniqueName(doc, name), position: local.position, rotation: local.rotation, scale: local.scale });
  const index = parentId !== null || parents.size === 1 ? Math.min(...tops.map((id) => indexInParent(doc, id))) : -1;
  const ops: Operation[] = [{ type: 'insert', objects: [group], parentId, index }];
  let current = applyTransaction(doc, { label: '', ops }).doc;
  for (const id of tops) {
    const step = reparentOps(current, id, group.id);
    current = applyTransaction(current, { label: '', ops: step }).doc;
    ops.push(...step);
  }
  return { id: group.id, tx: { label: `Grouper ${tops.length} objet${tops.length > 1 ? 's' : ''}`, ops } };
}

/** Dégroupe : les enfants remontent au parent du groupe (sans bouger), le groupe est supprimé. */
export function ungroupTx(doc: SceneDocument, groupId: ObjectId): { tx: Transaction; childIds: ObjectId[] } {
  const g = getObject(doc, groupId);
  if (g.type !== 'group') throw new SceneError(`« ${g.name} » n'est pas un groupe.`);
  const ops: Operation[] = [];
  let current = doc;
  let index = indexInParent(doc, groupId) + 1;
  for (const id of [...g.children]) {
    const step = reparentOps(current, id, g.parentId, index++);
    current = applyTransaction(current, { label: '', ops: step }).doc;
    ops.push(...step);
  }
  ops.push({ type: 'delete', id: groupId });
  return { childIds: [...g.children], tx: { label: `Dégrouper ${g.name}`, ops } };
}

/** Fusionne plusieurs transactions indépendantes (chaque étape voit le résultat de la précédente). */
function chain(doc: SceneDocument, label: string, builders: ((d: SceneDocument) => Transaction)[]): Transaction {
  let current = doc;
  const ops: Operation[] = [];
  for (const b of builders) {
    const tx = b(current);
    current = applyTransaction(current, tx).doc;
    ops.push(...tx.ops);
  }
  return { label, ops };
}

const plural = (doc: SceneDocument, ids: ObjectId[], verb: string) =>
  ids.length === 1 ? `${verb} ${getObject(doc, ids[0]).name}` : `${verb} ${ids.length} objets`;

export function deleteManyTx(doc: SceneDocument, ids: ObjectId[]): Transaction {
  const tops = topLevelIds(doc, ids);
  return { label: plural(doc, tops, 'Supprimer'), ops: tops.map((id) => ({ type: 'delete', id }) as Operation) };
}

export function duplicateManyTx(doc: SceneDocument, ids: ObjectId[]): { tx: Transaction; ids: ObjectId[] } {
  const tops = topLevelIds(doc, ids);
  const newIds: ObjectId[] = [];
  const tx = chain(
    doc,
    plural(doc, tops, 'Dupliquer'),
    tops.map((id) => (d: SceneDocument) => {
      const r = duplicateObjectTx(d, id);
      newIds.push(r.id);
      return r.tx;
    }),
  );
  return { tx, ids: newIds };
}

export function setManyTx(doc: SceneDocument, ids: ObjectId[], key: 'visible' | 'locked', value: boolean): Transaction {
  const targets = topLevelIds(doc, ids).filter((id) => doc.objects[id][key] !== value);
  const verb = key === 'visible' ? (value ? 'Afficher' : 'Masquer') : value ? 'Verrouiller' : 'Déverrouiller';
  return { label: targets.length ? plural(doc, targets, verb) : '', ops: targets.map((id) => ({ type: 'update', id, changes: { [key]: value } }) as Operation) };
}

/**
 * Change le matériau : complet pour cubes, sphères et éléments ; surcharge pour un modèle
 * (null = revenir aux matériaux d'origine du fichier). Un groupe applique à ses descendants.
 */
export function changeMaterialTx(doc: SceneDocument, ids: ObjectId[], patch: MaterialOverride | null): Transaction {
  const ops: Operation[] = [];
  const all = new Set<ObjectId>();
  for (const id of topLevelIds(doc, ids)) for (const sub of getSubtreeIds(doc, id)) all.add(sub);
  for (const id of all) {
    const o = doc.objects[id];
    if (o.type === 'box' || o.type === 'sphere') {
      if (patch) ops.push({ type: 'update', id, changes: { material: { ...o.material, ...patch } as MaterialProps } });
    } else if (o.type === 'element') {
      if (patch) ops.push({ type: 'update', id, changes: { element: { ...o.element, material: { ...o.element.material, ...patch } } } });
    } else if (o.type === 'model') {
      const next = patch ? { ...(o.model.materialOverride ?? {}), ...patch } : null;
      ops.push({ type: 'update', id, changes: { model: { ...o.model, materialOverride: next } } });
    }
  }
  return { label: patch ? 'Modifier le matériau' : 'Réinitialiser le matériau', ops };
}

/** Applique une relation spatiale (et la mémorise sur l'objet). */
export function placeTx(doc: SceneDocument, id: ObjectId, rel: RelationSpec, ctx: BoundsContext): { tx: Transaction; notes: string[] } {
  const obj = getObject(doc, id);
  const sol = solvePlacement(doc, id, rel, ctx);
  const ops: Operation[] = [];
  if (sol.parentId !== obj.parentId) ops.push({ type: 'move', id, parentId: sol.parentId, index: -1 });
  const { type, target, ...params } = rel;
  ops.push({ type: 'update', id, changes: { transform: sol.transform, relation: { type, targetId: target, ...(Object.keys(params).length ? { params: params as Record<string, number | string | boolean> } : {}) } } });
  if (sol.elementChanges && obj.type === 'element') ops.push({ type: 'update', id, changes: { element: { ...obj.element, ...sol.elementChanges } } });
  return { notes: sol.notes, tx: { label: `Placer ${obj.name} (${type})`, ops } };
}
