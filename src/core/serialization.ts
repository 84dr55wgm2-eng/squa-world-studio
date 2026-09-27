/**
 * Format de fichier SQUA World Studio (`.squa.json`).
 *
 * Voir docs/SCENE_FORMAT.md pour la description complète.
 * Le chargement est défensif : le fichier est validé champ par champ, les valeurs
 * manquantes non essentielles reçoivent leur défaut (avec un avertissement), et
 * toute incohérence structurelle (identifiants dupliqués, hiérarchie cassée…)
 * provoque un refus clair plutôt qu'une scène à moitié chargée.
 */
import { DEFAULT_SETTINGS, createObject } from './factory.ts';
import type {
  AssetId,
  AssetRecord,
  AssetSource,
  ModelProps,
  ObjectId,
  SceneDocument,
  SceneObject,
  SceneObjectType,
  SceneSettings,
  Transform,
  Vec3,
} from './types.ts';
import { getAllIdsInOrder } from './scene.ts';

export const SCENE_FORMAT = 'squa-world-studio/scene';
export const SCENE_FORMAT_VERSION = 2;
export const SCENE_FILE_EXTENSION = '.squa.json';

/** Contenu d'un fichier importé, intégré au .squa.json pour que la scène soit transportable. */
export interface EmbeddedFile {
  name: string;
  size: number;
  /** Contenu encodé en base64. */
  data: string;
}

export interface SceneFileV2 {
  format: typeof SCENE_FORMAT;
  version: 2;
  savedAt: string;
  project: SceneDocument['project'];
  settings: SceneSettings;
  rootIds: ObjectId[];
  /** Objets dans l'ordre de la hiérarchie (parents avant enfants). */
  objects: SceneObject[];
  /** Assets réellement utilisés par les objets. */
  assets: AssetRecord[];
  /** Fichiers importés, indexés par empreinte SHA-256 (seulement ceux des assets `file`). */
  files?: Record<string, EmbeddedFile>;
}

/** Empreintes des fichiers importés utilisés par la scène (à intégrer lors d'un enregistrement). */
export function referencedFileHashes(doc: SceneDocument): string[] {
  const used = new Set(Object.values(doc.objects).flatMap((o) => (o.type === 'model' ? [o.model.assetId] : [])));
  const hashes = new Set<string>();
  for (const id of used) {
    const src = doc.assets[id]?.source;
    if (src?.kind === 'file') src.files.forEach((f) => hashes.add(f.hash));
  }
  return [...hashes];
}

export function serializeDocument(doc: SceneDocument, now = new Date(), files?: Record<string, EmbeddedFile>): SceneFileV2 {
  const savedAt = now.toISOString();
  // Seuls les assets encore utilisés sont écrits (un asset retiré de la scène disparaît du fichier).
  const usedAssetIds = [...new Set(getAllIdsInOrder(doc).flatMap((id) => {
    const o = doc.objects[id];
    return o.type === 'model' ? [o.model.assetId] : [];
  }))];
  const file: SceneFileV2 = {
    format: SCENE_FORMAT,
    version: SCENE_FORMAT_VERSION,
    savedAt,
    project: { ...doc.project, updatedAt: savedAt },
    settings: { ...doc.settings },
    rootIds: [...doc.rootIds],
    objects: getAllIdsInOrder(doc).map((id) => structuredClone(doc.objects[id])),
    assets: usedAssetIds.filter((id) => doc.assets[id]).map((id) => structuredClone(doc.assets[id])),
  };
  if (files && Object.keys(files).length > 0) file.files = files;
  return file;
}

export function documentToJson(doc: SceneDocument, now = new Date(), files?: Record<string, EmbeddedFile>): string {
  return JSON.stringify(serializeDocument(doc, now, files), null, 2);
}

export type ParseResult =
  | { ok: true; doc: SceneDocument; warnings: string[]; files: Record<string, EmbeddedFile> }
  | { ok: false; error: string };

class InvalidFile extends Error {}

const KNOWN_TYPES: SceneObjectType[] = ['box', 'sphere', 'light', 'camera', 'model'];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

function readVec3(v: unknown, where: string): Vec3 {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isFiniteNumber)) {
    throw new InvalidFile(`${where} : un tableau de 3 nombres est attendu.`);
  }
  return [v[0], v[1], v[2]];
}

function readTransform(v: unknown, where: string): Transform {
  if (!isRecord(v)) throw new InvalidFile(`${where} : transform manquant.`);
  return {
    position: readVec3(v.position, `${where}.position`),
    rotation: readVec3(v.rotation, `${where}.rotation`),
    scale: readVec3(v.scale, `${where}.scale`),
  };
}

/** Fusionne des propriétés spécifiques lues dans le fichier avec leurs valeurs par défaut, en vérifiant les types. */
function mergeProps<T extends object>(defaults: T, raw: unknown, where: string, warnings: string[]): T {
  const out = { ...defaults } as Record<string, unknown>;
  if (raw === undefined) {
    warnings.push(`${where} absent : valeurs par défaut utilisées.`);
    return out as T;
  }
  if (!isRecord(raw)) throw new InvalidFile(`${where} : objet attendu.`);
  for (const [key, def] of Object.entries(defaults)) {
    const value = raw[key];
    if (value === undefined) continue;
    const valid =
      typeof def === 'number' ? isFiniteNumber(value) : key === 'color' ? isHexColor(value) : typeof value === typeof def;
    if (!valid) throw new InvalidFile(`${where}.${key} : valeur invalide.`);
    out[key] = value;
  }
  return out as T;
}

function readObject(raw: unknown, index: number, warnings: string[]): SceneObject {
  const where = `objects[${index}]`;
  if (!isRecord(raw)) throw new InvalidFile(`${where} : objet attendu.`);
  if (typeof raw.id !== 'string' || raw.id.length === 0) throw new InvalidFile(`${where}.id manquant.`);
  if (typeof raw.type !== 'string' || !KNOWN_TYPES.includes(raw.type as SceneObjectType)) {
    throw new InvalidFile(`${where} : type « ${String(raw.type)} » non pris en charge par cette version.`);
  }
  const type = raw.type as SceneObjectType;
  const defaults = createObject(type, { id: raw.id });

  const obj: SceneObject = {
    ...defaults,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : defaults.name,
    parentId: raw.parentId === null || raw.parentId === undefined ? null : String(raw.parentId),
    children: Array.isArray(raw.children) ? raw.children.map(String) : [],
    transform: readTransform(raw.transform, where),
    visible: typeof raw.visible === 'boolean' ? raw.visible : true,
    locked: typeof raw.locked === 'boolean' ? raw.locked : false,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
    metadata: isRecord(raw.metadata) ? structuredClone(raw.metadata) : {},
  };

  switch (obj.type) {
    case 'box':
    case 'sphere':
      obj.material = mergeProps(obj.material, raw.material, `${where}.material`, warnings);
      break;
    case 'light':
      obj.light = mergeProps(obj.light, raw.light, `${where}.light`, warnings);
      if (obj.light.kind !== 'point') throw new InvalidFile(`${where}.light.kind non pris en charge.`);
      break;
    case 'camera':
      obj.camera = mergeProps(obj.camera, raw.camera, `${where}.camera`, warnings);
      break;
    case 'model':
      obj.model = readModelProps(raw.model, `${where}.model`);
      break;
  }
  return obj;
}

const PIVOTS: ModelProps['pivot'][] = ['original', 'bottom-center', 'center'];

function readModelProps(raw: unknown, where: string): ModelProps {
  if (!isRecord(raw)) throw new InvalidFile(`${where} manquant.`);
  if (typeof raw.assetId !== 'string' || !raw.assetId) throw new InvalidFile(`${where}.assetId manquant.`);
  const d = createObject('model', { model: { assetId: raw.assetId } });
  const m = d.type === 'model' ? d.model : (undefined as never);
  if (raw.pivot !== undefined) {
    if (!PIVOTS.includes(raw.pivot as ModelProps['pivot'])) throw new InvalidFile(`${where}.pivot invalide.`);
    m.pivot = raw.pivot as ModelProps['pivot'];
  }
  if (raw.orientation !== undefined) m.orientation = readVec3(raw.orientation, `${where}.orientation`);
  if (raw.unitScale !== undefined) {
    if (!isFiniteNumber(raw.unitScale) || raw.unitScale <= 0) throw new InvalidFile(`${where}.unitScale invalide.`);
    m.unitScale = raw.unitScale;
  }
  for (const k of ['castShadow', 'receiveShadow'] as const) {
    if (raw[k] !== undefined) {
      if (typeof raw[k] !== 'boolean') throw new InvalidFile(`${where}.${k} invalide.`);
      m[k] = raw[k];
    }
  }
  return m;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function readAssetSource(raw: unknown, where: string): AssetSource {
  if (!isRecord(raw)) throw new InvalidFile(`${where} manquant.`);
  switch (raw.kind) {
    case 'library':
      if (!isNonEmptyString(raw.libraryId) || !isNonEmptyString(raw.modelUrl)) throw new InvalidFile(`${where} : libraryId et modelUrl requis.`);
      return { kind: 'library', libraryId: raw.libraryId, modelUrl: raw.modelUrl };
    case 'url':
      if (!isNonEmptyString(raw.url)) throw new InvalidFile(`${where}.url manquant.`);
      return { kind: 'url', url: raw.url };
    case 'file': {
      if (!isNonEmptyString(raw.mainFile) || !Array.isArray(raw.files) || raw.files.length === 0) {
        throw new InvalidFile(`${where} : mainFile et files requis.`);
      }
      const files = raw.files.map((f, i) => {
        if (!isRecord(f) || !isNonEmptyString(f.name) || !isNonEmptyString(f.hash) || !isFiniteNumber(f.size)) {
          throw new InvalidFile(`${where}.files[${i}] invalide.`);
        }
        return { name: f.name, hash: f.hash, size: f.size };
      });
      if (!files.some((f) => f.name === raw.mainFile)) throw new InvalidFile(`${where} : fichier principal absent de la liste.`);
      return { kind: 'file', mainFile: raw.mainFile, files };
    }
    default:
      throw new InvalidFile(`${where}.kind inconnu.`);
  }
}

function readAssets(raw: unknown): Record<AssetId, AssetRecord> {
  if (!Array.isArray(raw)) throw new InvalidFile('Liste « assets » manquante.');
  const out: Record<AssetId, AssetRecord> = {};
  raw.forEach((a, i) => {
    const where = `assets[${i}]`;
    if (!isRecord(a) || !isNonEmptyString(a.id) || !isNonEmptyString(a.name)) throw new InvalidFile(`${where} : id et name requis.`);
    if (out[a.id]) throw new InvalidFile(`Asset dupliqué : ${a.id}`);
    const record: AssetRecord = { id: a.id, name: a.name, source: readAssetSource(a.source, `${where}.source`) };
    if (typeof a.category === 'string') record.category = a.category;
    if (isRecord(a.license) && isNonEmptyString(a.license.spdx) && typeof a.license.author === 'string') {
      record.license = { spdx: a.license.spdx, author: a.license.author };
      if (typeof a.license.sourceUrl === 'string') record.license.sourceUrl = a.license.sourceUrl;
    }
    out[a.id] = record;
  });
  return out;
}

function readEmbeddedFiles(raw: unknown): Record<string, EmbeddedFile> {
  if (raw === undefined) return {};
  if (!isRecord(raw)) throw new InvalidFile('« files » invalide.');
  const out: Record<string, EmbeddedFile> = {};
  for (const [hash, f] of Object.entries(raw)) {
    if (!isRecord(f) || !isNonEmptyString(f.name) || !isFiniteNumber(f.size) || typeof f.data !== 'string') {
      throw new InvalidFile(`Fichier intégré invalide : ${hash}`);
    }
    out[hash] = { name: f.name, size: f.size, data: f.data };
  }
  return out;
}

function readSettings(raw: unknown, warnings: string[]): SceneSettings {
  if (raw === undefined) {
    warnings.push('settings absent : réglages par défaut utilisés.');
    return { ...DEFAULT_SETTINGS };
  }
  return mergeProps(DEFAULT_SETTINGS, raw, 'settings', warnings);
}

/** Vérifie que parentId / children / rootIds décrivent un arbre cohérent, sans cycle. */
function checkHierarchy(doc: SceneDocument): void {
  const seen = new Set<ObjectId>();
  const visit = (id: ObjectId, expectedParent: ObjectId | null) => {
    const obj = doc.objects[id];
    if (!obj) throw new InvalidFile(`Hiérarchie : objet référencé introuvable (${id}).`);
    if (seen.has(id)) throw new InvalidFile(`Hiérarchie : objet référencé deux fois ou cycle (${id}).`);
    if (obj.parentId !== expectedParent) throw new InvalidFile(`Hiérarchie : parent incohérent pour ${id}.`);
    seen.add(id);
    for (const child of obj.children) visit(child, id);
  };
  for (const id of doc.rootIds) visit(id, null);
  const orphans = Object.keys(doc.objects).filter((id) => !seen.has(id));
  if (orphans.length > 0) throw new InvalidFile(`Hiérarchie : ${orphans.length} objet(s) non rattaché(s) à la scène.`);
}

/** Migrations successives du format : chaque étape fait passer d'une version à la suivante. */
function migrate(raw: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const version = raw.version;
  if (!isFiniteNumber(version)) throw new InvalidFile('Version de format manquante.');
  if (version > SCENE_FORMAT_VERSION) {
    throw new InvalidFile(`Ce fichier a été créé par une version plus récente (format v${version}).`);
  }
  let data = raw;
  if (data.version === 1) {
    // v1 → v2 : apparition de la table d'assets (modèles 3D) et des réglages d'environnement / ombres.
    data = { ...data, version: 2, assets: [] };
    warnings.push('Scène au format v1 convertie au format v2.');
  }
  return data;
}

export function parseSceneFile(input: string | unknown): ParseResult {
  const warnings: string[] = [];
  try {
    let raw: unknown = input;
    if (typeof input === 'string') {
      try {
        raw = JSON.parse(input);
      } catch {
        throw new InvalidFile("Le fichier n'est pas un JSON valide.");
      }
    }
    if (!isRecord(raw)) throw new InvalidFile('Contenu inattendu.');
    if (raw.format !== SCENE_FORMAT) throw new InvalidFile("Ce fichier n'est pas une scène SQUA World Studio.");
    const data = migrate(raw, warnings);

    const project = isRecord(data.project) ? data.project : {};
    const now = new Date().toISOString();
    if (!Array.isArray(data.objects)) throw new InvalidFile('Liste « objects » manquante.');
    if (!Array.isArray(data.rootIds)) throw new InvalidFile('Liste « rootIds » manquante.');

    const assets = readAssets(data.assets);
    const objects: Record<ObjectId, SceneObject> = {};
    data.objects.forEach((rawObj, i) => {
      const obj = readObject(rawObj, i, warnings);
      if (objects[obj.id]) throw new InvalidFile(`Identifiant dupliqué : ${obj.id}`);
      objects[obj.id] = obj;
    });

    const doc: SceneDocument = {
      project: {
        name: typeof project.name === 'string' && project.name.trim() ? project.name : 'Sans titre',
        createdAt: typeof project.createdAt === 'string' ? project.createdAt : now,
        updatedAt: typeof project.updatedAt === 'string' ? project.updatedAt : now,
      },
      settings: readSettings(data.settings, warnings),
      rootIds: data.rootIds.map(String),
      objects,
      assets,
    };
    checkHierarchy(doc);
    for (const o of Object.values(objects)) {
      if (o.type === 'model' && !assets[o.model.assetId]) throw new InvalidFile(`« ${o.name} » référence un asset absent du fichier (${o.model.assetId}).`);
    }
    return { ok: true, doc, warnings, files: readEmbeddedFiles(data.files) };
  } catch (e) {
    if (e instanceof InvalidFile) return { ok: false, error: e.message };
    throw e;
  }
}
