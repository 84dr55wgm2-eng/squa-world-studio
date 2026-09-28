/**
 * Prefabs de l'utilisateur, conservés dans le navigateur (localStorage).
 * Un prefab = instantané d'un groupe (objets + assets référencés), réinstanciable partout.
 * Les prefabs intégrés (core/templates.ts) sont des scripts de commandes, non modifiables.
 */
import { create } from 'zustand';
import { BUILTIN_PREFABS, type PrefabDefinition } from '../core/index.ts';

const KEY = 'squa.prefabs.v1';

function read(): PrefabDefinition[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((p): p is PrefabDefinition => !!p && typeof p === 'object' && (p as PrefabDefinition).kind === 'snapshot' && Array.isArray((p as { objects?: unknown }).objects)) : [];
  } catch {
    return [];
  }
}

export const usePrefabs = create<{ user: PrefabDefinition[]; persistent: boolean }>()(() => ({ user: read(), persistent: true }));

function write(user: PrefabDefinition[]): void {
  let persistent = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(user));
  } catch {
    // Stockage indisponible ou plein : le prefab reste utilisable pendant la session.
    persistent = false;
  }
  usePrefabs.setState({ user, persistent });
}

export const allPrefabs = (): PrefabDefinition[] => [...BUILTIN_PREFABS, ...usePrefabs.getState().user];
export const findPrefab = (id: string) => allPrefabs().find((p) => p.id === id);
export const isUserPrefab = (id: string) => usePrefabs.getState().user.some((p) => p.id === id);

export function addUserPrefab(p: PrefabDefinition): boolean {
  write([...usePrefabs.getState().user.filter((x) => x.id !== p.id), p]);
  return usePrefabs.getState().persistent;
}

export function removeUserPrefab(id: string): void {
  write(usePrefabs.getState().user.filter((p) => p.id !== id));
}
