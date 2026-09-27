/**
 * Ce que la bibliothèque affiche : objets intégrés (primitives, lumières, caméras),
 * assets du manifest, et modèles importés présents dans la scène.
 * Une même fonction ajoute n'importe quelle entrée (clic ou glisser-déposer).
 */
import type { AssetRecord, SceneObjectType, Vec3 } from '../core/index.ts';
import { addObject, useEditor } from '../store/editorStore.ts';
import { getViewTargetOnGround } from '../viewport/cameraController.ts';
import { addAssetToScene, addLibraryAsset } from './assetActions.ts';
import { useLibrary } from './library.ts';
import type { AssetDefinition } from './manifest.ts';

export type LibraryEntry =
  | { key: string; kind: 'builtin'; name: string; category: string; type: Exclude<SceneObjectType, 'model'> }
  | { key: string; kind: 'library'; name: string; category: string; thumbnailUrl?: string; def: AssetDefinition }
  | { key: string; kind: 'scene'; name: string; category: string; record: AssetRecord };

export const BUILTIN_ENTRIES: LibraryEntry[] = [
  { key: 'builtin:box', kind: 'builtin', name: 'Cube', category: 'primitives', type: 'box' },
  { key: 'builtin:sphere', kind: 'builtin', name: 'Sphère', category: 'primitives', type: 'sphere' },
  { key: 'builtin:light', kind: 'builtin', name: 'Lumière ponctuelle', category: 'lights', type: 'light' },
  { key: 'builtin:camera', kind: 'builtin', name: 'Caméra', category: 'cameras', type: 'camera' },
];

/** Hauteur de pose des objets intégrés : posés sur le sol, lumière en hauteur, caméra à hauteur d'œil. */
const SPAWN_HEIGHT: Record<Exclude<SceneObjectType, 'model'>, number> = { box: 0.5, sphere: 0.5, light: 3, camera: 1.6 };

export const libraryEntry = (def: AssetDefinition): LibraryEntry => ({
  key: `library:${def.id}`,
  kind: 'library',
  name: def.name,
  category: def.category,
  thumbnailUrl: def.thumbnailUrl,
  def,
});

export const sceneEntry = (record: AssetRecord): LibraryEntry => ({
  key: `scene:${record.id}`,
  kind: 'scene',
  name: record.name,
  category: 'imported',
  record,
});

/** Retrouve une entrée à partir de sa clé (utilisé par le glisser-déposer). */
export function findEntry(key: string): LibraryEntry | undefined {
  const builtin = BUILTIN_ENTRIES.find((e) => e.key === key);
  if (builtin) return builtin;
  if (key.startsWith('library:')) {
    const def = useLibrary.getState().assets.find((a) => `library:${a.id}` === key);
    return def && libraryEntry(def);
  }
  if (key.startsWith('scene:')) {
    const record = useEditor.getState().doc.assets[key.slice('scene:'.length)];
    return record && sceneEntry(record);
  }
  return undefined;
}

export async function addEntry(entry: LibraryEntry, groundPoint?: Vec3): Promise<void> {
  switch (entry.kind) {
    case 'builtin': {
      const g = groundPoint ?? getViewTargetOnGround();
      addObject(entry.type, g ? [g[0], SPAWN_HEIGHT[entry.type], g[2]] : undefined);
      return;
    }
    case 'library':
      await addLibraryAsset(entry.def, groundPoint);
      return;
    case 'scene':
      await addAssetToScene(entry.record, { groundPoint });
      return;
  }
}

export const DRAG_MIME = 'application/x-squa-library-entry';
