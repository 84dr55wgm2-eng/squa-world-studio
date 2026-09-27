import { createId } from './ids.ts';
import type {
  ModelProps,
  SceneDocument,
  SceneObject,
  SceneObjectType,
  SceneSettings,
  Transform,
  Vec3,
} from './types.ts';

export const DEFAULT_SETTINGS: SceneSettings = {
  background: '#1c1e23',
  ambientIntensity: 0.5,
  sunIntensity: 1.5,
  environmentIntensity: 0.6,
  shadows: true,
  gridVisible: true,
};

export const DEFAULT_OBJECT_NAMES: Record<SceneObjectType, string> = {
  box: 'Cube',
  sphere: 'Sphère',
  light: 'Lumière',
  camera: 'Caméra',
  model: 'Modèle',
};

export const DEFAULT_MODEL_PROPS: Omit<ModelProps, 'assetId'> = {
  pivot: 'bottom-center',
  orientation: [0, 0, 0],
  unitScale: 1,
  castShadow: true,
  receiveShadow: true,
};

export function identityTransform(position: Vec3 = [0, 0, 0]): Transform {
  return { position: [...position], rotation: [0, 0, 0], scale: [1, 1, 1] };
}

export function createEmptyDocument(name = 'Sans titre', now = new Date()): SceneDocument {
  const iso = now.toISOString();
  return {
    project: { name, createdAt: iso, updatedAt: iso },
    settings: { ...DEFAULT_SETTINGS },
    rootIds: [],
    objects: {},
    assets: {},
  };
}

/** Position de départ raisonnable selon le type (posé sur la grille, lumière en hauteur…). */
function defaultPosition(type: SceneObjectType): Vec3 {
  switch (type) {
    case 'box':
      return [0, 0.5, 0];
    case 'sphere':
      return [0, 0.5, 0];
    case 'light':
      return [0, 3, 0];
    case 'camera':
      return [0, 1.6, 6];
    case 'model':
      return [0, 0, 0];
  }
}

export interface CreateObjectOptions {
  id?: string;
  name?: string;
  position?: Vec3;
  scale?: Vec3;
  /** Obligatoire pour un objet `model`. */
  model?: Partial<ModelProps> & { assetId: string };
}

/** Crée un objet complet avec toutes ses valeurs par défaut. N'ajoute rien au document. */
export function createObject(type: SceneObjectType, opts: CreateObjectOptions = {}): SceneObject {
  const base = {
    id: opts.id ?? createId(),
    name: opts.name ?? DEFAULT_OBJECT_NAMES[type],
    parentId: null,
    children: [],
    transform: { ...identityTransform(opts.position ?? defaultPosition(type)), scale: opts.scale ? [...opts.scale] as Vec3 : [1, 1, 1] as Vec3 },
    visible: true,
    locked: false,
    tags: [],
    metadata: {},
  };
  switch (type) {
    case 'box':
      return { ...base, type, material: { color: '#b8bcc6' } };
    case 'sphere':
      return { ...base, type, material: { color: '#b8bcc6' } };
    case 'light':
      return { ...base, type, light: { kind: 'point', color: '#fff4e0', intensity: 10, distance: 0 } };
    case 'camera':
      return { ...base, type, camera: { fov: 40, near: 0.1, far: 1000 } };
    case 'model':
      return {
        ...base,
        type,
        model: { ...DEFAULT_MODEL_PROPS, orientation: [...DEFAULT_MODEL_PROPS.orientation], assetId: '', ...opts.model },
      };
  }
}

/**
 * Nom unique dans le document : "Cube", "Cube 2", "Cube 3"…
 * Un nom se terminant déjà par un numéro ("Cube 2") repart de sa base ("Cube").
 */
export function uniqueName(doc: SceneDocument, desired: string): string {
  const taken = new Set(Object.values(doc.objects).map((o) => o.name));
  if (!taken.has(desired)) return desired;
  const base = desired.replace(/\s+\d+$/, '') || desired;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
