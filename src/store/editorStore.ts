/**
 * État global de l'éditeur (Zustand).
 *
 * Le store ne contient PAS de logique métier de scène : il détient le document,
 * l'historique et l'état d'interface, et délègue toute modification au cœur
 * (`src/core`) via `execute(transaction)`. Les composants s'abonnent à des
 * tranches fines (ex. un seul objet) pour éviter les re-rendus globaux.
 *
 * Les actions sont des fonctions exportées (pas stockées dans l'état) : elles
 * sont stables, appelables hors React (raccourcis, viewport) et faciles à tester.
 */
import { create } from 'zustand';
import {
  addObjectTx,
  commit,
  createEmptyDocument,
  deleteObjectTx,
  duplicateObjectTx,
  emptyHistory,
  redo as historyRedo,
  undo as historyUndo,
  type History,
  type ObjectId,
  type SceneDocument,
  type SceneObjectType,
  type Transaction,
  type Vec3,
} from '../core/index.ts';

export type TransformMode = 'translate' | 'rotate' | 'scale';

export interface Notice {
  id: number;
  kind: 'info' | 'error';
  text: string;
}

export interface EditorState {
  doc: SceneDocument;
  history: History;
  selectedId: ObjectId | null;
  transformMode: TransformMode;
  /** Incrémenté à chaque changement du document (commit, undo, redo, chargement). */
  revision: number;
  /** Révision au moment de la dernière sauvegarde fichier (ou du dernier chargement). */
  savedRevision: number;
  notice: Notice | null;
  /** Caméra de scène par laquelle on regarde actuellement (sa représentation est masquée). */
  lookThroughId: ObjectId | null;
  /** Incrémenté à chaque remplacement complet du document (nouveau, ouverture) : force le remontage du viewport. */
  docEpoch: number;
}

const initialState = (): EditorState => ({
  doc: createEmptyDocument(),
  history: emptyHistory(),
  selectedId: null,
  transformMode: 'translate',
  revision: 0,
  savedRevision: 0,
  notice: null,
  lookThroughId: null,
  docEpoch: 0,
});

export const useEditor = create<EditorState>()(initialState);

const get = useEditor.getState;
const set = useEditor.setState;

// ---------------------------------------------------------------------------
// Sélecteurs utilitaires
// ---------------------------------------------------------------------------

export const selectIsDirty = (s: EditorState) => s.revision !== s.savedRevision;
export const selectSelectedObject = (s: EditorState) => (s.selectedId ? s.doc.objects[s.selectedId] : undefined);

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

let noticeCounter = 0;
export function notify(kind: Notice['kind'], text: string): void {
  set({ notice: { id: ++noticeCounter, kind, text } });
}
export function clearNotice(id: number): void {
  if (get().notice?.id === id) set({ notice: null });
}

// ---------------------------------------------------------------------------
// Exécution des transactions (seul point d'entrée des modifications de scène)
// ---------------------------------------------------------------------------

export interface ExecuteOptions {
  /** Fusionne avec la modification précédente de même clé (glisser une couleur…). */
  mergeKey?: string;
  /** Sélection à appliquer si la transaction réussit. */
  select?: ObjectId | null;
}

/** Applique une transaction. Renvoie false (et affiche la raison) si elle est refusée. */
export function execute(tx: Transaction, opts: ExecuteOptions = {}): boolean {
  const state = get();
  const result = commit(state.doc, state.history, tx, { mergeKey: opts.mergeKey });
  if (!result.ok) {
    notify('error', result.error);
    return false;
  }
  if (!result.changed) return true;
  const selectedId = opts.select !== undefined ? opts.select : state.selectedId;
  set({
    doc: result.doc,
    history: result.history,
    revision: state.revision + 1,
    selectedId: selectedId && result.doc.objects[selectedId] ? selectedId : null,
  });
  return true;
}

export function undo(): void {
  const state = get();
  const result = historyUndo(state.doc, state.history);
  if (!result) return;
  set({
    doc: result.doc,
    history: result.history,
    revision: state.revision + 1,
    selectedId: state.selectedId && result.doc.objects[state.selectedId] ? state.selectedId : null,
  });
  notify('info', `Annulé : ${result.entry.label}`);
}

export function redo(): void {
  const state = get();
  const result = historyRedo(state.doc, state.history);
  if (!result) return;
  set({
    doc: result.doc,
    history: result.history,
    revision: state.revision + 1,
    selectedId: state.selectedId && result.doc.objects[state.selectedId] ? state.selectedId : null,
  });
  notify('info', `Rétabli : ${result.entry.label}`);
}

// ---------------------------------------------------------------------------
// Actions d'édition
// ---------------------------------------------------------------------------

export function select(id: ObjectId | null): void {
  if (get().selectedId !== id) set({ selectedId: id });
}

export function setLookThrough(id: ObjectId | null): void {
  if (get().lookThroughId !== id) set({ lookThroughId: id });
}

export function setTransformMode(mode: TransformMode): void {
  set({ transformMode: mode });
}

export function addObject(type: SceneObjectType, position?: Vec3): ObjectId | null {
  const { tx, id } = addObjectTx(get().doc, type, { position });
  return execute(tx, { select: id }) ? id : null;
}

export function deleteObject(id: ObjectId): void {
  const doc = get().doc;
  if (!doc.objects[id]) return;
  execute(deleteObjectTx(doc, id));
}

export function duplicateObject(id: ObjectId): void {
  const doc = get().doc;
  if (!doc.objects[id]) return;
  const { tx, id: copyId } = duplicateObjectTx(doc, id);
  execute(tx, { select: copyId });
}

// ---------------------------------------------------------------------------
// Cycle de vie du document
// ---------------------------------------------------------------------------

/** Remplace la scène courante (nouveau projet, fichier chargé, restauration). L'historique repart de zéro. */
export function replaceDocument(doc: SceneDocument, opts: { dirty?: boolean } = {}): void {
  const revision = get().revision + 1;
  set({
    docEpoch: get().docEpoch + 1,
    lookThroughId: null,
    doc,
    history: emptyHistory(),
    selectedId: null,
    revision,
    savedRevision: opts.dirty ? -1 : revision,
  });
}

export function newScene(): void {
  replaceDocument(createEmptyDocument());
}

export function markSaved(): void {
  set({ savedRevision: get().revision });
}
