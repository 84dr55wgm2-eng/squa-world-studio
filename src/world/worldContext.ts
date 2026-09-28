/**
 * Contexte du moteur de placement / de validation / des commandes dans l'application :
 * relie le cœur pur aux données d'exécution (boîtes mesurées au chargement, bibliothèque,
 * prefabs, état de chargement des assets).
 *
 * Priorité des boîtes d'un modèle : mesure réelle au chargement > boîte enregistrée dans la
 * scène > boîte du manifest de la bibliothèque.
 */
import type { SceneDocument, ValidationContext, WorldContext } from '../core/index.ts';
import { getAssetInfo } from '../assets/assetStatus.ts';
import { useLibrary } from '../assets/library.ts';
import { libraryAssetRecord } from '../assets/manifest.ts';
import { findPrefab } from './prefabStore.ts';

const libraryDef = (id: string) => {
  const key = id.startsWith('lib:') ? id.slice(4) : id;
  return useLibrary.getState().assets.find((a) => a.id === key);
};

export function worldContext(doc: SceneDocument): WorldContext & ValidationContext {
  return {
    nativeModelBox: (id) => getAssetInfo(id)?.nativeBox ?? doc.assets[id]?.bounds ?? libraryDef(id)?.bounds,
    assetLoadState: (id) => getAssetInfo(id)?.status,
    resolveAsset: (id) => {
      const def = libraryDef(id);
      return def ? libraryAssetRecord(def) : doc.assets[id];
    },
    assetDefaults: (id) => {
      const def = libraryDef(id);
      return def && { model: { pivot: def.pivot, orientation: [...def.orientation], unitScale: def.unitScale }, scale: def.defaultScale, rotation: [...def.defaultRotation] };
    },
    resolvePrefab: findPrefab,
  };
}
