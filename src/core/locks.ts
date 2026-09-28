/**
 * Système de verrouillage.
 *
 * Le verrou est appliqué dans le CŒUR, pas seulement dans l'interface :
 * toute transaction (clic, raccourci, et plus tard IA) est vérifiée ici avant
 * d'être appliquée. C'est ce qui permettra de garantir qu'une opération IA
 * ne touche pas à ce que l'utilisateur a validé.
 *
 * Un objet est « effectivement verrouillé » s'il est verrouillé lui-même ou si
 * l'un de ses ancêtres l'est (prépare le verrouillage de groupes / bâtiments).
 */
import { applyOperation, type Operation, type Transaction } from './operations.ts';
import { getSubtreeIds, isEffectivelyLocked, SceneError } from './scene.ts';
import type { ObjectChangeKey, SceneDocument } from './types.ts';

/** Champs modifiables même sur un objet verrouillé (ils ne changent pas le contenu de la scène). */
export const LOCK_EXEMPT_KEYS: ReadonlySet<ObjectChangeKey> = new Set<ObjectChangeKey>(['name', 'visible', 'locked']);

export function checkOperation(doc: SceneDocument, op: Operation): string | null {
  switch (op.type) {
    case 'update': {
      const obj = doc.objects[op.id];
      if (!obj) return `Objet introuvable : ${op.id}`;
      if (!isEffectivelyLocked(doc, op.id)) return null;
      const blocked = (Object.keys(op.changes) as ObjectChangeKey[]).filter((k) => !LOCK_EXEMPT_KEYS.has(k));
      return blocked.length > 0 ? `« ${obj.name} » est verrouillé.` : null;
    }
    case 'delete': {
      const obj = doc.objects[op.id];
      if (!obj) return `Objet introuvable : ${op.id}`;
      const lockedId = getSubtreeIds(doc, op.id).find((id) => isEffectivelyLocked(doc, id));
      return lockedId ? `« ${doc.objects[lockedId].name} » est verrouillé : suppression impossible.` : null;
    }
    case 'insert': {
      if (op.parentId !== null && isEffectivelyLocked(doc, op.parentId)) {
        return `« ${doc.objects[op.parentId].name} » est verrouillé : impossible d'y ajouter un objet.`;
      }
      return null;
    }
    case 'move': {
      const obj = doc.objects[op.id];
      if (!obj) return `Objet introuvable : ${op.id}`;
      if (isEffectivelyLocked(doc, op.id)) return `« ${obj.name} » est verrouillé.`;
      if (op.parentId !== null && doc.objects[op.parentId] && isEffectivelyLocked(doc, op.parentId)) {
        return `« ${doc.objects[op.parentId].name} » est verrouillé : impossible d'y ajouter un objet.`;
      }
      return null;
    }
    case 'settings':
    case 'project':
    case 'asset':
    case 'docMetadata':
      return null;
  }
}

export type ExecuteResult =
  | { ok: true; doc: SceneDocument; inverse: Transaction }
  | { ok: false; error: string };

/**
 * Vérifie ET applique une transaction en une passe, opération par opération
 * (une opération peut dépendre d'une précédente, ex. insérer puis modifier).
 * Tout ou rien : au premier refus, le document d'origine est conservé tel quel.
 */
export function executeTransaction(doc: SceneDocument, tx: Transaction): ExecuteResult {
  let current = doc;
  const inverses: Operation[] = [];
  try {
    for (const op of tx.ops) {
      const error = checkOperation(current, op);
      if (error) return { ok: false, error };
      const result = applyOperation(current, op);
      current = result.doc;
      inverses.push(result.inverse);
    }
  } catch (e) {
    if (e instanceof SceneError) return { ok: false, error: e.message };
    throw e;
  }
  return { ok: true, doc: current, inverse: { label: tx.label, ops: inverses.reverse() } };
}
