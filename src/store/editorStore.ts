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
  duplicateManyTx,
  deleteManyTx,
  emptyHistory,
  getSubtreeIds,
  groupObjectsTx,
  redo as historyRedo,
  setManyTx,
  topLevelIds,
  undo as historyUndo,
  ungroupTx,
  type CreateObjectOptions,
  type History,
  type ObjectId,
  type SceneDocument,
  type SceneObjectType,
  type Transaction,
  type Vec3,
} from '../core/index.ts';
import { worldContext } from '../world/worldContext.ts';

export type TransformMode = 'translate' | 'rotate' | 'scale';

export interface Notice {
  id: number;
  kind: 'info' | 'error';
  text: string;
}

export interface SnapSettings {
  /** Aimantation à la grille (déplacement) et aux angles (rotation). */
  enabled: boolean;
  /** Pas de déplacement (m). */
  translate: 0.1 | 0.5 | 1;
  /** Pas de rotation (degrés). */
  rotate: 5 | 15 | 45 | 90;
  /** Pose automatiquement sur la surface située dessous (sol, table…) et contre un mur proche. */
  surface: boolean;
}

export interface EditorState {
  doc: SceneDocument;
  history: History;
  /** Objets sélectionnés, dans l'ordre de sélection. */
  selectedIds: ObjectId[];
  /** Sélection principale (la dernière sélectionnée) : c'est elle que montre l'inspecteur. */
  selectedId: ObjectId | null;
  transformMode: TransformMode;
  snap: SnapSettings;
  /** Incrémenté à chaque changement du document (commit, undo, redo, chargement). */
  revision: number;
  /** Révision au moment de la dernière sauvegarde fichier (ou du dernier chargement). */
  savedRevision: number;
  notice: Notice | null;
  /** Caméra de scène par laquelle on regarde actuellement (sa représentation est masquée). */
  lookThroughId: ObjectId | null;
  /** Incrémenté à chaque remplacement complet du document (nouveau, ouverture) : force le remontage du viewport. */
  docEpoch: number;
  /** Panneau du validateur de scène ouvert. */
  validatorOpen: boolean;
}

const initialState = (): EditorState => ({
  doc: createEmptyDocument(),
  history: emptyHistory(),
  selectedIds: [],
  selectedId: null,
  transformMode: 'translate',
  snap: { enabled: false, translate: 0.5, rotate: 15, surface: true },
  revision: 0,
  savedRevision: 0,
  notice: null,
  lookThroughId: null,
  docEpoch: 0,
  validatorOpen: false,
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
// Sélection
// ---------------------------------------------------------------------------

function selectionPatch(ids: ObjectId[], doc: SceneDocument): Pick<EditorState, 'selectedIds' | 'selectedId'> {
  const valid = [...new Set(ids)].filter((id) => doc.objects[id]);
  return { selectedIds: valid, selectedId: valid.length ? valid[valid.length - 1] : null };
}

const sameList = (a: ObjectId[], b: ObjectId[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Sélectionne un objet.
 * - 'replace' : sélection unique (clic simple) ;
 * - 'toggle'  : ajoute / retire (⇧, ⌘ ou Ctrl + clic).
 */
export function select(id: ObjectId | null, mode: 'replace' | 'toggle' = 'replace'): void {
  const s = get();
  let next: ObjectId[];
  if (id === null) next = [];
  else if (mode === 'toggle') next = s.selectedIds.includes(id) ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id];
  else next = [id];
  const patch = selectionPatch(next, s.doc);
  if (!sameList(patch.selectedIds, s.selectedIds) || patch.selectedId !== s.selectedId) set(patch);
}

export function selectMany(ids: ObjectId[]): void {
  set(selectionPatch(ids, get().doc));
}

export function selectAll(): void {
  selectMany(get().doc.rootIds);
}

// ---------------------------------------------------------------------------
// Exécution des transactions (seul point d'entrée des modifications de scène)
// ---------------------------------------------------------------------------

export interface ExecuteOptions {
  /** Fusionne avec la modification précédente de même clé (glisser une couleur…). */
  mergeKey?: string;
  /** Sélection à appliquer si la transaction réussit. */
  select?: ObjectId | ObjectId[] | null;
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
  const wanted = opts.select === undefined ? state.selectedIds : opts.select === null ? [] : Array.isArray(opts.select) ? opts.select : [opts.select];
  set({
    doc: result.doc,
    history: result.history,
    revision: state.revision + 1,
    ...selectionPatch(wanted, result.doc),
  });
  return true;
}

export function undo(): void {
  const state = get();
  const result = historyUndo(state.doc, state.history);
  if (!result) return;
  set({ doc: result.doc, history: result.history, revision: state.revision + 1, ...selectionPatch(state.selectedIds, result.doc) });
  notify('info', `Annulé : ${result.entry.label}`);
}

export function redo(): void {
  const state = get();
  const result = historyRedo(state.doc, state.history);
  if (!result) return;
  set({ doc: result.doc, history: result.history, revision: state.revision + 1, ...selectionPatch(state.selectedIds, result.doc) });
  notify('info', `Rétabli : ${result.entry.label}`);
}

// ---------------------------------------------------------------------------
// Réglages d'interface
// ---------------------------------------------------------------------------

export function setLookThrough(id: ObjectId | null): void {
  if (get().lookThroughId !== id) set({ lookThroughId: id });
}

export function setTransformMode(mode: TransformMode): void {
  set({ transformMode: mode });
}

export function setSnap(patch: Partial<SnapSettings>): void {
  set({ snap: { ...get().snap, ...patch } });
}

export function setValidatorOpen(open: boolean): void {
  set({ validatorOpen: open });
}

// ---------------------------------------------------------------------------
// Actions d'édition
// ---------------------------------------------------------------------------

export function addObject(type: SceneObjectType, position?: Vec3, opts: CreateObjectOptions = {}): ObjectId | null {
  const { tx, id } = addObjectTx(get().doc, type, { ...opts, position: position ?? opts.position });
  return execute(tx, { select: id }) ? id : null;
}

/** Sélection « utile » : sans les objets dont un ancêtre est aussi sélectionné. */
export const selectionRoots = () => topLevelIds(get().doc, get().selectedIds);

export function deleteObject(id: ObjectId): void {
  if (get().doc.objects[id]) execute(deleteManyTx(get().doc, [id]));
}

export function deleteSelection(): void {
  const ids = selectionRoots();
  if (ids.length) execute(deleteManyTx(get().doc, ids), { select: null });
}

export function duplicateObject(id: ObjectId): void {
  if (!get().doc.objects[id]) return;
  const { tx, ids } = duplicateManyTx(get().doc, [id]);
  execute(tx, { select: ids });
}

export function duplicateSelection(): void {
  const ids = selectionRoots();
  if (!ids.length) return;
  const { tx, ids: copies } = duplicateManyTx(get().doc, ids);
  execute(tx, { select: copies });
}

export function setSelectionFlag(key: 'visible' | 'locked', value: boolean): void {
  const ids = selectionRoots();
  if (ids.length) execute(setManyTx(get().doc, ids, key, value));
}

export function groupSelection(): void {
  const ids = selectionRoots();
  if (!ids.length) return;
  try {
    const doc = get().doc;
    const { tx, id } = groupObjectsTx(doc, ids, worldContext(doc));
    execute(tx, { select: id });
  } catch (e) {
    notify('error', (e as Error).message);
  }
}

export function ungroupSelection(): void {
  const doc = get().doc;
  const groups = selectionRoots().filter((id) => doc.objects[id].type === 'group');
  if (!groups.length) return;
  let current = doc;
  const ops: Transaction['ops'] = [];
  const children: ObjectId[] = [];
  try {
    for (const g of groups) {
      const r = ungroupTx(current, g);
      const c = commit(current, emptyHistory(), r.tx);
      if (!c.ok) throw new Error(c.error);
      current = c.doc;
      ops.push(...r.tx.ops);
      children.push(...r.childIds);
    }
  } catch (e) {
    notify('error', (e as Error).message);
    return;
  }
  execute({ label: groups.length > 1 ? `Dégrouper ${groups.length} groupes` : `Dégrouper ${doc.objects[groups[0]].name}`, ops }, { select: children });
}

/** Tous les identifiants concernés par la sélection (sous-arbres inclus). */
export function selectionSubtreeIds(): ObjectId[] {
  const doc = get().doc;
  return [...new Set(selectionRoots().flatMap((id) => getSubtreeIds(doc, id)))];
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
    selectedIds: [],
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
