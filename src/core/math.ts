/**
 * Mathématiques 3D pures (sans Three.js) : matrices 4×4, composition / décomposition de
 * transforms, transforms « monde » à travers la hiérarchie.
 *
 * Convention identique à Three.js : matrices en colonnes (column-major), Euler XYZ en degrés
 * dans le document. Le cœur peut ainsi grouper, dégrouper et placer des objets sans rendu.
 */
import type { ObjectId, SceneDocument, Transform, Vec3 } from './types.ts';

export type Mat4 = number[]; // 16 valeurs, column-major

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export const identity = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Matrice position · rotation (Euler XYZ, degrés) · échelle — identique à Matrix4.compose. */
export function compose(t: Transform): Mat4 {
  const [x, y, z] = t.rotation.map((d) => d * DEG);
  const a = Math.cos(x), b = Math.sin(x);
  const c = Math.cos(y), d = Math.sin(y);
  const e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  // Rotation (lignes) : même formule que Matrix4.makeRotationFromEuler (ordre XYZ).
  const r = [c * e, -c * f, d, af + be * d, ae - bf * d, -b * c, bf - ae * d, be + af * d, a * c];
  const [sx, sy, sz] = t.scale;
  const [px, py, pz] = t.position;
  return [
    r[0] * sx, r[3] * sx, r[6] * sx, 0,
    r[1] * sy, r[4] * sy, r[7] * sy, 0,
    r[2] * sz, r[5] * sz, r[8] * sz, 0,
    px, py, pz, 1,
  ];
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = s;
    }
  }
  return out;
}

export function invert(m: Mat4): Mat4 {
  const [n11, n21, n31, n41, n12, n22, n32, n42, n13, n23, n33, n43, n14, n24, n34, n44] = m;
  const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
  const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
  const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
  const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
  const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
  if (det === 0) return identity();
  const i = 1 / det;
  return [
    t11 * i,
    (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * i,
    (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * i,
    (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * i,
    t12 * i,
    (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * i,
    (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * i,
    (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * i,
    t13 * i,
    (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * i,
    (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * i,
    (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * i,
    t14 * i,
    (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * i,
    (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * i,
    (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * i,
  ];
}

const clean = (v: number, digits: number) => {
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

/** Décompose une matrice (sans cisaillement) en transform. Valeurs arrondies (0,1 mm / 0,001°). */
export function decompose(m: Mat4): Transform {
  let sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const sz = Math.hypot(m[8], m[9], m[10]);
  // Déterminant négatif : une échelle est négative (miroir).
  const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  if (det < 0) sx = -sx;
  const r11 = m[0] / sx, r21 = m[1] / sx, r31 = m[2] / sx;
  const r12 = m[4] / sy, r22 = m[5] / sy, r32 = m[6] / sy;
  const r13 = m[8] / sz, r23 = m[9] / sz, r33 = m[10] / sz;
  void r21;
  void r31;
  let y = Math.asin(Math.max(-1, Math.min(1, r13)));
  let x: number, z: number;
  if (Math.abs(r13) < 0.9999999) {
    x = Math.atan2(-r23, r33);
    z = Math.atan2(-r12, r11);
  } else {
    x = Math.atan2(r32, r22);
    z = 0;
  }
  // (x, y, z) et (x ± π, π − y, z ± π) sont la même rotation : pour un simple lacet > 90°,
  // on préfère [0, lacet, 0] (lisible dans l'inspecteur) à [180, 180 − lacet, 180].
  if (Math.abs(Math.abs(x) - Math.PI) < 1e-6 && Math.abs(Math.abs(z) - Math.PI) < 1e-6) {
    x = 0;
    z = 0;
    y = (y >= 0 ? Math.PI : -Math.PI) - y;
  }
  return {
    position: [clean(m[12], 5), clean(m[13], 5), clean(m[14], 5)],
    rotation: [clean(x * RAD, 4), clean(y * RAD, 4), clean(z * RAD, 4)],
    scale: [clean(sx, 5), clean(sy, 5), clean(sz, 5)],
  };
}

export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const [x, y, z] = p;
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

/** Direction (sans translation). */
export function transformDirection(m: Mat4, d: Vec3): Vec3 {
  const [x, y, z] = d;
  return [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
}

/** Matrice monde d'un objet (produit des matrices de ses ancêtres). */
export function worldMatrix(doc: SceneDocument, id: ObjectId): Mat4 {
  const chain: ObjectId[] = [];
  let current: ObjectId | null = id;
  while (current) {
    const obj: SceneDocument['objects'][string] | undefined = doc.objects[current];
    if (!obj) break;
    chain.unshift(current);
    current = obj.parentId;
  }
  return chain.reduce((acc, oid) => multiply(acc, compose(doc.objects[oid].transform)), identity());
}

/** Matrice monde d'un parent (identité pour la racine). */
export const parentWorldMatrix = (doc: SceneDocument, parentId: ObjectId | null): Mat4 =>
  parentId ? worldMatrix(doc, parentId) : identity();

/** Transform locale (dans l'espace du parent donné) correspondant à une matrice monde. */
export function localTransformFor(doc: SceneDocument, parentId: ObjectId | null, world: Mat4): Transform {
  return decompose(multiply(invert(parentWorldMatrix(doc, parentId)), world));
}

export const worldTransform = (doc: SceneDocument, id: ObjectId): Transform => decompose(worldMatrix(doc, id));

/** Rotation autour de Y (lacet, degrés) d'une matrice monde, en projetant son axe X local. */
export function yawOf(m: Mat4): number {
  return Math.atan2(-m[2], m[0]) * RAD;
}
