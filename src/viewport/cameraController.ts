/**
 * Contrôle impératif de la caméra de l'éditeur (la « caméra de travail »,
 * distincte des objets Caméra de la scène).
 *
 * Le composant <CameraBridge/> (dans le Canvas) enregistre ici la caméra, les
 * OrbitControls et la fonction invalidate de R3F. Le reste de l'application
 * (barre d'outils, raccourcis, panneau propriétés) appelle ces fonctions sans
 * dépendre de React Three Fiber.
 *
 * Point d'extension prévu : caméra libre FPS, focale, trajectoires, plans.
 */
import { Box3, Euler, MathUtils, Matrix4, PerspectiveCamera, Plane, Quaternion, Raycaster, Vector2, Vector3, type Object3D } from 'three';
import type { ObjectId, Transform, Vec3 } from '../core/index.ts';
import { setLookThrough, useEditor } from '../store/editorStore.ts';
import { getObject3D } from './objectRegistry.ts';

/** Sous-ensemble des OrbitControls utilisé ici (évite de dépendre du type interne de Drei). */
export interface OrbitLike {
  target: Vector3;
  enableDamping: boolean;
  update: () => unknown;
  addEventListener: (type: 'start', listener: () => void) => void;
  removeEventListener: (type: 'start', listener: () => void) => void;
}

interface Bridge {
  camera: PerspectiveCamera;
  scene?: Object3D;
  controls: OrbitLike;
  invalidate: () => void;
  domElement: HTMLElement;
}

let bridge: Bridge | null = null;

export const DEFAULT_VIEW = {
  position: new Vector3(7, 5.5, 9),
  target: new Vector3(0, 0.5, 0),
  fov: 50,
};

export function attachCameraBridge(next: Bridge | null): void {
  bridge = next;
}

function applyAndRender(b: Bridge): void {
  b.camera.updateProjectionMatrix();
  b.controls.update();
  b.invalidate();
}

/**
 * Annule l'inertie (amortissement) restante d'un orbit/pan précédent.
 * Sans cela, la caméra continuerait de glisser APRÈS un repositionnement
 * programmé (« Vue par défaut », cadrage…) et n'arriverait pas au bon endroit.
 */
function stopInertia(b: Bridge): void {
  const damping = b.controls.enableDamping;
  b.controls.enableDamping = false;
  b.controls.update(); // sans amortissement, update() consomme et remet à zéro les deltas en attente
  b.controls.enableDamping = damping;
}

export function resetView(): void {
  const b = bridge;
  if (!b) return;
  stopInertia(b);
  setLookThrough(null);
  b.camera.position.copy(DEFAULT_VIEW.position);
  b.camera.fov = DEFAULT_VIEW.fov;
  b.controls.target.copy(DEFAULT_VIEW.target);
  applyAndRender(b);
}

/** Point visé par la caméra de travail, ramené au sol (utile pour poser les nouveaux objets). */
export function getViewTargetOnGround(): Vec3 | undefined {
  if (!bridge) return undefined;
  const t = bridge.controls.target;
  const round = (v: number) => Math.round(v * 2) / 2; // grille de 0,5 m
  return [round(t.x), 0, round(t.z)];
}

/** Cadre l'objet dans la vue en conservant l'angle de vue actuel. */
export function frameObject(id: ObjectId): void {
  frameObjects([id]);
}

/** Cadre la sélection courante (un ou plusieurs objets). */
export function frameSelection(): void {
  frameObjects(useEditor.getState().selectedIds);
}

export function frameObjects(ids: ObjectId[]): void {
  const b = bridge;
  const objects = ids.map((id) => getObject3D(id)).filter((o): o is NonNullable<typeof o> => !!o);
  if (!b || !objects.length) return;
  stopInertia(b);
  setLookThrough(null);
  const box = new Box3();
  for (const o of objects) box.expandByObject(o);
  const center = new Vector3();
  let radius = 0.5;
  if (box.isEmpty()) {
    objects[0].getWorldPosition(center);
  } else {
    box.getCenter(center);
    radius = Math.max(box.getSize(new Vector3()).length() / 2, 0.25);
  }
  const direction = b.camera.position.clone().sub(b.controls.target).normalize();
  const distance = Math.max((radius / Math.sin(MathUtils.degToRad(b.camera.fov) / 2)) * 1.15, 0.4);
  b.controls.target.copy(center);
  b.camera.position.copy(center).addScaledVector(direction, distance);
  applyAndRender(b);
}

/** Place la caméra de travail exactement au point de vue d'un objet Caméra de la scène. */
export function viewThroughCamera(id: ObjectId, fov: number): void {
  const b = bridge;
  const object = getObject3D(id);
  if (!b || !object) return;
  stopInertia(b);
  object.updateWorldMatrix(true, false);
  const position = new Vector3();
  const quaternion = new Quaternion();
  object.matrixWorld.decompose(position, quaternion, new Vector3());
  const forward = new Vector3(0, 0, -1).applyQuaternion(quaternion);
  b.camera.position.copy(position);
  b.camera.fov = fov;
  b.controls.target.copy(position).addScaledVector(forward, 5);
  // Masque la représentation de cette caméra (sinon on verrait son objectif de l'intérieur).
  // Elle réapparaît dès que l'utilisateur manipule la vue (voir CameraBridge).
  setLookThrough(id);
  applyAndRender(b);
}

/**
 * Transform à donner à un objet Caméra pour qu'il reproduise la vue actuelle,
 * exprimé dans l'espace de son parent (prêt pour les hiérarchies).
 */
export function currentViewAsTransform(id: ObjectId, keepScale: Vec3): { transform: Transform; fov: number } | undefined {
  const b = bridge;
  const object = getObject3D(id);
  if (!b || !object) return undefined;
  stopInertia(b);
  b.camera.updateMatrixWorld();
  const local = new Matrix4();
  if (object.parent) {
    object.parent.updateWorldMatrix(true, false);
    local.copy(object.parent.matrixWorld).invert();
  }
  local.multiply(b.camera.matrixWorld);
  const position = new Vector3();
  const quaternion = new Quaternion();
  local.decompose(position, quaternion, new Vector3());
  const euler = new Euler().setFromQuaternion(quaternion, 'XYZ');
  const r3 = (v: number) => Math.round(v * 1e4) / 1e4;
  return {
    transform: {
      position: [r3(position.x), r3(position.y), r3(position.z)],
      rotation: [euler.x, euler.y, euler.z].map((a) => r3(MathUtils.radToDeg(a))) as Vec3,
      scale: [...keepScale],
    },
    fov: Math.round(b.camera.fov * 100) / 100,
  };
}

const GROUND = new Plane(new Vector3(0, 1, 0), 0);
const MAX_DROP_DISTANCE = 500;

/**
 * Point du sol (Y = 0) sous une position d'écran (ex. un dépôt glisser-déposer).
 * Si le pointeur vise le ciel ou un point trop lointain, on retombe sur le centre de la vue.
 */
export function groundPointAtClient(clientX: number, clientY: number): Vec3 | undefined {
  const b = bridge;
  if (!b) return undefined;
  const rect = b.domElement.getBoundingClientRect();
  const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new Raycaster();
  ray.setFromCamera(ndc, b.camera);
  // D'abord les objets de la scène (déposer sur une table vise la table, pas le sol derrière).
  if (b.scene) {
    for (const h of ray.intersectObject(b.scene, true)) {
      if (h.distance > MAX_DROP_DISTANCE) break;
      let o: Object3D | null = h.object;
      while (o && o.userData.squaId === undefined) o = o.parent;
      if (o && h.object.visible) return [Math.round(h.point.x * 100) / 100, Math.max(0, Math.round(h.point.y * 100) / 100), Math.round(h.point.z * 100) / 100];
    }
  }
  const hit = new Vector3();
  if (!ray.ray.intersectPlane(GROUND, hit) || hit.distanceTo(b.camera.position) > MAX_DROP_DISTANCE) return getViewTargetOnGround();
  return [Math.round(hit.x * 100) / 100, 0, Math.round(hit.z * 100) / 100];
}

/** Position à l'écran (pixels, relatifs à la page) d'un point 3D du monde. */
export function projectToScreen(p: Vec3): { x: number; y: number } | undefined {
  const b = bridge;
  if (!b) return undefined;
  b.camera.updateMatrixWorld();
  const v = new Vector3(...p).project(b.camera);
  const rect = b.domElement.getBoundingClientRect();
  return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
}

/** Force un rendu (utilisé par la mesure d'images par seconde en mode diagnostic). */
export function invalidateView(): void {
  bridge?.invalidate();
}
