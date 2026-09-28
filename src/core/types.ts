/**
 * Modèle de données de SQUA World Studio.
 *
 * Ce fichier est du TypeScript pur : aucune dépendance à React ni à Three.js.
 * Tout ce qui est décrit ici est sérialisable tel quel en JSON — c'est la base
 * du format de fichier `.squa` (voir docs/SCENE_FORMAT.md).
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
export type SceneObjectType = 'box' | 'sphere' | 'light' | 'camera' | 'model' | 'group' | 'element';

/**
 * Rôle sémantique : ce que l'objet EST dans le monde (et pas sa forme).
 * Stocké dans les données de scène : le moteur de placement, le validateur et plus tard
 * l'IA raisonnent sur ce rôle (« une porte appartient à un mur », « une voiture roule sur une route »).
 */
export type SemanticRole =
  | 'building'
  | 'wall'
  | 'floor'
  | 'ceiling'
  | 'door'
  | 'window'
  | 'stairs'
  | 'road'
  | 'sidewalk'
  | 'barrier'
  | 'furniture'
  | 'vehicle'
  | 'vegetation'
  | 'prop'
  | 'electronics'
  | 'light'
  | 'camera'
  | 'character'
  | 'room'
  | 'group';

/** Ce sur quoi un objet doit reposer. */
export type SupportKind = 'ground' | 'surface' | 'wall' | 'ceiling' | 'none';

/**
 * Règles de placement d'un objet (surcharge éventuelle des règles par défaut de son rôle,
 * définies dans core/semantics.ts).
 */
export interface PlacementRules {
  support?: SupportKind;
  /** Peut flotter sans support (lampe suspendue, caméra, lumière…). */
  allowFloating?: boolean;
  /** Rôles avec lesquels un chevauchement est normal (ex. porte ↔ mur, mur ↔ mur aux angles). */
  allowOverlapWith?: SemanticRole[];
}

export type RelationType = 'ON' | 'INSIDE' | 'NEXT_TO' | 'AGAINST' | 'CENTERED_IN' | 'FACING' | 'ATTACHED_TO' | 'ALONG';

/** Dernière relation spatiale utilisée pour placer l'objet (trace exploitable par l'IA). */
export interface RelationRecord {
  type: RelationType;
  targetId: string;
  params?: Record<string, number | string | boolean>;
}

/** Provenance d'un objet. */
export interface ObjectSource {
  kind: 'user' | 'template' | 'prefab' | 'composer' | 'import' | 'ai';
  /** Identifiant du modèle de scène, du prefab, de la commande… */
  ref?: string;
}

/** Matériau PBR simple (métal / rugosité). */
export interface MaterialProps {
  color: string;
  roughness: number;
  metalness: number;
  /** 1 = opaque. */
  opacity: number;
}

/**
 * Surcharge de matériau appliquée à toutes les surfaces d'un modèle importé.
 * Les matériaux d'origine du fichier ne sont jamais modifiés : retirer la surcharge les restaure.
 */
export type MaterialOverride = Partial<MaterialProps>;

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
 *   ils sont stockés dans le navigateur et intégrés au fichier .squa à l'enregistrement.
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
  /**
   * Boîte englobante du fichier d'origine (mètres, avant pivot/unité). Connue sans charger le modèle
   * quand la bibliothèque la fournit : le moteur de placement peut alors travailler « à froid ».
   */
  bounds?: { min: Vec3; max: Vec3 };
  /** Rôle sémantique suggéré pour ses instances. */
  semanticRole?: SemanticRole;
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
  /** null / absent = matériaux d'origine du fichier. */
  materialOverride?: MaterialOverride | null;
}

/**
 * Éléments paramétriques : leur géométrie est générée à partir de dimensions réelles
 * (mètres), modifiables à tout moment. Pivot : centre de la base.
 * Axes locaux : X = largeur, Y = hauteur, Z = profondeur (la face avant regarde +Z).
 */
export type ElementShape =
  | 'slab'
  | 'wall'
  | 'door'
  | 'window'
  | 'stairs'
  | 'road'
  | 'sidewalk'
  | 'building'
  | 'table'
  | 'desk'
  | 'shelf'
  | 'box'
  | 'monitor'
  | 'computer'
  | 'streetlight'
  | 'barrier'
  | 'counter'
  | 'crt'
  | 'tree'
  | 'bed';

export interface ElementProps {
  shape: ElementShape;
  /** [largeur, hauteur, profondeur] en mètres. */
  size: Vec3;
  /** Paramètres propres à la forme (ex. nombre de marches), validés par core/elements.ts. */
  params: Record<string, number>;
  material: MaterialProps;
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
  /** Ce que l'objet représente dans le monde. */
  semanticRole: SemanticRole;
  /** Catégorie de bibliothèque d'origine (ex. "props.furniture"), si connue. */
  category?: string;
  /** Surcharge des règles de placement du rôle. */
  placement?: PlacementRules;
  /** Dernière relation utilisée pour le placer. */
  relation?: RelationRecord;
  /** Provenance. */
  source?: ObjectSource;
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

/** Conteneur : déplacer, masquer, verrouiller, dupliquer ou supprimer un groupe agit sur tout son contenu. */
export interface GroupObject extends SceneObjectBase {
  type: 'group';
}

export interface ElementObject extends SceneObjectBase {
  type: 'element';
  element: ElementProps;
}

export type SceneObject = BoxObject | SphereObject | LightObject | CameraObject | ModelObject | GroupObject | ElementObject;

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
  /** Métadonnées libres de la scène (ex. prompt d'origine, auteur, notes). */
  metadata: Record<string, unknown>;
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
  element?: ElementProps;
  semanticRole?: SemanticRole;
  category?: string;
  placement?: PlacementRules;
  relation?: RelationRecord;
  source?: ObjectSource;
}

export type ObjectChangeKey = keyof ObjectChanges;
