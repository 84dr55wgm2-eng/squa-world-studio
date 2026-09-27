/**
 * Boîtes englobantes et normalisation des modèles — calcul pur, sans Three.js.
 *
 * Chaîne appliquée à un modèle (de l'intérieur vers l'extérieur) :
 *   fichier d'origine → unité (unitScale) → correction d'orientation → pivot → transform de l'objet
 *
 * Le fichier d'origine n'est jamais modifié : ces étapes ne sont que des décalages
 * d'affichage, réversibles à tout moment depuis le panneau de propriétés.
 */
import type { ModelProps, SceneObject, Transform, Vec3 } from './types.ts';

export interface Box {
  min: Vec3;
  max: Vec3;
}

type Mat3 = [number, number, number, number, number, number, number, number, number];

const DEG = Math.PI / 180;

/** Matrice de rotation d'Euler en degrés, ordre XYZ (identique à THREE.Euler 'XYZ'). */
export function rotationMatrixXYZ(deg: Vec3): Mat3 {
  const [x, y, z] = deg.map((d) => d * DEG);
  const a = Math.cos(x), b = Math.sin(x);
  const c = Math.cos(y), d = Math.sin(y);
  const e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  // Lignes de la matrice (même formule que Matrix4.makeRotationFromEuler, ordre XYZ).
  return [c * e, -c * f, d, af + be * d, ae - bf * d, -b * c, bf - ae * d, be + af * d, a * c];
}

function apply(m: Mat3, v: Vec3): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

function corners(box: Box): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) out.push([x, y, z]);
  return out;
}

function boxOf(points: Vec3[]): Box {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let i = 0; i < 3; i++) {
    min[i] = Math.min(min[i], p[i]);
    max[i] = Math.max(max[i], p[i]);
  }
  return { min, max };
}

/** Boîte englobante (alignée sur les axes) d'une boîte transformée par échelle → rotation → translation. */
export function transformBox(box: Box, scale: Vec3, rotationDeg: Vec3, translation: Vec3 = [0, 0, 0]): Box {
  const m = rotationMatrixXYZ(rotationDeg);
  return boxOf(
    corners(box).map((c) => {
      const r = apply(m, [c[0] * scale[0], c[1] * scale[1], c[2] * scale[2]]);
      return [r[0] + translation[0], r[1] + translation[1], r[2] + translation[2]] as Vec3;
    }),
  );
}

export const boxSize = (b: Box): Vec3 => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
export const boxCenter = (b: Box): Vec3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
export const isFiniteBox = (b: Box) => [...b.min, ...b.max].every(Number.isFinite);

export interface NormalizedModel {
  /** Décalage à appliquer au modèle (après unité + orientation) pour placer le pivot choisi à l'origine. */
  pivotOffset: Vec3;
  /** Boîte englobante dans l'espace local de l'objet (avant son propre transform). */
  localBox: Box;
}

/** Calcule le pivot et la boîte locale d'un modèle à partir de sa boîte d'origine (celle du fichier). */
export function normalizeModel(nativeBox: Box, props: Pick<ModelProps, 'pivot' | 'orientation' | 'unitScale'>): NormalizedModel {
  const u = props.unitScale;
  const oriented = transformBox(nativeBox, [u, u, u], props.orientation);
  const c = boxCenter(oriented);
  const pivotOffset: Vec3 =
    props.pivot === 'original' ? [0, 0, 0] : props.pivot === 'bottom-center' ? [-c[0], -oriented.min[1], -c[2]] : [-c[0], -c[1], -c[2]];
  return {
    pivotOffset,
    localBox: {
      min: [oriented.min[0] + pivotOffset[0], oriented.min[1] + pivotOffset[1], oriented.min[2] + pivotOffset[2]],
      max: [oriented.max[0] + pivotOffset[0], oriented.max[1] + pivotOffset[1], oriented.max[2] + pivotOffset[2]],
    },
  };
}

/** Boîte locale des primitives (cube de 1 m, sphère de 1 m de diamètre). */
export const UNIT_BOX: Box = { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] };

/**
 * Boîte locale d'un objet, si elle est connue. Pour un modèle, il faut la boîte d'origine
 * du fichier (connue une fois le modèle chargé).
 */
export function localBoxOf(obj: SceneObject, nativeModelBox?: Box): Box | null {
  switch (obj.type) {
    case 'box':
    case 'sphere':
      return UNIT_BOX;
    case 'model':
      return nativeModelBox ? normalizeModel(nativeModelBox, obj.model).localBox : null;
    default:
      return null;
  }
}

/** Dimensions réelles de l'objet (largeur X, hauteur Y, profondeur Z), en mètres, rotation propre ignorée. */
export function objectDimensions(localBox: Box, transform: Transform): Vec3 {
  const s = boxSize(localBox);
  return [s[0] * Math.abs(transform.scale[0]), s[1] * Math.abs(transform.scale[1]), s[2] * Math.abs(transform.scale[2])];
}

/** Boîte englobante de l'objet dans l'espace de son parent. */
export function parentSpaceBox(localBox: Box, transform: Transform): Box {
  return transformBox(localBox, transform.scale, transform.rotation, transform.position);
}

/** Position Y qui pose le point le plus bas de l'objet exactement sur Y = 0. */
export function groundedY(localBox: Box, transform: Transform): number {
  const b = parentSpaceBox(localBox, transform);
  return transform.position[1] - b.min[1];
}
