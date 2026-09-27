/** Chargement du manifest de la bibliothèque au démarrage (état d'interface, non sauvegardé). */
import { create } from 'zustand';
import { LIBRARY_MANIFEST_PATH, parseLibraryManifest, type AssetDefinition } from './manifest.ts';
import { appUrl } from './assetCache.ts';

interface LibraryState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  assets: AssetDefinition[];
  error?: string;
}

export const useLibrary = create<LibraryState>()(() => ({ status: 'idle', assets: [] }));

export async function loadLibrary(): Promise<void> {
  if (useLibrary.getState().status === 'loading') return;
  useLibrary.setState({ status: 'loading', error: undefined });
  try {
    const res = await fetch(appUrl(LIBRARY_MANIFEST_PATH), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseLibraryManifest(await res.json());
    parsed.warnings.forEach((w) => console.warn('[SQUA] Bibliothèque :', w));
    useLibrary.setState({ status: 'ready', assets: parsed.assets });
  } catch (e) {
    console.warn('[SQUA] Bibliothèque indisponible', e);
    useLibrary.setState({ status: 'error', assets: [], error: 'Bibliothèque de modèles indisponible pour le moment.' });
  }
}

export const findLibraryAsset = (id: string) => useLibrary.getState().assets.find((a) => a.id === id);
