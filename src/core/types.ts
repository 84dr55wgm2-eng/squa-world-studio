/**
 * Modèle de données de SQUA World Studio.
 *
 * Ce fichier est du TypeScript pur : aucune dépendance à React ni à Three.js.
 * Tout ce qui est décrit ici est sérialisable tel quel en JSON — c'est la base
 * du format de fichier `.squa.json` (voir docs/SCENE_FORMAT.md).
 *
 * Conventions :
 * - unités : 1 unité = 1 mètre ; axe Y vers le haut (convention Three.js)
 * - rotations : angles d'Euler en DEGRÉS, ordre XYZ (lisible par un humain ou une IA)
 * - couleurs : chaînes hexadécimales "#rrggbb"
 */

export type Vec3 = [number, number, number];

export interface Transform {
  position: Vec3;
  /** Degrés, ordre d'Euler XYZ. */
  rotation: Vec3;
  scale: Vec3;
}

export type ObjectId = string;

/** Types d'objets réellement pris en charge par l'éditeur à ce stade. */
export type SceneObjectType = 'box' | 'sphere' | 'light' | 'camera' | 'model';

export interface MaterialProps {
  color: string;
}

export interface LightProps {
  /** Seul 'point' est implémenté pour l'instant. */
  kind: 'point';
  color: string;
  intensity: number;
  /** 0 = portée infinie. */
  distance: number;
}

export interface CameraProps {
  /** Champ de vision vertical, en degrés. */
  fov: number;
  near: number;
  far: number;
}

// ---------------------------------------------------------------------------
// Assets (modèles 3D)
// ---------------------------------------------------------------------------

export type AssetId = string;

/** Un fichier importé, identifié par l'empreinte SHA-256 de son contenu (dédoublonnage). */
export interface AssetFileRef {
  name: string;
  hash: string;
  size: number;
}

/**
 * D'où vient le modèle :
 * - `library` : asset de la bibliothèque (manifest). `modelUrl` est relatif à l'application
 *   (ex. "assets/library/chair/chair.glb") et sert de secours si le manifest change.
 * - `url` : modèle distant (doit autoriser le CORS).
 * - `file` : fichier(s) importé(s) par l'utilisateur. Les octets ne sont pas dans le document :
 *   ils sont stockés dans le navigateur et intégrés au fichier .squa.json à l'enregistrement.
 *   Un .gltf peut venir avec ses fichiers annexes (.bin, textures) : `files` les liste tous.
 */
export type AssetSource =
  | { kind: 'library'; libraryId: string; modelUrl: string }
  | { kind: 'url'; url: string }
  | { kind: 'file'; mainFile: string; files: AssetFileRef[] };

export interface AssetLicense {
  /** Identifiant SPDX, ex. "CC0-1.0", "CC-BY-4.0". */
  spdx: string;
  author: string;
  sourceUrl?: string;
}

/** Entrée de la table d'assets d'une scène, partagée par toutes les instances qui l'utilisent. */
export interface AssetRecord {
  id: AssetId;
  name: string;
  /** Identifiant de catégorie de la bibliothèque (ex. "props.furniture"), si connu. */
  category?: string;
  source: AssetSource;
  license?: AssetLicense;
}

export type ModelPivot = 'original' | 'bottom-center' | 'center';

/**
 * Réglages d'une instance de modèle. Ils sont non destructifs : le fichier d'origine n'est
 * jamais modifié, ces valeurs sont appliquées à l'affichage.
 */
export interface ModelProps {
  assetId: AssetId;
  /** Point de pivot de l'objet : celui du fichier, le centre bas de la boîte englobante, ou son centre. */
  pivot: ModelPivot;
  /** Correction d'orientation (degrés, XYZ), ex. [-90, 0, 0] pour un modèle « Z vers le haut ». */
  orientation: Vec3;
  /** Conversion d'unités du fichier vers le mètre (1 = m, 0.01 = cm, 0.001 = mm, 0.0254 = pouce). */
  unitScale: number;
  castShadow: boolean;
  receiveShadow: boolean;
}

interface SceneObjectBase {
  id: ObjectId;
  name: string;
  type: SceneObjectType;
  /** null = objet à la racine de la scène. */
  parentId: ObjectId | null;
  /** Ordre des enfants. Vide pour l'instant, mais géré partout par le cœur. */
  children: ObjectId[];
  transform: Transform;
  visible: boolean;
  /** Un objet verrouillé (ou dont un parent est verrouillé) ne peut être ni transformé, ni modifié, ni supprimé. */
  locked: boolean;
  tags: string[];
  /** Espace libre et sérialisable (ex. futures métadonnées IA : metadata.ai = {...}). */
  metadata: Record<string, unknown>;
}

export interface BoxObject extends SceneObjectBase {
  type: 'box';
  material: MaterialProps;
}

export interface SphereObject extends SceneObjectBase {
  type: 'sphere';
  material: MaterialProps;
}

export interface LightObject extends SceneObjectBase {
  type: 'light';
  light: LightProps;
}

export interface CameraObject extends SceneObjectBase {
  type: 'camera';
  camera: CameraProps;
}

export interface ModelObject extends SceneObjectBase {
  type: 'model';
  model: ModelProps;
}

export type SceneObject = BoxObject | SphereObject | LightObject | CameraObject | ModelObject;

export interface SceneSettings {
  background: string;
  ambientIntensity: number;
  /** Lumière directionnelle d'environnement (« soleil ») à direction fixe pour l'instant. */
  sunIntensity: number;
  /** Éclairage d'environnement neutre (reflets des matériaux PBR). 0 = désactivé. */
  environmentIntensity: number;
  /** Ombres portées du soleil. */
  shadows: boolean;
  gridVisible: boolean;
}

export interface ProjectInfo {
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SceneDocument {
  project: ProjectInfo;
  settings: SceneSettings;
  /** Ordre des objets racine (celui de la hiérarchie). */
  rootIds: ObjectId[];
  objects: Record<ObjectId, SceneObject>;
  /** Assets utilisés par les objets `model` (une entrée par asset, partagée par ses instances). */
  assets: Record<AssetId, AssetRecord>;
}

/**
 * Champs modifiables d'un objet via une opération `update`.
 * Chaque clé est remplacée en bloc (ex. `transform` complet, `material` complet),
 * ce qui garde les inverses (undo) triviaux et exacts.
 */
export interface ObjectChanges {
  name?: string;
  visible?: boolean;
  locked?: boolean;
  transform?: Transform;
  tags?: string[];
  metadata?: Record<string, unknown>;
  material?: MaterialProps;
  light?: LightProps;
  camera?: CameraProps;
  model?: ModelProps;
}

export type ObjectChangeKey = keyof ObjectChanges;
