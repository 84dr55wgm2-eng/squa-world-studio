/**
 * État de chargement des assets (non sauvegardé : c'est un état d'exécution).
 * L'interface et le viewport s'y abonnent par identifiant d'asset.
 */
import { create } from 'zustand';
import type { AssetId, Box } from '../core/index.ts';

export type AssetLoadStatus = 'loading' | 'ready' | 'error';

export interface AssetRuntimeInfo {
  status: AssetLoadStatus;
  /** Message affichable en cas d'erreur. */
  error?: string;
  /** Boîte englobante du modèle tel qu'il est dans le fichier (conservée même après libération). */
  nativeBox?: Box;
  meshCount?: number;
  triangleCount?: number;
  materialCount?: number;
  textureCount?: number;
  /** Octets téléchargés / lus. */
  byteSize?: number;
  /** Chargé, mais avec des ressources manquantes (textures…). */
  warning?: string;
  /** Nombre de chargements réseau/disque effectués pour cet asset (vérifie le cache). */
  loadCount: number;
}

export const useAssetStatus = create<{ byId: Record<AssetId, AssetRuntimeInfo> }>()(() => ({ byId: {} }));

export function setAssetStatus(id: AssetId, patch: Partial<AssetRuntimeInfo>): void {
  useAssetStatus.setState((s) => {
    const previous: AssetRuntimeInfo = s.byId[id] ?? { loadCount: 0, status: 'loading' };
    return { byId: { ...s.byId, [id]: { ...previous, ...patch } } };
  });
}

export const getAssetInfo = (id: AssetId): AssetRuntimeInfo | undefined => useAssetStatus.getState().byId[id];
