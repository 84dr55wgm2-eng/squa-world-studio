/**
 * Gizmo de transformation (déplacer / tourner / mettre à l'échelle).
 *
 * - Pendant la manipulation, Three.js modifie directement l'objet 3D : aucun
 *   passage par le store, donc aucun re-rendu React à chaque mouvement de souris.
 * - Au relâchement, UNE transaction est enregistrée (= un seul undo par geste).
 * - Les OrbitControls sont désactivés pendant la manipulation (géré par Drei car
 *   les OrbitControls sont déclarés `makeDefault`).
 * - Aucun gizmo sur un objet verrouillé ou masqué, ni sur la caméra à travers laquelle on regarde.
 */
import { useEffect, useState } from 'react';
import { TransformControls } from '@react-three/drei';
import { MathUtils, type Object3D } from 'three';
import { isEffectivelyLocked, isEffectivelyVisible, setTransformTx, type Transform, type Vec3 } from '../core/index.ts';
import { execute, useEditor } from '../store/editorStore.ts';
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

/** Poignées plus grandes au doigt (écran tactile). */
const GIZMO_SIZE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 1.4 : 0.9;

const MODE_LABEL = { translate: 'Déplacer', rotate: 'Tourner', scale: 'Redimensionner' } as const;

export function TransformGizmo() {
  const selectedId = useEditor((s) => s.selectedId);
  const editable = useEditor(
    (s) =>
      !!s.selectedId &&
      !!s.doc.objects[s.selectedId] &&
      !isEffectivelyLocked(s.doc, s.selectedId) &&
      isEffectivelyVisible(s.doc, s.selectedId) &&
      s.lookThroughId !== s.selectedId, // pas de gizmo sur la caméra à travers laquelle on regarde
  );
  const mode = useEditor((s) => s.transformMode);
  const [resolved, setResolved] = useState<{ id: string; object: Object3D } | null>(null);

  // L'objet 3D est enregistré par son ObjectNode (callback ref), toujours avant les effets passifs.
  useEffect(() => {
    const object = selectedId ? getObject3D(selectedId) : undefined;
    setResolved(selectedId && object ? { id: selectedId, object } : null);
  }, [selectedId]);

  // Ne jamais utiliser un objet 3D résolu pour une sélection précédente.
  const target = resolved && resolved.id === selectedId ? resolved.object : null;
  if (!selectedId || !target || !editable) return null;

  const commitGesture = () => {
    gizmoPointerUp();
    const state = useEditor.getState();
    const obj = state.doc.objects[selectedId];
    if (!obj) return;
    const next = readTransform(target);
    const ok = execute(setTransformTx(state.doc, selectedId, next, `${MODE_LABEL[mode]} ${obj.name}`));
    // Si la modification est refusée, l'objet 3D revient à l'état du document.
    if (!ok) applyTransform(target, obj.transform);
  };

  return (
    <TransformControls
      object={target}
      mode={mode}
      size={GIZMO_SIZE}
      onMouseDown={gizmoPointerDown}
      onMouseUp={commitGesture}
    />
  );
}
