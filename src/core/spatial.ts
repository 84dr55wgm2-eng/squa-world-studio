/**
 * Requêtes spatiales pures : boîtes locales et monde de n'importe quel objet (y compris
 * les groupes et à travers la hiérarchie), dimensions, base, sommet, empreinte au sol.
 *
 * Aucune constante arbitraire : tout vient des dimensions réelles des éléments, des boîtes
 * des fichiers de modèles (registre d'assets) ou de l'union des enfants pour un groupe.
 */
import { UNIT_BOX, boxCenter, boxSize, normalizeModel, transformBox, type Box } from './bounds.ts';
import { elementLocalBox } from './elements.ts';
import { transformPoint, worldMatrix, yawOf, type Mat4 } from './math.ts';
import type { AssetId, ObjectId, SceneDocument, SceneObject, Vec3 } from './types.ts';

/** Fournit la boîte d'origine d'un modèle (registre d'assets, ou mesure au chargement). */
export interface BoundsContext {
  nativeModelBox(assetId: AssetId): Box | undefined;
}

/** Contexte minimal : uniquement les boîtes enregistrées dans la table d'assets du document. */
export const documentBoundsContext = (doc: SceneDocument): BoundsContext => ({
  nativeModelBox: (id) => doc.assets[id]?.bounds,
});

const HANDLE_BOX: Box = { min: [-0.12, -0.12, -0.12], max: [0.12, 0.12, 0.12] };
const CAMERA_BOX: Box = { min: [-0.14, -0.1, -0.32], max: [0.14, 0.1, 0.18] };

function unionBox(a: Box | null, b: Box): Box {
  if (!a) return { min: [...b.min], max: [...b.max] };
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

/** Boîte de l'objet dans son propre repère (avant son transform). null si inconnue (modèle sans boîte). */
export function objectLocalBox(doc: SceneDocument, id: ObjectId, ctx: BoundsContext): Box | null {
  const obj = doc.objects[id];
  if (!obj) return null;
  switch (obj.type) {
    case 'box':
    case 'sphere':
      return UNIT_BOX;
    case 'element':
      return elementLocalBox(obj.element.size);
    case 'model': {
      const native = ctx.nativeModelBox(obj.model.assetId);
      return native ? normalizeModel(native, obj.model).localBox : null;
    }
    case 'light':
      return HANDLE_BOX;
    case 'camera':
      return CAMERA_BOX;
    case 'group': {
      let box: Box | null = null;
      for (const childId of obj.children) {
        const child = doc.objects[childId];
        const cb = child && objectLocalBox(doc, childId, ctx);
        if (child && cb) box = unionBox(box, transformBox(cb, child.transform.scale, child.transform.rotation, child.transform.position));
      }
      return box;
    }
  }
}

/** Boîte orientée selon le lacet (rotation autour de Y) : forme utilisée pour les empreintes au sol. */
export interface OrientedBox {
  /** Centre de la boîte, en coordonnées monde. */
  center: Vec3;
  /** Demi-dimensions dans le repère de l'objet (mètres, échelle incluse). */
  half: Vec3;
  /** Lacet en degrés. */
  yaw: number;
  /** Faux si l'objet est incliné (tangage / roulis) : l'empreinte n'est alors qu'approchée. */
  upright: boolean;
}

export interface Spatial {
  local: Box;
  world: Mat4;
  /** Boîte monde alignée sur les axes. */
  aabb: Box;
  obb: OrientedBox;
  /** Dimensions réelles : largeur (X local), hauteur, profondeur (Z local). */
  width: number;
  height: number;
  depth: number;
  center: Vec3;
  /** Altitude du point le plus bas / le plus haut (monde). */
  base: number;
  top: number;
}

function corners(b: Box): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) out.push([x, y, z]);
  return out;
}

export function boxFromPoints(points: Vec3[]): Box {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let i = 0; i < 3; i++) {
    min[i] = Math.min(min[i], p[i]);
    max[i] = Math.max(max[i], p[i]);
  }
  return { min, max };
}

/** Données spatiales complètes d'un objet, ou null si sa géométrie est inconnue. */
export function objectSpatial(doc: SceneDocument, id: ObjectId, ctx: BoundsContext): Spatial | null {
  const local = objectLocalBox(doc, id, ctx);
  if (!local) return null;
  const world = worldMatrix(doc, id);
  const aabb = boxFromPoints(corners(local).map((c) => transformPoint(world, c)));
  const sx = Math.hypot(world[0], world[1], world[2]);
  const sy = Math.hypot(world[4], world[5], world[6]);
  const sz = Math.hypot(world[8], world[9], world[10]);
  const size = boxSize(local);
  const upright = sy > 0 && Math.abs(world[5] / sy) > 0.999;
  return {
    local,
    world,
    aabb,
    obb: { center: transformPoint(world, boxCenter(local)), half: [(size[0] * sx) / 2, (size[1] * sy) / 2, (size[2] * sz) / 2], yaw: yawOf(world), upright },
    width: size[0] * sx,
    height: size[1] * sy,
    depth: size[2] * sz,
    center: boxCenter(aabb),
    base: aabb.min[1],
    top: aabb.max[1],
  };
}

type Pt = [number, number];

/** Empreinte au sol (polygone convexe XZ, sens trigonométrique) d'une boîte orientée. */
export function footprint(s: Spatial): Pt[] {
  if (!s.obb.upright) {
    const b = s.aabb;
    return [[b.min[0], b.min[2]], [b.max[0], b.min[2]], [b.max[0], b.max[2]], [b.min[0], b.max[2]]];
  }
  const { center, half, yaw } = s.obb;
  const r = (yaw * Math.PI) / 180;
  // Axe X local et axe Z local projetés sur le sol (rotation autour de Y).
  const ax: Pt = [Math.cos(r), -Math.sin(r)];
  const az: Pt = [Math.sin(r), Math.cos(r)];
  const pts: Pt[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    pts.push([center[0] + ax[0] * half[0] * sx + az[0] * half[2] * sz, center[2] + ax[1] * half[0] * sx + az[1] * half[2] * sz]);
  }
  return pts;
}

function area(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function ensureCCW(poly: Pt[]): Pt[] {
  let a = 0;
  for (let i = 0; i < poly.length; i++) a += poly[i][0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * poly[i][1];
  return a >= 0 ? poly : [...poly].reverse();
}

/** Intersection de deux polygones convexes (Sutherland–Hodgman). */
export function clipConvex(subject: Pt[], clip: Pt[]): Pt[] {
  let output = ensureCCW(subject);
  const c = ensureCCW(clip);
  for (let i = 0; i < c.length && output.length; i++) {
    const a = c[i];
    const b = c[(i + 1) % c.length];
    const inside = (p: Pt) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-12;
    const intersect = (p: Pt, q: Pt): Pt => {
      const a1 = b[1] - a[1], b1 = a[0] - b[0], c1 = a1 * a[0] + b1 * a[1];
      const a2 = q[1] - p[1], b2 = p[0] - q[0], c2 = a2 * p[0] + b2 * p[1];
      const det = a1 * b2 - a2 * b1;
      if (Math.abs(det) < 1e-15) return p;
      return [(b2 * c1 - b1 * c2) / det, (a1 * c2 - a2 * c1) / det];
    };
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) output.push(intersect(prev, cur));
        output.push(cur);
      } else if (inside(prev)) output.push(intersect(prev, cur));
    }
  }
  return output;
}

export const footprintArea = (s: Spatial) => area(footprint(s));

export interface Overlap {
  /** Volume commun (m³). */
  volume: number;
  /** Volume commun rapporté au plus petit des deux objets (0 à 1). */
  ratio: number;
  /** a est entièrement dans b (ou l'inverse). */
  aInsideB: boolean;
  bInsideA: boolean;
  /** Surface commune au sol (m²). */
  footprintOverlap: number;
}

/** Chevauchement de deux objets : empreintes orientées × intervalle vertical. */
export function overlapOf(a: Spatial, b: Spatial): Overlap {
  const y = Math.min(a.top, b.top) - Math.max(a.base, b.base);
  const none: Overlap = { volume: 0, ratio: 0, aInsideB: false, bInsideA: false, footprintOverlap: 0 };
  if (y <= 1e-6) return none;
  const inter = area(clipConvex(footprint(a), footprint(b)));
  if (inter <= 1e-9) return none;
  const volA = footprintArea(a) * (a.top - a.base);
  const volB = footprintArea(b) * (b.top - b.base);
  const volume = inter * y;
  const minVol = Math.max(1e-9, Math.min(volA, volB));
  return {
    volume,
    ratio: Math.min(1, volume / minVol),
    aInsideB: volA > 0 && volume / volA > 0.98,
    bInsideA: volB > 0 && volume / volB > 0.98,
    footprintOverlap: inter,
  };
}

/** Les empreintes au sol de a et b se recouvrent-elles (surface > seuil) ? */
export const footprintsOverlap = (a: Spatial, b: Spatial, minArea = 1e-4) => area(clipConvex(footprint(a), footprint(b))) > minArea;

/** Ancêtres d'un objet (parent, grand-parent…). */
export function ancestorsOf(doc: SceneDocument, id: ObjectId): ObjectId[] {
  const out: ObjectId[] = [];
  let p = doc.objects[id]?.parentId ?? null;
  while (p && doc.objects[p]) {
    out.push(p);
    p = doc.objects[p].parentId;
  }
  return out;
}

export const isAncestorOf = (doc: SceneDocument, maybeAncestor: ObjectId, id: ObjectId) => ancestorsOf(doc, id).includes(maybeAncestor);

/** Objets « physiques » (ceux qui occupent du volume) : pas les groupes, lumières, caméras. */
export const isSolid = (obj: SceneObject) => obj.type !== 'group' && obj.type !== 'light' && obj.type !== 'camera';

