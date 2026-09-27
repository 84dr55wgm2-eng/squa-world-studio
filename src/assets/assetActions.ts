/**
 * Ajout de modèles à la scène : bibliothèque, fichiers importés, URL.
 *
 * Toutes les voies aboutissent au même endroit : un AssetRecord + `addModelTx`
 * (le même système d'objets, d'undo et de verrou que le reste de l'éditeur).
 */
import {
  addModelTx,
  boxSize,
  groundedY,
  normalizeModel,
  type AssetRecord,
  type ModelProps,
  type Vec3,
} from '../core/index.ts';
import { execute, notify, useEditor } from '../store/editorStore.ts';
import { frameObject, getViewTargetOnGround } from '../viewport/cameraController.ts';
import { ASSET_LOAD_ERROR, measureAsset } from './assetCache.ts';
import { getAssetInfo } from './assetStatus.ts';
import { hashBytes, putFile } from './fileStore.ts';
import { libraryAssetRecord, type AssetDefinition } from './manifest.ts';

export interface PlaceOptions {
  /** Point du sol visé (dépôt glisser-déposer). Par défaut : le centre de la vue. */
  groundPoint?: Vec3;
  scale?: number;
  model?: Partial<Omit<ModelProps, 'assetId'>>;
  /** Recadre la vue sur le nouvel objet (utile pour un modèle importé de taille inconnue). */
  frame?: boolean;
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Charge l'asset (ou le reprend du cache), calcule une position posée au sol devant la
 * caméra, puis ajoute l'instance. Renvoie l'id du nouvel objet, ou null en cas d'échec.
 */
export async function addAssetToScene(record: AssetRecord, opts: PlaceOptions = {}): Promise<string | null> {
  let nativeBox;
  try {
    nativeBox = await measureAsset(record);
  } catch {
    notify('error', `${ASSET_LOAD_ERROR} ${getAssetInfo(record.id)?.error ?? ''}`.trim());
    return null;
  }
  const model = { pivot: 'bottom-center' as const, orientation: [0, 0, 0] as Vec3, unitScale: 1, ...opts.model };
  const s = opts.scale ?? 1;
  const scale: Vec3 = [s, s, s];
  const ground = opts.groundPoint ?? getViewTargetOnGround() ?? [0, 0, 0];
  const { localBox } = normalizeModel(nativeBox, model);
  // Jamais sous le sol : le point le plus bas du modèle est posé sur Y = 0.
  const y = groundedY(localBox, { position: [0, 0, 0], rotation: [0, 0, 0], scale });
  const position: Vec3 = [round(ground[0]), round(y), round(ground[2])];

  const doc = useEditor.getState().doc;
  const { tx, id } = addModelTx(doc, doc.assets[record.id] ?? record, { position, scale, model });
  if (!execute(tx, { select: id })) return null;

  const size = boxSize(localBox).map((v) => v * s);
  const largest = Math.max(...size);
  if (largest > 200 || largest < 0.02) {
    notify('info', `Dimensions inhabituelles (${largest.toFixed(largest < 1 ? 3 : 0)} m) : vérifiez l'unité du fichier dans les propriétés.`);
  }
  if (opts.frame) setTimeout(() => frameObject(id), 50);
  return id;
}

export function addLibraryAsset(def: AssetDefinition, groundPoint?: Vec3) {
  return addAssetToScene(libraryAssetRecord(def), {
    groundPoint,
    scale: def.defaultScale,
    model: { pivot: def.pivot, orientation: [...def.orientation], unitScale: def.unitScale },
  });
}

const MODEL_EXT = /\.(glb|gltf)$/i;
const MAX_FILE_BYTES = 200 * 1024 * 1024;

/**
 * Importe un modèle depuis des fichiers locaux. Accepte un .glb seul, ou un .gltf
 * accompagné de ses fichiers annexes (.bin, textures) sélectionnés en même temps.
 */
export async function importModelFiles(fileList: FileList | File[], groundPoint?: Vec3): Promise<void> {
  const files = [...fileList];
  const mains = files.filter((f) => MODEL_EXT.test(f.name));
  if (mains.length === 0) {
    notify('error', 'Aucun fichier .glb ou .gltf dans la sélection.');
    return;
  }
  if (files.some((f) => f.size > MAX_FILE_BYTES)) {
    notify('error', 'Fichier trop volumineux (200 Mo maximum).');
    return;
  }
  const extras = files.filter((f) => !MODEL_EXT.test(f.name));
  for (const main of mains) {
    // Un .glb est autonome ; un .gltf emporte les fichiers annexes sélectionnés avec lui.
    const bundle = /\.gltf$/i.test(main.name) ? [main, ...extras] : [main];
    const refs = [];
    for (const f of bundle) {
      const buffer = await f.arrayBuffer();
      const hash = await hashBytes(buffer);
      await putFile(hash, new Blob([buffer]));
      refs.push({ name: f.name, hash, size: f.size });
    }
    const record: AssetRecord = {
      id: `file:${refs[0].hash.slice(0, 24)}`,
      name: main.name.replace(MODEL_EXT, ''),
      source: { kind: 'file', mainFile: main.name, files: refs },
    };
    await addAssetToScene(record, { groundPoint, frame: true });
  }
}

/** Ajoute un modèle distant (le serveur doit autoriser le partage CORS). */
export async function importModelUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    notify('error', 'Adresse invalide. Exemple : https://exemple.org/modele.glb');
    return;
  }
  if (!/^https?:$/.test(url.protocol) || !MODEL_EXT.test(url.pathname)) {
    notify('error', "L'adresse doit commencer par https:// et se terminer par .glb ou .gltf.");
    return;
  }
  const hash = await hashBytes(new TextEncoder().encode(url.href).buffer as ArrayBuffer);
  const name = decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/') + 1)).replace(MODEL_EXT, '');
  await addAssetToScene({ id: `url:${hash.slice(0, 24)}`, name, source: { kind: 'url', url: url.href } }, { frame: true });
}
