import type { ObjectId, SceneDocument, SceneObject } from './types.ts';

export class SceneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SceneError';
  }
}

export function getObject(doc: SceneDocument, id: ObjectId): SceneObject {
  const obj = doc.objects[id];
  if (!obj) throw new SceneError(`Objet introuvable : ${id}`);
  return obj;
}

/** Liste ordonnée des enfants d'un parent (null = racine). */
export function getChildIds(doc: SceneDocument, parentId: ObjectId | null): ObjectId[] {
  return parentId === null ? doc.rootIds : getObject(doc, parentId).children;
}

export function indexInParent(doc: SceneDocument, id: ObjectId): number {
  const obj = getObject(doc, id);
  return getChildIds(doc, obj.parentId).indexOf(id);
}

/** L'objet et tous ses descendants, parent avant enfants (ordre de parcours en profondeur). */
export function getSubtreeIds(doc: SceneDocument, id: ObjectId): ObjectId[] {
  const out: ObjectId[] = [];
  const visit = (current: ObjectId) => {
    out.push(current);
    for (const child of getObject(doc, current).children) visit(child);
  };
  visit(id);
  return out;
}

/** Vrai si l'objet OU l'un de ses ancêtres est verrouillé. */
export function isEffectivelyLocked(doc: SceneDocument, id: ObjectId): boolean {
  let current: SceneObject | undefined = doc.objects[id];
  while (current) {
    if (current.locked) return true;
    current = current.parentId ? doc.objects[current.parentId] : undefined;
  }
  return false;
}

/** Vrai si l'objet ET tous ses ancêtres sont visibles. */
export function isEffectivelyVisible(doc: SceneDocument, id: ObjectId): boolean {
  let current: SceneObject | undefined = doc.objects[id];
  while (current) {
    if (!current.visible) return false;
    current = current.parentId ? doc.objects[current.parentId] : undefined;
  }
  return true;
}

/** Tous les objets dans l'ordre de la hiérarchie (parcours en profondeur). */
export function getAllIdsInOrder(doc: SceneDocument): ObjectId[] {
  return doc.rootIds.flatMap((id) => getSubtreeIds(doc, id));
}
