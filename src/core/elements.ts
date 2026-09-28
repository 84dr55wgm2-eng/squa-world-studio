/**
 * Registre des éléments paramétriques (murs, sols, portes, fenêtres, escaliers, routes…).
 *
 * Chaque forme déclare ses dimensions par défaut (mètres réels), ses paramètres, son rôle
 * sémantique et son matériau. La géométrie est générée par le viewport (viewport/elements/),
 * mais tout ce dont le moteur de placement a besoin (dimensions, boîte, rôle) est ici, en pur TS.
 */
import type { Box } from './bounds.ts';
import type { ElementProps, ElementShape, MaterialProps, SemanticRole, Vec3 } from './types.ts';

export interface ParamDef {
  label: string;
  default: number;
  min: number;
  max: number;
  integer?: boolean;
  unit?: string;
}

export interface ShapeDef {
  label: string;
  role: SemanticRole;
  /** [largeur, hauteur, profondeur]. */
  defaultSize: Vec3;
  minSize: Vec3;
  params: Record<string, ParamDef>;
  material: MaterialProps;
  /** Catégorie de bibliothèque. */
  category: string;
  tags: string[];
}

const mat = (color: string, roughness = 0.8, metalness = 0, opacity = 1): MaterialProps => ({ color, roughness, metalness, opacity });

export const SHAPES: Record<ElementShape, ShapeDef> = {
  slab: {
    label: 'Dalle de sol',
    role: 'floor',
    defaultSize: [4, 0.1, 4],
    minSize: [0.1, 0.01, 0.1],
    params: {},
    material: mat('#b9a58a', 0.75),
    category: 'architecture.floors',
    tags: ['sol', 'plancher', 'dalle'],
  },
  wall: {
    label: 'Mur',
    role: 'wall',
    defaultSize: [4, 2.8, 0.2],
    minSize: [0.1, 0.1, 0.02],
    params: {},
    material: mat('#d9d4ca', 0.9),
    category: 'architecture.walls',
    tags: ['mur', 'cloison', 'façade'],
  },
  door: {
    label: 'Porte',
    role: 'door',
    defaultSize: [0.9, 2.1, 0.12],
    minSize: [0.4, 1, 0.03],
    params: { frame: { label: 'Cadre', default: 0.06, min: 0.02, max: 0.2, unit: 'm' } },
    material: mat('#7a5638', 0.6),
    category: 'architecture.doors',
    tags: ['porte', 'entrée', 'ouverture'],
  },
  window: {
    label: 'Fenêtre',
    role: 'window',
    defaultSize: [1.2, 1.2, 0.12],
    minSize: [0.2, 0.2, 0.02],
    params: {
      sill: { label: 'Allège', default: 0.9, min: 0, max: 3, unit: 'm' },
      frame: { label: 'Cadre', default: 0.05, min: 0.02, max: 0.2, unit: 'm' },
      panes: { label: 'Vantaux', default: 2, min: 1, max: 6, integer: true },
    },
    material: mat('#e9e9e6', 0.5),
    category: 'architecture.windows',
    tags: ['fenêtre', 'vitre', 'ouverture'],
  },
  stairs: {
    label: 'Escalier',
    role: 'stairs',
    defaultSize: [1, 2.8, 4],
    minSize: [0.4, 0.2, 0.4],
    params: { steps: { label: 'Marches', default: 16, min: 2, max: 40, integer: true } },
    material: mat('#9c9892', 0.85),
    category: 'architecture.stairs',
    tags: ['escalier', 'marches'],
  },
  road: {
    label: 'Route',
    role: 'road',
    defaultSize: [7, 0.05, 20],
    minSize: [2, 0.01, 1],
    params: { lanes: { label: 'Voies', default: 2, min: 1, max: 6, integer: true } },
    material: mat('#3a3b3d', 0.95),
    category: 'urban.roads',
    tags: ['route', 'rue', 'chaussée', 'asphalte'],
  },
  sidewalk: {
    label: 'Trottoir',
    role: 'sidewalk',
    defaultSize: [2.5, 0.15, 20],
    minSize: [0.5, 0.05, 0.5],
    params: {},
    material: mat('#a9a69f', 0.9),
    category: 'urban.sidewalks',
    tags: ['trottoir', 'bordure', 'piéton'],
  },
  building: {
    label: 'Volume de bâtiment',
    role: 'building',
    defaultSize: [10, 9, 10],
    minSize: [1, 1, 1],
    params: { floors: { label: 'Étages', default: 3, min: 1, max: 60, integer: true } },
    material: mat('#c8b9a3', 0.9),
    category: 'architecture.buildings',
    tags: ['bâtiment', 'immeuble', 'volume', 'maison'],
  },
  table: {
    label: 'Table',
    role: 'furniture',
    defaultSize: [1.6, 0.75, 0.9],
    minSize: [0.3, 0.3, 0.3],
    params: { top: { label: 'Épaisseur plateau', default: 0.04, min: 0.01, max: 0.15, unit: 'm' } },
    material: mat('#8a6a4a', 0.55),
    category: 'props.furniture',
    tags: ['table', 'mobilier', 'salle à manger'],
  },
  desk: {
    label: 'Bureau',
    role: 'furniture',
    defaultSize: [1.4, 0.75, 0.7],
    minSize: [0.5, 0.4, 0.3],
    params: { top: { label: 'Épaisseur plateau', default: 0.03, min: 0.01, max: 0.1, unit: 'm' } },
    material: mat('#d8d2c6', 0.5),
    category: 'props.furniture',
    tags: ['bureau', 'poste de travail', 'mobilier', 'cybercafé'],
  },
  shelf: {
    label: 'Étagère',
    role: 'furniture',
    defaultSize: [0.9, 1.9, 0.35],
    minSize: [0.3, 0.3, 0.15],
    params: { shelves: { label: 'Tablettes', default: 5, min: 1, max: 12, integer: true } },
    material: mat('#9b7b58', 0.6),
    category: 'props.furniture',
    tags: ['étagère', 'rayonnage', 'bibliothèque', 'mobilier'],
  },
  box: {
    label: 'Carton',
    role: 'prop',
    defaultSize: [0.5, 0.4, 0.4],
    minSize: [0.05, 0.05, 0.05],
    params: {},
    material: mat('#b08a5a', 0.9),
    category: 'props.objects',
    tags: ['carton', 'boîte', 'caisse'],
  },
  monitor: {
    label: 'Écran',
    role: 'electronics',
    defaultSize: [0.55, 0.45, 0.2],
    minSize: [0.2, 0.15, 0.05],
    params: {},
    material: mat('#1f2126', 0.4, 0.2),
    category: 'props.electronics',
    tags: ['écran', 'moniteur', 'ordinateur', 'cybercafé'],
  },
  computer: {
    label: 'Unité centrale',
    role: 'electronics',
    defaultSize: [0.2, 0.42, 0.45],
    minSize: [0.1, 0.1, 0.1],
    params: {},
    material: mat('#2a2c31', 0.45, 0.3),
    category: 'props.electronics',
    tags: ['ordinateur', 'pc', 'tour', 'cybercafé'],
  },
  streetlight: {
    label: 'Lampadaire',
    role: 'light',
    defaultSize: [0.4, 6, 1.6],
    minSize: [0.1, 1, 0.1],
    params: {},
    material: mat('#4a4d52', 0.5, 0.6),
    category: 'urban.lighting',
    tags: ['lampadaire', 'éclairage public', 'rue'],
  },
  barrier: {
    label: 'Glissière béton',
    role: 'barrier',
    defaultSize: [3, 0.8, 0.6],
    minSize: [0.3, 0.2, 0.1],
    params: {},
    material: mat('#b7b3ab', 0.9),
    category: 'urban.barriers',
    tags: ['barrière', 'glissière', 'béton', 'sécurité'],
  },
};

export const ELEMENT_SHAPES = Object.keys(SHAPES) as ElementShape[];
export const isElementShape = (v: unknown): v is ElementShape => typeof v === 'string' && v in SHAPES;

/** Boîte locale d'un élément : pivot au centre de la base, face avant vers +Z. */
export function elementLocalBox(size: Vec3): Box {
  const [w, h, d] = size;
  return { min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] };
}

/** Paramètres complétés et bornés selon la définition de la forme. */
export function normalizeParams(shape: ElementShape, params: Record<string, number> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, def] of Object.entries(SHAPES[shape].params)) {
    let v = Number.isFinite(params[key]) ? params[key] : def.default;
    v = Math.min(def.max, Math.max(def.min, v));
    out[key] = def.integer ? Math.round(v) : v;
  }
  return out;
}

export function clampSize(shape: ElementShape, size: Vec3): Vec3 {
  const min = SHAPES[shape].minSize;
  return size.map((v, i) => Math.max(min[i], Number.isFinite(v) ? v : min[i])) as Vec3;
}

export function defaultElementProps(shape: ElementShape, overrides: Partial<ElementProps> = {}): ElementProps {
  const def = SHAPES[shape];
  return {
    shape,
    size: clampSize(shape, overrides.size ?? [...def.defaultSize]),
    params: normalizeParams(shape, overrides.params),
    material: { ...def.material, ...overrides.material },
  };
}
