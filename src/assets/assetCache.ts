/**
 * Chargement et cache des modèles GLB / GLTF.
 *
 * - Un asset est chargé UNE fois (clé = identifiant d'asset), quel que soit le nombre
 *   d'instances : une duplication réutilise le modèle déjà en mémoire, sans réseau.
 * - Chaque instance est un clone qui PARTAGE géométries, matériaux et textures
 *   (SkeletonUtils.clone gère aussi les modèles à squelette).
 * - Compteur de références : quand plus aucune instance n'utilise un asset, ses
 *   ressources GPU sont libérées après un délai (un undo rapide ne recharge rien).
 * - Toute erreur (réseau, CORS, fichier corrompu, extension non prise en charge) est
 *   capturée et exposée comme état « error » : l'éditeur ne plante jamais.
 */
import { Box3, LoadingManager, type Material, type Mesh, type Object3D, type Texture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as MeshoptModule from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetId, AssetRecord, Box, Vec3 } from '../core/index.ts';
import { getAssetInfo, setAssetStatus } from './assetStatus.ts';
import { base64ToBlob, getFile } from './fileStore.ts';
import { isBase64ModelUrl } from './manifest.ts';

// Accès typé indépendamment de la version des définitions de types (réexport de « meshoptimizer »).
const MeshoptDecoder = (MeshoptModule as unknown as { MeshoptDecoder: Parameters<GLTFLoader['setMeshoptDecoder']>[0] }).MeshoptDecoder;

export const ASSET_LOAD_ERROR = 'Impossible de charger cet asset.';
const RELEASE_DELAY_MS = 60_000;

interface CacheEntry {
  promise: Promise<Object3D>;
  template?: Object3D;
  refs: number;
  releaseTimer?: ReturnType<typeof setTimeout>;
  blobUrls: string[];
}

const cache = new Map<AssetId, CacheEntry>();

/** URL absolue d'un chemin relatif à l'application (fonctionne à la racine d'un domaine comme dans un sous-dossier). */
export function appUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

class AssetLoadError extends Error {}

function explain(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/draco/i.test(msg)) return 'Modèle compressé avec Draco : format non pris en charge pour le moment.';
  if (/ktx2|basisu/i.test(msg)) return 'Textures KTX2 / Basis : format non pris en charge pour le moment.';
  if (/failed to fetch|networkerror|load failed|cors/i.test(msg)) return 'Fichier inaccessible (réseau indisponible ou partage CORS refusé par le serveur).';
  if (/404|not found/i.test(msg)) return 'Fichier introuvable à cette adresse (404).';
  if (error instanceof AssetLoadError) return msg;
  return `Fichier illisible : ${msg}`;
}

function nameOf(uri: string): string {
  const clean = decodeURIComponent(uri.split(/[?#]/)[0]);
  return clean.slice(clean.lastIndexOf('/') + 1);
}

async function loadRecord(record: AssetRecord, entry: CacheEntry): Promise<Object3D> {
  const manager = new LoadingManager();
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  const src = record.source;

  if (src.kind === 'library' || src.kind === 'url') {
    const url = src.kind === 'library' ? appUrl(src.modelUrl) : src.url;
    const res = await fetch(url);
    if (!res.ok) throw new AssetLoadError(`Fichier introuvable ou refusé par le serveur (HTTP ${res.status}).`);
    const buffer = isBase64ModelUrl(url) ? await base64ToBlob((await res.text()).trim()).arrayBuffer() : await res.arrayBuffer();
    const base = url.slice(0, url.lastIndexOf('/') + 1);
    return (await loader.parseAsync(buffer, base)).scene;
  }

  // Fichiers importés : on associe chaque nom de fichier à une URL blob locale.
  const blobs = new Map<string, string>();
  for (const f of src.files) {
    const blob = await getFile(f.hash);
    if (!blob) {
      throw new AssetLoadError(
        `Le fichier « ${f.name} » n'est plus disponible dans ce navigateur. Rouvrez le fichier .squa.json enregistré ou réimportez le modèle.`,
      );
    }
    const url = URL.createObjectURL(blob);
    entry.blobUrls.push(url);
    blobs.set(f.name, url);
  }
  manager.setURLModifier((url) => blobs.get(nameOf(url)) ?? url);
  const main = src.files.find((f) => f.name === src.mainFile)!;
  const buffer = await (await getFile(main.hash))!.arrayBuffer();
  const data = /\.gltf$/i.test(main.name) ? new TextDecoder().decode(buffer) : buffer;
  return (await loader.parseAsync(data, '')).scene;
}

/** Prépare le modèle chargé : retire lumières et caméras embarquées, mesure la boîte d'origine. */
function prepareTemplate(root: Object3D): { nativeBox: Box; meshCount: number; triangleCount: number } {
  const embedded: Object3D[] = [];
  let meshCount = 0;
  let triangleCount = 0;
  root.traverse((o) => {
    if ((o as { isLight?: boolean }).isLight || (o as { isCamera?: boolean }).isCamera) embedded.push(o);
    const mesh = o as Mesh;
    if (mesh.isMesh) {
      meshCount++;
      const g = mesh.geometry;
      triangleCount += (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;
    }
  });
  // Les lumières d'un fichier ne doivent pas éclairer la scène à l'insu de l'utilisateur.
  embedded.forEach((o) => o.removeFromParent());
  root.updateMatrixWorld(true);
  const b = new Box3().setFromObject(root);
  const nativeBox: Box = b.isEmpty()
    ? { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }
    : { min: b.min.toArray() as Vec3, max: b.max.toArray() as Vec3 };
  return { nativeBox, meshCount, triangleCount: Math.round(triangleCount) };
}

/** Réserve un asset (le charge si nécessaire). À appeler une fois par instance affichée. */
export function acquireAsset(record: AssetRecord): Promise<Object3D> {
  let entry = cache.get(record.id);
  if (entry) {
    entry.refs++;
    if (entry.releaseTimer) {
      clearTimeout(entry.releaseTimer);
      entry.releaseTimer = undefined;
    }
    return entry.promise;
  }
  const newEntry: CacheEntry = { refs: 1, blobUrls: [], promise: Promise.resolve(null as never) };
  entry = newEntry;
  cache.set(record.id, entry);
  setAssetStatus(record.id, { status: 'loading', error: undefined, loadCount: (getAssetInfo(record.id)?.loadCount ?? 0) + 1 });
  entry.promise = loadRecord(record, newEntry).then(
    (root) => {
      const info = prepareTemplate(root);
      newEntry.template = root;
      setAssetStatus(record.id, { status: 'ready', ...info });
      return root;
    },
    (error) => {
      console.warn(`[SQUA] ${ASSET_LOAD_ERROR}`, record.name, error);
      setAssetStatus(record.id, { status: 'error', error: explain(error) });
      // Un asset en erreur n'est pas gardé en cache : on pourra réessayer (réimport, réseau revenu…).
      newEntry.blobUrls.forEach((u) => URL.revokeObjectURL(u));
      if (cache.get(record.id) === newEntry) cache.delete(record.id);
      throw error;
    },
  );
  entry.promise.catch(() => {});
  return entry.promise;
}

/** Libère une réservation. Les ressources sont détruites après un délai si plus personne ne les utilise. */
export function releaseAsset(id: AssetId): void {
  const entry = cache.get(id);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs > 0 || entry.releaseTimer) return;
  entry.releaseTimer = setTimeout(() => {
    if (entry.refs > 0 || cache.get(id) !== entry) return;
    cache.delete(id);
    if (entry.template) disposeObject(entry.template);
    entry.blobUrls.forEach((u) => URL.revokeObjectURL(u));
  }, RELEASE_DELAY_MS);
}

/** Crée une instance indépendante (transform propre) qui partage les ressources GPU du modèle. */
export function instantiate(template: Object3D): Object3D {
  return cloneSkinned(template);
}

/** Précharge un asset sans le garder (ex. pour mesurer sa taille avant de le placer). */
export async function measureAsset(record: AssetRecord): Promise<Box> {
  try {
    await acquireAsset(record);
    return getAssetInfo(record.id)!.nativeBox!;
  } finally {
    releaseAsset(record.id);
  }
}

function disposeObject(root: Object3D): void {
  const textures = new Set<Texture>();
  const materials = new Set<Material>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      materials.add(m);
      for (const value of Object.values(m)) if ((value as Texture)?.isTexture) textures.add(value as Texture);
    }
  });
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
}

/** Pour les tests et le diagnostic : nombre d'assets actuellement en mémoire. */
export const cachedAssetCount = () => cache.size;
