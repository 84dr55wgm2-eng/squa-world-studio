/**
 * Actions « composition du monde » de l'interface. Toutes passent par le cœur
 * (commandes structurées, moteur de placement, transactions) : l'interface et la
 * future IA utilisent exactement les mêmes chemins.
 */
import {
  applyTransaction,
  changeMaterialTx,
  createEmptyDocument,
  dropToSurface,
  getObject,
  placeTx,
  runWorldCommands,
  SCENE_TEMPLATES,
  snapAgainstNearestWall,
  snapshotPrefab,
  type ElementShape,
  type MaterialOverride,
  type ObjectId,
  type Operation,
  type RelationSpec,
  type Transaction,
  type RunError,
  type RunResult,
  type SceneDocument,
  type SceneTemplate,
  type Vec3,
  type WorldCommand,
} from '../core/index.ts';
import { createId } from '../core/ids.ts';
import { execute, notify, replaceDocument, selectionRoots, useEditor } from '../store/editorStore.ts';
import { getViewTargetOnGround } from '../viewport/cameraController.ts';
import { addUserPrefab, findPrefab } from './prefabStore.ts';
import { worldContext } from './worldContext.ts';

const doc = () => useEditor.getState().doc;

/** Exécute un script de commandes JSON comme UNE action annulable. */
export function runCommands(commands: WorldCommand[], label?: string): RunResult | RunError {
  const d = doc();
  const r = runWorldCommands(d, commands, worldContext(d), { label });
  if (!r.ok) {
    notify('error', `Commande ${r.index + 1} refusée : ${r.error}`);
    return r;
  }
  execute(r.tx, { select: r.created.length ? r.created : undefined });
  if (r.notes.length) notify('info', r.notes.join(' '));
  return r;
}

/**
 * Complète une transaction d'ajout par la pose sur la surface située dessous (si l'aimantation
 * aux surfaces est active) : un seul undo pour « ajouter + poser ».
 */
export function withSurfaceSnap(tx: Transaction, base: SceneDocument, ids: ObjectId[]): Transaction {
  if (!useEditor.getState().snap.surface) return tx;
  try {
    const after = applyTransaction(base, tx).doc;
    return { label: tx.label, ops: [...tx.ops, ...surfaceSnapOps(after, ids, { walls: false })] };
  } catch {
    return tx;
  }
}

export function addElement(shape: ElementShape, groundPoint?: Vec3): void {
  const g = groundPoint ?? getViewTargetOnGround() ?? [0, 0, 0];
  const d = doc();
  const r = runWorldCommands(d, [{ action: 'ADD_OBJECT', element: shape, position: [g[0], 0, g[2]] }], worldContext(d));
  if (!r.ok) return void notify('error', r.error);
  execute(withSurfaceSnap({ ...r.tx, label: `Ajouter ${r.doc.objects[r.created[0]].name}` }, d, r.created), { select: r.created });
}

export function instantiatePrefab(prefabId: string, groundPoint?: Vec3): void {
  const def = findPrefab(prefabId);
  if (!def) return;
  const g = groundPoint ?? getViewTargetOnGround() ?? [0, 0, 0];
  runCommands([{ action: 'INSTANTIATE_PREFAB', prefabId, position: [g[0], 0, g[2]] }], `Ajouter ${def.name}`);
}

/** Applique une relation spatiale à l'objet principal sélectionné. */
export function placeSelected(rel: RelationSpec): boolean {
  const id = useEditor.getState().selectedId;
  if (!id) return false;
  try {
    const d = doc();
    const { tx, notes } = placeTx(d, id, rel, worldContext(d));
    const ok = execute(tx);
    if (ok && notes.length) notify('info', notes.join(' '));
    return ok;
  } catch (e) {
    notify('error', (e as Error).message);
    return false;
  }
}

/**
 * Opérations d'aimantation après un déplacement : contre le mur proche (option), puis pose
 * sur la surface située dessous. Calculées sur le document fourni (qui contient déjà le déplacement).
 */
export function surfaceSnapOps(d: SceneDocument, ids: ObjectId[], opts: { walls: boolean }): Operation[] {
  const ctx = worldContext(d);
  const ops: Operation[] = [];
  let current = d;
  for (const id of ids) {
    const obj = current.objects[id];
    if (!obj || obj.type === 'light' || obj.type === 'camera' || ['floor', 'road', 'sidewalk', 'room', 'wall', 'door', 'window', 'ceiling'].includes(obj.semanticRole)) continue;
    // Les objets fixés à un mur (portes, fenêtres) ou à un parent non-groupe ne sont pas aimantés.
    if (obj.parentId && current.objects[obj.parentId]?.type !== 'group') continue;
    const step: Operation[] = [];
    if (opts.walls) {
      const w = snapAgainstNearestWall(current, id, ctx);
      if (w) step.push({ type: 'update', id, changes: { transform: w.transform } });
    }
    let next = step.length ? applyTransaction(current, { label: '', ops: step }).doc : current;
    const drop = dropToSurface(next, id, ctx);
    if (drop) {
      const drops: Operation[] = [{ type: 'update', id, changes: { transform: drop.transform } }];
      next = applyTransaction(next, { label: '', ops: drops }).doc;
      step.push(...drops);
    }
    ops.push(...step);
    current = next;
  }
  return ops;
}

/** « Poser sur la surface » : sélection posée sur ce qui est dessous (sol, table…). */
export function dropSelection(): void {
  const ids = selectionRoots();
  if (!ids.length) return;
  const ops = surfaceSnapOps(doc(), ids, { walls: false });
  execute({ label: ids.length > 1 ? `Poser ${ids.length} objets` : `Poser ${getObject(doc(), ids[0]).name}`, ops });
}

export function changeMaterial(ids: ObjectId[], patch: MaterialOverride | null, mergeKey?: string): void {
  const tx = changeMaterialTx(doc(), ids, patch);
  execute(tx, { mergeKey });
}

/** Nouvelle scène à partir d'un modèle (script de commandes exécuté sur une scène vide). */
export function createFromTemplate(t: SceneTemplate): boolean {
  const empty = createEmptyDocument(t.id === 'empty' ? 'Sans titre' : t.name);
  if (!t.commands.length) {
    replaceDocument(empty);
    return true;
  }
  const r = runWorldCommands(empty, t.commands, worldContext(empty), { source: { kind: 'template', ref: t.id } });
  if (!r.ok) {
    notify('error', `Modèle « ${t.name} » : commande ${r.index + 1} refusée (${r.error}).`);
    return false;
  }
  replaceDocument({ ...r.doc, metadata: { ...r.doc.metadata, template: t.id } });
  return true;
}

export const TEMPLATES = SCENE_TEMPLATES;

/** Enregistre le groupe (ou l'objet) sélectionné comme prefab réutilisable. */
export function saveSelectionAsPrefab(name: string): boolean {
  const id = useEditor.getState().selectedId;
  if (!id) return false;
  const trimmed = name.trim();
  if (!trimmed) {
    notify('error', 'Donnez un nom au prefab.');
    return false;
  }
  const def = snapshotPrefab(doc(), id, { id: `user:${createId('pf')}`, name: trimmed, tags: [...getObject(doc(), id).tags] });
  const persistent = addUserPrefab(def);
  notify('info', persistent ? `Prefab « ${trimmed} » enregistré dans la bibliothèque.` : `Prefab « ${trimmed} » ajouté pour cette session (stockage du navigateur indisponible).`);
  return true;
}

