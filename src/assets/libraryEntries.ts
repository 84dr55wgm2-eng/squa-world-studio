/**
 * Ce que la bibliothèque affiche : objets intégrés (primitives, lumières, caméras),
 * assets du manifest, et modèles importés présents dans la scène.
 * Une même fonction ajoute n'importe quelle entrée (clic ou glisser-déposer).
 */
import { SHAPES, addObjectTx, type AssetRecord, type ElementShape, type PrefabDefinition, type SceneObjectType, type Vec3 } from '../core/index.ts';
import { execute, useEditor } from '../store/editorStore.ts';
import { addElement, instantiatePrefab, withSurfaceSnap } from '../world/worldActions.ts';
import { findPrefab } from '../world/prefabStore.ts';
import { getViewTargetOnGround } from '../viewport/cameraController.ts';
import { addAssetToScene, addLibraryAsset } from './assetActions.ts';
import { useLibrary } from './library.ts';
import type { AssetDefinition } from './manifest.ts';

type BuiltinType = Exclude<SceneObjectType, 'model' | 'group' | 'element'>;

export type LibraryEntry =
  | { key: string; kind: 'builtin'; name: string; category: string; type: BuiltinType; tags: string[] }
  | { key: string; kind: 'element'; name: string; category: string; shape: ElementShape; tags: string[] }
  | { key: string; kind: 'prefab'; name: string; category: string; prefab: PrefabDefinition; tags: string[] }
  | { key: string; kind: 'library'; name: string; category: string; thumbnailUrl?: string; def: AssetDefinition; tags: string[] }
  | { key: string; kind: 'scene'; name: string; category: string; record: AssetRecord; tags: string[] };

export const BUILTIN_ENTRIES: LibraryEntry[] = [
  { key: 'builtin:box', kind: 'builtin', name: 'Cube', category: 'primitives', type: 'box', tags: ['cube', 'primitive'] },
  { key: 'builtin:sphere', kind: 'builtin', name: 'Sphère', category: 'primitives', type: 'sphere', tags: ['sphère', 'primitive'] },
  { key: 'builtin:light', kind: 'builtin', name: 'Lumière ponctuelle', category: 'lights', type: 'light', tags: ['lumière', 'éclairage'] },
  { key: 'builtin:camera', kind: 'builtin', name: 'Caméra', category: 'cameras', type: 'camera', tags: ['caméra', 'plan'] },
];

/** Éléments paramétriques (murs, sols, portes…) : générés par l'éditeur à partir de dimensions réelles. */
export const ELEMENT_ENTRIES: LibraryEntry[] = (Object.keys(SHAPES) as ElementShape[]).map((shape) => ({
  key: `element:${shape}`,
  kind: 'element',
  name: SHAPES[shape].label,
  category: SHAPES[shape].category,
  shape,
  tags: SHAPES[shape].tags,
}));

export const prefabEntry = (p: PrefabDefinition): LibraryEntry => ({ key: `prefab:${p.id}`, kind: 'prefab', name: p.name, category: 'prefabs', prefab: p, tags: p.tags });

/** Hauteur de pose des objets intégrés : posés sur le sol, lumière en hauteur, caméra à hauteur d'œil. */
const SPAWN_HEIGHT: Record<BuiltinType, number> = { box: 0.5, sphere: 0.5, light: 3, camera: 1.6 };

export const libraryEntry = (def: AssetDefinition): LibraryEntry => ({
  key: `library:${def.id}`,
  kind: 'library',
  name: def.name,
  category: def.category,
  thumbnailUrl: def.thumbnailUrl,
  def,
  tags: def.tags,
});

export const sceneEntry = (record: AssetRecord): LibraryEntry => ({
  key: `scene:${record.id}`,
  kind: 'scene',
  name: record.name,
  category: 'imported',
  record,
  tags: [],
});

/** Retrouve une entrée à partir de sa clé (utilisé par le glisser-déposer). */
export function findEntry(key: string): LibraryEntry | undefined {
  const builtin = [...BUILTIN_ENTRIES, ...ELEMENT_ENTRIES].find((e) => e.key === key);
  if (builtin) return builtin;
  if (key.startsWith('prefab:')) {
    const p = findPrefab(key.slice('prefab:'.length));
    return p && prefabEntry(p);
  }
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
      const doc = useEditor.getState().doc;
      const { tx, id } = addObjectTx(doc, entry.type, { position: g ? [g[0], SPAWN_HEIGHT[entry.type], g[2]] : undefined });
      execute(withSurfaceSnap(tx, doc, [id]), { select: id });
      return;
    }
    case 'element':
      addElement(entry.shape, groundPoint);
      return;
    case 'prefab':
      instantiatePrefab(entry.prefab.id, groundPoint);
      return;
    case 'library':
      await addLibraryAsset(entry.def, groundPoint);
      return;
    case 'scene':
      await addAssetToScene(entry.record, { groundPoint });
      return;
  }
}

export const DRAG_MIME = 'application/x-squa-library-entry';
