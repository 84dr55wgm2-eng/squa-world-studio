/**
 * Manifest de la bibliothèque d'assets (TypeScript pur, testé sans navigateur).
 *
 * La bibliothèque est entièrement décrite par des données : ajouter un asset =
 * ajouter une entrée dans public/assets/library/library.json (voir docs/ASSETS.md),
 * sans toucher au code du viewport.
 */
import { isSemanticRole, type AssetLicense, type AssetRecord, type ModelPivot, type SemanticRole, type Vec3 } from '../core/index.ts';
import { isKnownCategory } from './categories.ts';

export const LIBRARY_FORMAT = 'squa-world-studio/asset-library';
/** Emplacement du manifest, relatif à la racine de l'application. */
export const LIBRARY_MANIFEST_PATH = 'assets/library/library.json';

export interface AssetDefinition {
  id: string;
  name: string;
  category: string;
  /** Relatif au dossier du manifest, ou URL absolue https://… (modèle distant). */
  modelUrl: string;
  thumbnailUrl?: string;
  tags: string[];
  /** Échelle appliquée à l'insertion (1 = taille du fichier). */
  defaultScale: number;
  pivot: ModelPivot;
  orientation: Vec3;
  unitScale: number;
  license?: AssetLicense;
  metadata: Record<string, unknown>;
  /** Rotation (degrés) appliquée à l'insertion. */
  defaultRotation: Vec3;
  /** Rôle sémantique des instances (ex. « furniture », « vehicle »). */
  semanticRole?: SemanticRole;
  /** Boîte englobante du fichier (unités du fichier, avant pivot et conversion d'unités). */
  bounds?: { min: Vec3; max: Vec3 };
  /** Statistiques mesurées hors ligne (scripts/measure-glb.py). */
  stats?: AssetStats;
}

export interface AssetStats {
  meshes: number;
  triangles: number;
  materials: number;
  textures: number;
  /** Octets. */
  fileSize: number;
}

export interface ParsedManifest {
  assets: AssetDefinition[];
  warnings: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec3 = (v: unknown): Vec3 | null => (Array.isArray(v) && v.length === 3 && v.every(num) ? [v[0], v[1], v[2]] : null);
const PIVOTS: ModelPivot[] = ['original', 'bottom-center', 'center'];

/**
 * .glb / .gltf, ou leur variante encodée en base64 « .glb.b64.txt » : utile sur les hébergements
 * qui refusent de servir les fichiers .glb (le contenu est identique, seul l'encodage change).
 */
export const MODEL_URL_PATTERN = /\.(glb|gltf)(\.b64\.txt)?(\?.*)?$/i;
export const isBase64ModelUrl = (url: string) => /\.b64\.txt(\?.*)?$/i.test(url);

export const isAbsoluteUrl = (u: string) => /^[a-z][a-z0-9+.-]*:/i.test(u);

/** Résout un chemin du manifest en chemin relatif à l'application (ou URL absolue inchangée). */
export function resolveManifestPath(path: string, manifestPath = LIBRARY_MANIFEST_PATH): string {
  if (isAbsoluteUrl(path) || path.startsWith('/')) return path;
  const dir = manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1);
  const parts = (dir + path).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

/**
 * Lit et valide un manifest. Une entrée invalide est ignorée avec un avertissement :
 * une erreur dans un asset ne doit pas priver l'utilisateur de toute la bibliothèque.
 */
export function parseLibraryManifest(input: unknown, manifestPath = LIBRARY_MANIFEST_PATH): ParsedManifest {
  const warnings: string[] = [];
  if (!isRecord(input) || input.format !== LIBRARY_FORMAT || !Array.isArray(input.assets)) {
    throw new Error("Ce fichier n'est pas un manifest de bibliothèque SQUA World Studio.");
  }
  if (input.version !== 1 && input.version !== 2) throw new Error(`Version de manifest non prise en charge : ${String(input.version)}`);
  const seen = new Set<string>();
  const assets: AssetDefinition[] = [];
  input.assets.forEach((raw, i) => {
    const where = `assets[${i}]`;
    if (!isRecord(raw) || !str(raw.id) || !str(raw.name) || !str(raw.modelUrl) || !str(raw.category)) {
      warnings.push(`${where} ignoré : id, name, category et modelUrl sont requis.`);
      return;
    }
    if (seen.has(raw.id)) {
      warnings.push(`${where} ignoré : identifiant dupliqué « ${raw.id} ».`);
      return;
    }
    if (!MODEL_URL_PATTERN.test(raw.modelUrl)) {
      warnings.push(`${where} ignoré : modelUrl doit pointer vers un .glb ou un .gltf.`);
      return;
    }
    if (!isKnownCategory(raw.category)) warnings.push(`${where} : catégorie inconnue « ${raw.category} » (classé dans « Autres »).`);
    seen.add(raw.id);
    const def: AssetDefinition = {
      id: raw.id,
      name: raw.name,
      category: raw.category,
      modelUrl: resolveManifestPath(raw.modelUrl, manifestPath),
      tags: Array.isArray(raw.tags) ? raw.tags.filter(str) : [],
      defaultScale: num(raw.defaultScale) && raw.defaultScale > 0 ? raw.defaultScale : 1,
      pivot: PIVOTS.includes(raw.pivot as ModelPivot) ? (raw.pivot as ModelPivot) : 'bottom-center',
      orientation:
        Array.isArray(raw.orientation) && raw.orientation.length === 3 && raw.orientation.every(num)
          ? [raw.orientation[0], raw.orientation[1], raw.orientation[2]]
          : [0, 0, 0],
      unitScale: num(raw.unitScale) && raw.unitScale > 0 ? raw.unitScale : 1,
      metadata: isRecord(raw.metadata) ? raw.metadata : {},
      defaultRotation: vec3(raw.defaultRotation) ?? [0, 0, 0],
    };
    if (isSemanticRole(raw.semanticRole)) def.semanticRole = raw.semanticRole;
    else if (raw.semanticRole !== undefined) warnings.push(`${where} : rôle sémantique inconnu « ${String(raw.semanticRole)} ».`);
    if (isRecord(raw.bounds)) {
      const min = vec3(raw.bounds.min), max = vec3(raw.bounds.max);
      if (min && max && min.every((v, k) => v <= max[k])) def.bounds = { min, max };
      else warnings.push(`${where} : boîte englobante invalide (ignorée, mesurée au chargement).`);
    }
    if (isRecord(raw.stats) && ['meshes', 'triangles', 'materials', 'textures', 'fileSize'].every((k) => num((raw.stats as Record<string, unknown>)[k]))) {
      def.stats = raw.stats as unknown as AssetStats;
    }
    if (str(raw.thumbnailUrl)) def.thumbnailUrl = resolveManifestPath(raw.thumbnailUrl, manifestPath);
    if (isRecord(raw.license) && str(raw.license.spdx) && str(raw.license.author)) {
      def.license = { spdx: raw.license.spdx, author: raw.license.author };
      if (str(raw.license.sourceUrl)) def.license.sourceUrl = raw.license.sourceUrl;
    } else {
      warnings.push(`${where} (« ${raw.name} ») : licence non renseignée.`);
    }
    assets.push(def);
  });
  return { assets, warnings };
}

/** Enregistrement de scène correspondant à un asset de la bibliothèque. */
export function libraryAssetRecord(def: AssetDefinition): AssetRecord {
  const record: AssetRecord = {
    id: `lib:${def.id}`,
    name: def.name,
    category: def.category,
    source: { kind: 'library', libraryId: def.id, modelUrl: def.modelUrl },
  };
  if (def.license) record.license = { ...def.license };
  if (def.bounds) record.bounds = { min: [...def.bounds.min], max: [...def.bounds.max] };
  if (def.semanticRole) record.semanticRole = def.semanticRole;
  return record;
}

export interface AssetFilter {
  category?: string;
  text?: string;
  tags?: string[];
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Filtre de la bibliothèque (prêt pour la recherche, les tags et les filtres à venir). */
export function filterAssets(defs: AssetDefinition[], filter: AssetFilter): AssetDefinition[] {
  const text = filter.text ? fold(filter.text.trim()) : '';
  return defs.filter((d) => {
    if (filter.category && d.category !== filter.category && !d.category.startsWith(filter.category + '.')) return false;
    if (filter.tags?.length && !filter.tags.every((t) => d.tags.includes(t))) return false;
    if (text && !fold([d.name, ...d.tags].join(' ')).includes(text)) return false;
    return true;
  });
}
