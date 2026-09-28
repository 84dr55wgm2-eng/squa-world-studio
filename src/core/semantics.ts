/**
 * Registre des rôles sémantiques : règles de placement par défaut de chaque rôle.
 * C'est ici — et non dans l'interface — qu'est décrit « comment se comporte » un objet du monde.
 */
import type { PlacementRules, SceneObject, SceneObjectType, SemanticRole, SupportKind } from './types.ts';

export interface RoleInfo {
  label: string;
  support: SupportKind;
  allowFloating: boolean;
  /** Chevauchements considérés comme normaux avec ces rôles. */
  allowOverlapWith: SemanticRole[];
}

const GROUND_COVER: SemanticRole[] = ['floor', 'road', 'sidewalk'];

export const ROLES: Record<SemanticRole, RoleInfo> = {
  building: { label: 'Bâtiment', support: 'ground', allowFloating: false, allowOverlapWith: [...GROUND_COVER, 'building', 'door', 'window'] },
  wall: { label: 'Mur', support: 'ground', allowFloating: false, allowOverlapWith: ['wall', 'door', 'window', 'floor', 'ceiling'] },
  floor: { label: 'Sol', support: 'ground', allowFloating: false, allowOverlapWith: ['wall', 'floor', ...GROUND_COVER, 'stairs', 'building'] },
  ceiling: { label: 'Plafond', support: 'none', allowFloating: true, allowOverlapWith: ['wall', 'light'] },
  door: { label: 'Porte', support: 'wall', allowFloating: false, allowOverlapWith: ['wall', 'building', 'floor'] },
  window: { label: 'Fenêtre', support: 'wall', allowFloating: true, allowOverlapWith: ['wall', 'building'] },
  stairs: { label: 'Escalier', support: 'ground', allowFloating: false, allowOverlapWith: ['floor', 'wall'] },
  road: { label: 'Route', support: 'ground', allowFloating: false, allowOverlapWith: [...GROUND_COVER, 'vehicle'] },
  sidewalk: { label: 'Trottoir', support: 'ground', allowFloating: false, allowOverlapWith: [...GROUND_COVER, 'building'] },
  barrier: { label: 'Barrière', support: 'surface', allowFloating: false, allowOverlapWith: [] },
  furniture: { label: 'Mobilier', support: 'surface', allowFloating: false, allowOverlapWith: [] },
  vehicle: { label: 'Véhicule', support: 'surface', allowFloating: false, allowOverlapWith: [] },
  vegetation: { label: 'Végétation', support: 'surface', allowFloating: false, allowOverlapWith: ['vegetation'] },
  prop: { label: 'Accessoire', support: 'surface', allowFloating: false, allowOverlapWith: [] },
  electronics: { label: 'Électronique', support: 'surface', allowFloating: false, allowOverlapWith: [] },
  light: { label: 'Lumière', support: 'none', allowFloating: true, allowOverlapWith: ['light', 'ceiling', 'wall'] },
  camera: { label: 'Caméra', support: 'none', allowFloating: true, allowOverlapWith: ['camera', 'light'] },
  character: { label: 'Personnage', support: 'surface', allowFloating: false, allowOverlapWith: [] },
  room: { label: 'Pièce', support: 'none', allowFloating: true, allowOverlapWith: ['room', 'building'] },
  group: { label: 'Groupe', support: 'none', allowFloating: true, allowOverlapWith: [] },
};

export const ALL_ROLES = Object.keys(ROLES) as SemanticRole[];
export const isSemanticRole = (v: unknown): v is SemanticRole => typeof v === 'string' && v in ROLES;

/** Rôle par défaut d'un type d'objet (avant toute information plus précise). */
export function defaultRoleForType(type: SceneObjectType): SemanticRole {
  switch (type) {
    case 'light':
      return 'light';
    case 'camera':
      return 'camera';
    case 'group':
      return 'group';
    default:
      return 'prop';
  }
}

/** Règles effectives d'un objet : celles de son rôle, surchargées par les siennes. */
export function effectiveRules(obj: SceneObject): Required<PlacementRules> {
  const role = ROLES[obj.semanticRole] ?? ROLES.prop;
  return {
    support: obj.placement?.support ?? role.support,
    allowFloating: obj.placement?.allowFloating ?? role.allowFloating,
    allowOverlapWith: obj.placement?.allowOverlapWith ?? role.allowOverlapWith,
  };
}

/** Deux objets peuvent-ils se chevaucher sans que ce soit une anomalie ? */
export function overlapAllowed(a: SceneObject, b: SceneObject): boolean {
  return effectiveRules(a).allowOverlapWith.includes(b.semanticRole) || effectiveRules(b).allowOverlapWith.includes(a.semanticRole);
}
