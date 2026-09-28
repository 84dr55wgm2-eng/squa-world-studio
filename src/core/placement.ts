/**
 * Moteur de placement relationnel (pur, sans rendu).
 *
 * Il calcule où poser un objet par rapport à un autre à partir de leurs boîtes réelles :
 *   ON · INSIDE · NEXT_TO · AGAINST · CENTERED_IN · FACING · ATTACHED_TO · ALONG
 * Il ne contient aucune coordonnée propre à une scène : la même relation fonctionne pour
 * une chaise et un bureau, une voiture et une route, une fenêtre et un mur.
 *
 * C'est la couche qu'utilisera l'IA : elle exprimera « la chaise À CÔTÉ du bureau », le moteur
 * en déduira la position, l'orientation et l'appui.
 */
import { boxCenter, rotationMatrixXYZ, transformBox, type Box } from './bounds.ts';
import { SHAPES } from './elements.ts';
import { compose, localTransformFor, worldTransform } from './math.ts';
import { effectiveRules } from './semantics.ts';
import { getObject, getSubtreeIds, SceneError } from './scene.ts';
import { isSolid, objectLocalBox, objectSpatial, overlapOf, type BoundsContext, type Spatial } from './spatial.ts';
import { overlapAllowed } from './semantics.ts';
import type { ElementProps, ObjectId, RelationType, SceneDocument, Transform, Vec3 } from './types.ts';

export type Side = 'front' | 'back' | 'left' | 'right';

export interface RelationSpec {
  type: RelationType;
  /** Objet de référence. */
  target: ObjectId;
  /** NEXT_TO : côté de la cible (défaut : le premier côté libre). AGAINST : face de la cible. */
  side?: Side | 'auto';
  /** Espace laissé entre les deux objets (m). */
  gap?: number;
  /** Décalage latéral (m) : le long du mur (AGAINST, ATTACHED_TO), perpendiculaire à l'axe (ALONG, NEXT_TO). */
  offset?: number;
  /** ALONG : position le long de la cible, de 0 (début) à 1 (fin). */
  t?: number;
  /** ALONG : sens inverse. */
  reverse?: boolean;
  /** NEXT_TO : orientation du sujet — face à la cible, même orientation, ou dos à la cible. */
  face?: 'target' | 'same' | 'away';
  /** ATTACHED_TO : hauteur du bas de l'objet par rapport à la base du mur (ex. allège d'une fenêtre). */
  height?: number;
  /** ON / INSIDE : position voulue dans le repère de la cible (m, depuis son centre). */
  x?: number;
  z?: number;
  /** Lacet imposé (degrés, monde). */
  yaw?: number;
  /** AGAINST : conserver l'altitude actuelle (ex. objet posé sur une table contre le mur). */
  keepY?: boolean;
}

export interface PlacementSolution {
  parentId: ObjectId | null;
  /** Transform locale dans l'espace de parentId. */
  transform: Transform;
  /** Modifications de l'élément (ex. épaisseur d'une porte ajustée à celle du mur). */
  elementChanges?: Partial<ElementProps>;
  notes: string[];
}

type XZ = [number, number];
const DEG = Math.PI / 180;
const dot = (a: XZ, b: XZ) => a[0] * b[0] + a[1] * b[1];
const axesOf = (yawDeg: number): { x: XZ; z: XZ } => {
  const r = yawDeg * DEG;
  return { x: [Math.cos(r), -Math.sin(r)], z: [Math.sin(r), Math.cos(r)] };
};
/** Lacet (degrés) qui oriente l'avant (+Z local) vers la direction d. */
const yawToward = (d: XZ) => Math.atan2(d[0], d[1]) / DEG;
const round = (v: number, n = 4) => {
  const f = 10 ** n;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};
const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));

function requireSpatial(doc: SceneDocument, id: ObjectId, ctx: BoundsContext, role: string): Spatial {
  const s = objectSpatial(doc, id, ctx);
  if (!s) throw new SceneError(`Dimensions inconnues pour « ${getObject(doc, id).name} » (${role}) : le modèle n'est pas encore mesuré.`);
  return s;
}


/** Boîte orientée : les 8 coins (relatifs au pivot) d'une boîte locale après échelle + rotation. */
export interface Oriented {
  box: Box;
  pts: Vec3[];
}
function orient(local: Box, scale: Vec3, rotation: Vec3): Oriented {
  const m = rotationMatrixXYZ(rotation);
  const pts: Vec3[] = [];
  for (const x of [local.min[0], local.max[0]]) for (const y of [local.min[1], local.max[1]]) for (const z of [local.min[2], local.max[2]]) {
    const v: Vec3 = [x * scale[0], y * scale[1], z * scale[2]];
    pts.push([m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]);
  }
  return { box: transformBox(local, scale, rotation), pts };
}

/** Intervalle exact de projection de la boîte orientée sur une direction horizontale. */
function projectBox(o: Oriented, u: XZ): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const p of o.pts) {
    const d = p[0] * u[0] + p[2] * u[1];
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return [lo, hi];
}

/** Altitude du sol d'une cible « contenant » (pièce, groupe) : le dessus de son sol s'il en a un, sinon sa base. */
function floorLevel(doc: SceneDocument, targetId: ObjectId, ctx: BoundsContext, t: Spatial): number {
  const floors = getSubtreeIds(doc, targetId).filter((id) => id !== targetId && doc.objects[id].semanticRole === 'floor');
  let level = -Infinity;
  for (const f of floors) {
    const s = objectSpatial(doc, f, ctx);
    if (s) level = Math.max(level, s.top);
  }
  return Number.isFinite(level) ? level : t.base;
}

/** Transform monde → solution (dans l'espace du parent actuel du sujet). */
function solution(doc: SceneDocument, subjectId: ObjectId, pivot: Vec3, rotation: Vec3, scale: Vec3, notes: string[]): PlacementSolution {
  const parentId = getObject(doc, subjectId).parentId;
  const world = compose({ position: pivot.map((v) => round(v)) as Vec3, rotation: rotation.map((v) => round(v, 3)) as Vec3, scale });
  return { parentId, transform: localTransformFor(doc, parentId, world), notes };
}

/** Somme des chevauchements anormaux qu'aurait le sujet posé à cet endroit (pour choisir le meilleur côté). */
function collisionScore(doc: SceneDocument, subjectId: ObjectId, local: Box, pivot: Vec3, rotation: Vec3, scale: Vec3, ctx: BoundsContext): number {
  const subject = getObject(doc, subjectId);
  const probeDoc: SceneDocument = {
    ...doc,
    objects: { ...doc.objects, [subjectId]: { ...subject, parentId: null, transform: { position: pivot, rotation, scale } } },
  };
  const s = objectSpatial(probeDoc, subjectId, ctx);
  if (!s) return 0;
  void local;
  const excluded = new Set(getSubtreeIds(doc, subjectId));
  let score = 0;
  for (const other of Object.values(doc.objects)) {
    if (excluded.has(other.id) || !isSolid(other) || overlapAllowed(subject, other)) continue;
    const o = objectSpatial(doc, other.id, ctx);
    if (o) score += overlapOf(s, o).volume;
  }
  return score;
}

/**
 * Calcule la position d'un objet selon une relation. Lève SceneError si la relation est
 * impossible (cible inconnue, dimensions inconnues, objet placé par rapport à lui-même…).
 */
export function solvePlacement(doc: SceneDocument, subjectId: ObjectId, rel: RelationSpec, ctx: BoundsContext): PlacementSolution {
  const subject = getObject(doc, subjectId);
  const target = getObject(doc, rel.target);
  if (subjectId === rel.target || getSubtreeIds(doc, subjectId).includes(rel.target)) {
    throw new SceneError(`« ${subject.name} » ne peut pas être placé par rapport à lui-même ou à l'un de ses enfants.`);
  }
  const local = objectLocalBox(doc, subjectId, ctx);
  if (!local) throw new SceneError(`Dimensions inconnues pour « ${subject.name} » : le modèle n'est pas encore mesuré.`);
  const t = requireSpatial(doc, rel.target, ctx, 'cible');
  const sub = objectSpatial(doc, subjectId, ctx)!;
  const wt = worldTransform(doc, subjectId);
  const scale = wt.scale;
  const notes: string[] = [];
  const gap = rel.gap ?? 0;
  const tAxes = axesOf(t.obb.yaw);
  const tc: XZ = [t.obb.center[0], t.obb.center[2]];
  const currentYaw = sub.obb.yaw;
  const rot = (yaw: number): Vec3 => [wt.rotation[0], yaw, wt.rotation[2]];

  switch (rel.type) {
    case 'ON': {
      const yaw = rel.yaw ?? currentYaw;
      const O = orient(local, scale, rot(yaw));
      const B = O.box;
      const bc = boxCenter(B);
      // Position voulue du centre du sujet, dans le repère de la cible.
      let u: number, v: number;
      if (rel.x !== undefined || rel.z !== undefined) {
        u = rel.x ?? 0;
        v = rel.z ?? 0;
      } else {
        const d: XZ = [sub.center[0] - tc[0], sub.center[2] - tc[1]];
        u = dot(d, tAxes.x);
        v = dot(d, tAxes.z);
        if (Math.abs(u) > t.obb.half[0] || Math.abs(v) > t.obb.half[2]) {
          u = 0;
          v = 0;
        }
      }
      const [bu0, bu1] = projectBox(O, tAxes.x);
      const [bv0, bv1] = projectBox(O, tAxes.z);
      const hu = (bu1 - bu0) / 2, hv = (bv1 - bv0) / 2;
      if (hu > t.obb.half[0] || hv > t.obb.half[2]) notes.push(`« ${subject.name} » dépasse de la surface de « ${target.name} ».`);
      u = clamp(u, -t.obb.half[0] + hu, t.obb.half[0] - hu);
      v = clamp(v, -t.obb.half[2] + hv, t.obb.half[2] - hv);
      const cx = tc[0] + tAxes.x[0] * u + tAxes.z[0] * v;
      const cz = tc[1] + tAxes.x[1] * u + tAxes.z[1] * v;
      return solution(doc, subjectId, [cx - bc[0], t.top - B.min[1], cz - bc[2]], rot(yaw), scale, notes);
    }

    case 'INSIDE':
    case 'CENTERED_IN': {
      const yaw = rel.yaw ?? currentYaw;
      const O = orient(local, scale, rot(yaw));
      const B = O.box;
      const bc = boxCenter(B);
      const level = floorLevel(doc, rel.target, ctx, t);
      const box = t.aabb;
      const margin = gap || 0.05;
      let cx = (box.min[0] + box.max[0]) / 2 + (rel.x ?? 0);
      let cz = (box.min[2] + box.max[2]) / 2 + (rel.z ?? 0);
      if (rel.type === 'INSIDE' && rel.x === undefined && rel.z === undefined) {
        const inside = sub.center[0] > box.min[0] && sub.center[0] < box.max[0] && sub.center[2] > box.min[2] && sub.center[2] < box.max[2];
        if (inside) {
          cx = sub.center[0];
          cz = sub.center[2];
        }
      }
      const hx = (B.max[0] - B.min[0]) / 2, hz = (B.max[2] - B.min[2]) / 2;
      cx = clamp(cx, box.min[0] + margin + hx, box.max[0] - margin - hx);
      cz = clamp(cz, box.min[2] + margin + hz, box.max[2] - margin - hz);
      return solution(doc, subjectId, [cx - bc[0], level - B.min[1], cz - bc[2]], rot(yaw), scale, notes);
    }

    case 'NEXT_TO': {
      const sides: Side[] = rel.side && rel.side !== 'auto' ? [rel.side] : ['front', 'right', 'left', 'back'];
      const dirs: Record<Side, XZ> = {
        front: tAxes.z,
        back: [-tAxes.z[0], -tAxes.z[1]],
        right: tAxes.x,
        left: [-tAxes.x[0], -tAxes.x[1]],
      };
      const face = rel.face ?? 'target';
      const g = rel.gap ?? 0.1;
      let best: { score: number; pivot: Vec3; rotation: Vec3; side: Side } | null = null;
      for (const side of sides) {
        const n = dirs[side];
        const perp: XZ = [n[1], -n[0]]; // à droite de la direction n
        const yaw = rel.yaw ?? (face === 'target' ? yawToward([-n[0], -n[1]]) : face === 'away' ? yawToward(n) : t.obb.yaw);
        const rotation = rot(yaw);
        const O = orient(local, scale, rotation);
        const B = O.box;
        const [n0] = projectBox(O, n);
        const [p0, p1] = projectBox(O, perp);
        const hN = side === 'front' || side === 'back' ? t.obb.half[2] : t.obb.half[0];
        const along = hN + g - n0;
        const lateral = (rel.offset ?? 0) - (p0 + p1) / 2;
        const pivot: Vec3 = [tc[0] + n[0] * along + perp[0] * lateral, t.base - B.min[1], tc[1] + n[1] * along + perp[1] * lateral];
        const score = sides.length > 1 ? collisionScore(doc, subjectId, local, pivot, rotation, scale, ctx) : 0;
        if (!best || score < best.score - 1e-6) best = { score, pivot, rotation, side };
        if (score <= 1e-6) break;
      }
      if (best!.score > 1e-3) notes.push(`Aucun côté entièrement libre autour de « ${target.name} » : côté ${best!.side} retenu.`);
      return solution(doc, subjectId, best!.pivot, best!.rotation, scale, notes);
    }

    case 'AGAINST': {
      const candidates: { n: XZ; h: number; w: XZ; hw: number; name: Side }[] = [
        { n: tAxes.z, h: t.obb.half[2], w: tAxes.x, hw: t.obb.half[0], name: 'front' },
        { n: [-tAxes.z[0], -tAxes.z[1]], h: t.obb.half[2], w: tAxes.x, hw: t.obb.half[0], name: 'back' },
        { n: tAxes.x, h: t.obb.half[0], w: tAxes.z, hw: t.obb.half[2], name: 'right' },
        { n: [-tAxes.x[0], -tAxes.x[1]], h: t.obb.half[0], w: tAxes.z, hw: t.obb.half[2], name: 'left' },
      ];
      const d: XZ = [sub.center[0] - tc[0], sub.center[2] - tc[1]];
      const pick =
        rel.side && rel.side !== 'auto'
          ? candidates.find((c) => c.name === rel.side)!
          : candidates.reduce((a, b) => (dot(d, b.n) - b.h > dot(d, a.n) - a.h ? b : a));
      const yaw = rel.yaw ?? yawToward(pick.n);
      const rotation = rot(yaw);
      const O = orient(local, scale, rotation);
      const B = O.box;
      const [n0] = projectBox(O, pick.n);
      const [w0, w1] = projectBox(O, pick.w);
      const hwS = (w1 - w0) / 2;
      let lateral = rel.offset ?? dot(d, pick.w);
      lateral = clamp(lateral, -pick.hw + hwS, pick.hw - hwS);
      const along = pick.h + (rel.gap ?? 0.005) - n0;
      const rules = effectiveRules(subject);
      const keepHeight = rel.keepY || rules.support === 'wall' || rules.support === 'none';
      const y = keepHeight ? wt.position[1] : t.base - B.min[1];
      const wc = (w0 + w1) / 2;
      return solution(
        doc,
        subjectId,
        [tc[0] + pick.n[0] * along + pick.w[0] * (lateral - wc), y, tc[1] + pick.n[1] * along + pick.w[1] * (lateral - wc)],
        rotation,
        scale,
        notes,
      );
    }

    case 'FACING': {
      const d: XZ = [tc[0] - sub.center[0], tc[1] - sub.center[2]];
      if (Math.hypot(d[0], d[1]) < 1e-6) return solution(doc, subjectId, wt.position, wt.rotation, scale, notes);
      return solution(doc, subjectId, wt.position, rot(yawToward(d)), scale, notes);
    }

    case 'ATTACHED_TO': {
      if (!['wall', 'building'].includes(target.semanticRole)) notes.push(`« ${target.name} » n'est pas un mur : fixation quand même.`);
      const targetLocal = objectLocalBox(doc, rel.target, ctx)!;
      // Dans le repère de la cible (qui devient le parent) : aligné, centré dans l'épaisseur.
      const subjectLocalScale = subject.transform.scale;
      const B = transformBox(local, subjectLocalScale, [0, 0, 0]);
      const halfW = (B.max[0] - B.min[0]) / 2;
      const inv = localTransformFor(doc, rel.target, compose(wt));
      let x = rel.offset ?? inv.position[0];
      x = clamp(x, targetLocal.min[0] + halfW - boxCenter(B)[0], targetLocal.max[0] - halfW - boxCenter(B)[0]);
      const role = subject.semanticRole;
      const sill =
        rel.height ??
        (subject.type === 'element' && subject.element.params.sill !== undefined ? subject.element.params.sill : role === 'door' ? 0 : Math.max(0, inv.position[1] + B.min[1]));
      const y = targetLocal.min[1] + sill - B.min[1];
      const zc = (targetLocal.min[2] + targetLocal.max[2]) / 2 - boxCenter(B)[2];
      const result: PlacementSolution = {
        parentId: rel.target,
        transform: { position: [round(x), round(y), round(zc)], rotation: [0, 0, 0], scale: [...subjectLocalScale] as Vec3 },
        notes,
      };
      // Une porte ou fenêtre paramétrique prend l'épaisseur du mur (+2 cm) pour habiller l'ouverture.
      if (subject.type === 'element' && ['door', 'window'].includes(subject.element.shape)) {
        const wallDepth = targetLocal.max[2] - targetLocal.min[2];
        const min = SHAPES[subject.element.shape].minSize[2];
        result.elementChanges = { size: [subject.element.size[0], subject.element.size[1], Math.max(min, round(wallDepth + 0.02))] };
      }
      if (x + halfW > targetLocal.max[0] + 1e-6 || x - halfW < targetLocal.min[0] - 1e-6) notes.push(`« ${subject.name} » est plus large que « ${target.name} ».`);
      return result;
    }

    case 'ALONG': {
      const alongX = t.obb.half[0] >= t.obb.half[2];
      const axis = alongX ? tAxes.x : tAxes.z;
      const halfLen = alongX ? t.obb.half[0] : t.obb.half[2];
      const dir: XZ = rel.reverse ? [-axis[0], -axis[1]] : axis;
      const perp: XZ = [dir[1], -dir[0]]; // à droite dans le sens de la marche
      const yaw = rel.yaw ?? yawToward(dir);
      const rotation = rot(yaw);
      const O = orient(local, scale, rotation);
      const B = O.box;
      const [a0, a1] = projectBox(O, axis);
      const [p0, p1] = projectBox(O, perp);
      const tt = clamp(rel.t ?? 0.5, 0, 1);
      let s = (tt - 0.5) * 2 * halfLen;
      s = clamp(s, -halfLen + (a1 - a0) / 2, halfLen - (a1 - a0) / 2);
      const lat = (rel.offset ?? 0) - (p0 + p1) / 2;
      const ac = (a0 + a1) / 2;
      return solution(
        doc,
        subjectId,
        [tc[0] + axis[0] * (s - ac) + perp[0] * lat, t.top - B.min[1], tc[1] + axis[1] * (s - ac) + perp[1] * lat],
        rotation,
        scale,
        notes,
      );
    }
  }
}

/* ------------------------------------------------------------------ Aimantation aux surfaces */

const NOT_A_SUPPORT = new Set(['wall', 'door', 'window', 'light', 'camera', 'ceiling']);

function pointInFootprint(s: Spatial, x: number, z: number): boolean {
  const ax = axesOf(s.obb.yaw);
  const dx = x - s.obb.center[0], dz = z - s.obb.center[2];
  if (!s.obb.upright) return x >= s.aabb.min[0] && x <= s.aabb.max[0] && z >= s.aabb.min[2] && z <= s.aabb.max[2];
  return Math.abs(dx * ax.x[0] + dz * ax.x[1]) <= s.obb.half[0] + 1e-6 && Math.abs(dx * ax.z[0] + dz * ax.z[1]) <= s.obb.half[2] + 1e-6;
}

/**
 * Altitude de la surface qui porte l'objet à sa position horizontale actuelle : le dessus le plus
 * haut parmi les objets situés sous son centre (sol, table, trottoir…), sans dépasser son sommet ;
 * 0 (le sol) sinon. Les murs, portes, fenêtres ne portent rien.
 */
export function supportLevel(doc: SceneDocument, id: ObjectId, ctx: BoundsContext): number {
  const s = objectSpatial(doc, id, ctx);
  if (!s) return 0;
  const excluded = new Set(getSubtreeIds(doc, id));
  let level = 0;
  for (const o of Object.values(doc.objects)) {
    if (excluded.has(o.id) || !isSolid(o) || !o.visible || NOT_A_SUPPORT.has(o.semanticRole)) continue;
    const t = objectSpatial(doc, o.id, ctx);
    if (!t || t.top > s.top - 1e-3 || t.top <= level) continue;
    if (pointInFootprint(t, s.center[0], s.center[2])) level = t.top;
  }
  return level;
}

/** Transform qui pose l'objet sur sa surface porteuse (voir supportLevel), sans le déplacer horizontalement. */
export function dropToSurface(doc: SceneDocument, id: ObjectId, ctx: BoundsContext): PlacementSolution | null {
  const s = objectSpatial(doc, id, ctx);
  if (!s) return null;
  const level = supportLevel(doc, id, ctx);
  const wt = worldTransform(doc, id);
  const pivot: Vec3 = [wt.position[0], wt.position[1] + (level - s.base), wt.position[2]];
  return solution(doc, id, pivot, wt.rotation, wt.scale, []);
}

/**
 * Si l'objet est à moins de `distance` de la face d'un mur (et en face de lui), renvoie le
 * placement CONTRE ce mur (dos au mur). Sinon null.
 */
export function snapAgainstNearestWall(doc: SceneDocument, id: ObjectId, ctx: BoundsContext, distance = 0.25): PlacementSolution | null {
  const obj = getObject(doc, id);
  if (['wall', 'door', 'window', 'floor', 'road', 'sidewalk', 'building', 'room'].includes(obj.semanticRole)) return null;
  const s = objectSpatial(doc, id, ctx);
  if (!s) return null;
  const excluded = new Set(getSubtreeIds(doc, id));
  let best: { gap: number; wallId: ObjectId; side: Side } | null = null;
  for (const w of Object.values(doc.objects)) {
    if (w.semanticRole !== 'wall' || excluded.has(w.id) || !w.visible) continue;
    const t = objectSpatial(doc, w.id, ctx);
    if (!t) continue;
    const ax = axesOf(t.obb.yaw);
    const dx = s.center[0] - t.obb.center[0], dz = s.center[2] - t.obb.center[2];
    const along = dx * ax.x[0] + dz * ax.x[1];
    const normal = dx * ax.z[0] + dz * ax.z[1];
    if (Math.abs(along) > t.obb.half[0]) continue;
    const n: XZ = normal >= 0 ? ax.z : [-ax.z[0], -ax.z[1]];
    // Demi-épaisseur du sujet le long de la normale du mur.
    const sub = axesOf(s.obb.yaw);
    const hN = Math.abs(dot(n, sub.x)) * s.obb.half[0] + Math.abs(dot(n, sub.z)) * s.obb.half[2];
    const gap = Math.abs(normal) - t.obb.half[2] - hN;
    if (gap < -hN || gap > distance) continue;
    if (!best || gap < best.gap) best = { gap, wallId: w.id, side: normal >= 0 ? 'front' : 'back' };
  }
  if (!best) return null;
  return solvePlacement(doc, id, { type: 'AGAINST', target: best.wallId, side: best.side, keepY: true }, ctx);
}
