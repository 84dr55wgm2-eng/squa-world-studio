/**
 * Gizmo de transformation (déplacer / tourner / mettre à l'échelle), pour un ou plusieurs objets.
 *
 * - Pendant la manipulation, Three.js modifie directement les objets 3D : aucun
 *   passage par le store, donc aucun re-rendu React à chaque mouvement de souris.
 * - Au relâchement, UNE transaction est enregistrée (= un seul undo par geste), qui inclut
 *   l'aimantation aux surfaces si elle est active.
 * - Sélection multiple : le gizmo agit sur un pivot placé au centre des objets ; le même
 *   déplacement / rotation / échelle est appliqué à chacun (dans l'espace monde).
 * - Aimantation : pas de grille et d'angle (TransformControls), puis pose sur la surface.
 * - Aucun gizmo sur un objet verrouillé ou masqué, ni sur la caméra à travers laquelle on regarde.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TransformControls } from '@react-three/drei';
import { MathUtils, Matrix4, Object3D, Vector3 } from 'three';
import { applyTransaction, isEffectivelyLocked, isEffectivelyVisible, sameTransform, topLevelIds, type Operation, type Transform, type Vec3 } from '../core/index.ts';
import { execute, useEditor } from '../store/editorStore.ts';
import { surfaceSnapOps } from '../world/worldActions.ts';
import { gizmoPointerDown, gizmoPointerUp } from './interactionGuard.ts';
import { getObject3D } from './objectRegistry.ts';

const round = (v: number, digits: number) => {
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

function readTransform(object: Object3D): Transform {
  const p = object.position;
  const r = object.rotation;
  const s = object.scale;
  return {
    position: [round(p.x, 4), round(p.y, 4), round(p.z, 4)],
    rotation: [r.x, r.y, r.z].map((a) => round(MathUtils.radToDeg(a), 3)) as Vec3,
    scale: [round(s.x, 4), round(s.y, 4), round(s.z, 4)],
  };
}

function applyTransform(object: Object3D, t: Transform): void {
  object.position.set(...t.position);
  object.rotation.set(MathUtils.degToRad(t.rotation[0]), MathUtils.degToRad(t.rotation[1]), MathUtils.degToRad(t.rotation[2]), 'XYZ');
  object.scale.set(...t.scale);
}

function inScene(o: Object3D): boolean {
  let p: Object3D | null = o;
  while (p) {
    if ((p as { isScene?: boolean }).isScene) return true;
    p = p.parent;
  }
  return false;
}

/** Poignées plus grandes au doigt (écran tactile). */
const GIZMO_SIZE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 1.4 : 0.9;

const MODE_LABEL = { translate: 'Déplacer', rotate: 'Tourner', scale: 'Redimensionner' } as const;

/** Identifiants manipulables (racines de la sélection, déverrouillés, visibles). Chaîne pour une comparaison stable. */
function editableKey(s: ReturnType<typeof useEditor.getState>): string {
  const ids = topLevelIds(s.doc, s.selectedIds).filter(
    (id) => !isEffectivelyLocked(s.doc, id) && isEffectivelyVisible(s.doc, id) && s.lookThroughId !== id,
  );
  // Si un objet sélectionné est verrouillé, pas de gizmo du tout (évite de n'en déplacer qu'une partie).
  return ids.length === topLevelIds(s.doc, s.selectedIds).length ? ids.join('|') : '';
}

export function TransformGizmo() {
  const key = useEditor(editableKey);
  const mode = useEditor((s) => s.transformMode);
  const snap = useEditor((s) => s.snap);
  const ids = useMemo(() => (key ? key.split('|') : []), [key]);
  const docRevision = useEditor((s) => s.revision);
  const [targets, setTargets] = useState<{ key: string; objects: Object3D[] } | null>(null);
  const pivot = useMemo(() => new Object3D(), []);
  const start = useRef<{ pivot: Matrix4; worlds: Matrix4[] } | null>(null);

  // Les objets 3D sont enregistrés par les ObjectNode (callback ref), toujours avant les effets passifs.
  // Re-résolus après chaque modification : un objet reparenté est un nouvel Object3D. Effet de mise en page
  // (synchrone, avant la prochaine image) : le gizmo n'est jamais rendu attaché à un objet retiré de la scène.
  useLayoutEffect(() => {
    const objects = ids.map((id) => getObject3D(id)).filter((o): o is Object3D => !!o);
    setTargets(objects.length === ids.length && ids.length ? { key, objects } : null);
  }, [key, ids, docRevision]);

  // Pivot de la sélection multiple : centre des positions monde (recalculé après chaque modification).
  useEffect(() => {
    if (!targets || targets.objects.length < 2) return;
    const c = new Vector3();
    const tmp = new Vector3();
    for (const o of targets.objects) c.add(o.getWorldPosition(tmp));
    c.divideScalar(targets.objects.length);
    pivot.position.copy(c);
    pivot.rotation.set(0, 0, 0);
    pivot.scale.set(1, 1, 1);
    pivot.updateMatrixWorld(true);
  }, [targets, pivot, docRevision]);

  // Jamais de gizmo sur un Object3D qui n'est plus dans la scène (le temps que l'effet ci-dessus le remplace).
  const current = targets && targets.key === key && targets.objects.every(inScene) ? targets.objects : null;
  if (!current || !ids.length) return null;
  const multi = current.length > 1;

  const onDown = () => {
    gizmoPointerDown();
    if (!multi) return;
    pivot.updateMatrixWorld(true);
    start.current = { pivot: pivot.matrixWorld.clone(), worlds: current.map((o) => (o.updateWorldMatrix(true, false), o.matrixWorld.clone())) };
  };

  // Sélection multiple : applique au fil du geste la transformation du pivot à chaque objet.
  const onChange = () => {
    if (!multi || !start.current) return;
    pivot.updateMatrixWorld(true);
    const delta = pivot.matrixWorld.clone().multiply(start.current.pivot.clone().invert());
    current.forEach((o, i) => {
      const world = delta.clone().multiply(start.current!.worlds[i]);
      const parentInv = o.parent ? (o.parent.updateWorldMatrix(true, false), o.parent.matrixWorld.clone().invert()) : new Matrix4();
      parentInv.multiply(world).decompose(o.position, o.quaternion, o.scale);
    });
  };

  const commitGesture = () => {
    gizmoPointerUp();
    start.current = null;
    const state = useEditor.getState();
    const ops: Operation[] = [];
    ids.forEach((id, i) => {
      const obj = state.doc.objects[id];
      if (!obj) return;
      const next = readTransform(current[i]);
      if (!sameTransform(obj.transform, next)) ops.push({ type: 'update', id, changes: { transform: next } });
    });
    if (!ops.length) return;
    if (snap.surface && mode === 'translate') {
      try {
        const moved = applyTransaction(state.doc, { label: '', ops }).doc;
        ops.push(...surfaceSnapOps(moved, ids, { walls: !multi }));
      } catch {
        /* le document refusera la transaction ci-dessous et remettra les objets en place */
      }
    }
    const label = multi ? `${MODE_LABEL[mode]} ${ids.length} objets` : `${MODE_LABEL[mode]} ${state.doc.objects[ids[0]].name}`;
    const ok = execute({ label, ops });
    // Si la modification est refusée, les objets 3D reviennent à l'état du document.
    if (!ok) ids.forEach((id, i) => state.doc.objects[id] && applyTransform(current[i], state.doc.objects[id].transform));
  };

  return (
    <>
      {multi && <primitive object={pivot} />}
      <TransformControls
        object={multi ? pivot : current[0]}
        mode={mode}
        size={GIZMO_SIZE}
        translationSnap={snap.enabled ? snap.translate : null}
        rotationSnap={snap.enabled ? MathUtils.degToRad(snap.rotate) : null}
        scaleSnap={snap.enabled ? 0.1 : null}
        onMouseDown={onDown}
        onObjectChange={onChange}
        onMouseUp={commitGesture}
      />
    </>
  );
}

