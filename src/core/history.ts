/**
 * Historique undo/redo basé sur les transactions.
 *
 * Chaque entrée garde la transaction appliquée (forward) et son inverse exact.
 * Undo = appliquer l'inverse ; redo = réappliquer forward. Aucun instantané
 * complet du document n'est stocké : la mémoire reste proportionnelle aux
 * modifications, pas à la taille de la scène.
 */
import { executeTransaction } from './locks.ts';
import { applyTransaction, type Transaction } from './operations.ts';
import type { SceneDocument } from './types.ts';

export interface HistoryEntry {
  label: string;
  forward: Transaction;
  inverse: Transaction;
  /**
   * Deux commits consécutifs avec la même clé, rapprochés dans le temps, sont fusionnés
   * en une seule entrée (ex. glisser un sélecteur de couleur = un seul undo).
   */
  mergeKey?: string;
  time: number;
}

export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const MAX_HISTORY = 200;
export const MERGE_WINDOW_MS = 1000;

export const emptyHistory = (): History => ({ past: [], future: [] });

export type CommitResult =
  | { ok: true; doc: SceneDocument; history: History; changed: boolean }
  | { ok: false; error: string };

export interface CommitOptions {
  mergeKey?: string;
  now?: number;
}

export function commit(doc: SceneDocument, history: History, tx: Transaction, opts: CommitOptions = {}): CommitResult {
  if (tx.ops.length === 0) return { ok: true, doc, history, changed: false };

  const result = executeTransaction(doc, tx);
  if (!result.ok) return result;

  const now = opts.now ?? Date.now();
  const top = history.past[history.past.length - 1];
  let past: HistoryEntry[];
  if (opts.mergeKey && top && top.mergeKey === opts.mergeKey && now - top.time < MERGE_WINDOW_MS) {
    const merged: HistoryEntry = {
      label: top.label,
      forward: { label: top.label, ops: [...top.forward.ops, ...tx.ops] },
      inverse: { label: top.label, ops: [...result.inverse.ops, ...top.inverse.ops] },
      mergeKey: opts.mergeKey,
      time: now,
    };
    past = [...history.past.slice(0, -1), merged];
  } else {
    const entry: HistoryEntry = { label: tx.label, forward: tx, inverse: result.inverse, mergeKey: opts.mergeKey, time: now };
    past = [...history.past, entry].slice(-MAX_HISTORY);
  }
  return { ok: true, doc: result.doc, history: { past, future: [] }, changed: true };
}

export function undo(doc: SceneDocument, history: History): { doc: SceneDocument; history: History; entry: HistoryEntry } | null {
  const entry = history.past[history.past.length - 1];
  if (!entry) return null;
  const { doc: next } = applyTransaction(doc, entry.inverse);
  // Après un undo, le prochain commit ne doit pas fusionner avec l'entrée précédente.
  const past = history.past.slice(0, -1).map((e, i, arr) => (i === arr.length - 1 ? { ...e, mergeKey: undefined } : e));
  return {
    doc: next,
    history: { past, future: [entry, ...history.future] },
    entry,
  };
}

export function redo(doc: SceneDocument, history: History): { doc: SceneDocument; history: History; entry: HistoryEntry } | null {
  const [entry, ...rest] = history.future;
  if (!entry) return null;
  const { doc: next } = applyTransaction(doc, entry.forward);
  // L'entrée rejouée ne doit plus fusionner avec un commit ultérieur.
  const replayed: HistoryEntry = { ...entry, mergeKey: undefined };
  return { doc: next, history: { past: [...history.past, replayed], future: rest }, entry };
}
