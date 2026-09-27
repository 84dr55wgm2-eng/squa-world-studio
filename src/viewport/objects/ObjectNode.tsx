/**
 * Rendu d'UN objet de scène, identifié par son id.
 *
 * Chaque ObjectNode s'abonne uniquement à son propre objet dans le store :
 * modifier un objet ne re-rend que ce nœud, pas tout le viewport.
 */
import { memo, useCallback, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { Object3D } from 'three';
import { MathUtils } from 'three';
import { boxCenter, boxSize, localBoxOf, type ObjectId, type SceneObject } from '../../core/index.ts';
import { useAssetStatus } from '../../assets/assetStatus.ts';
import { select, useEditor } from '../../store/editorStore.ts';
import { CLICK_DRAG_THRESHOLD_PX, shouldIgnoreClick } from '../interactionGuard.ts';
import { registerObject } from '../objectRegistry.ts';
import { GEOMETRIES, SELECTION_COLOR } from '../sharedResources.ts';
import { CameraVisual } from './CameraVisual.tsx';
import { ModelContent } from './ModelContent.tsx';

const noRaycast = () => null;

/** Taille du contour de sélection (cube unité mis à l'échelle), par type. */
const SELECTION_SIZE: Record<SceneObject['type'], [number, number, number]> = {
  box: [1.04, 1.04, 1.04],
  sphere: [1.04, 1.04, 1.04],
  light: [0.34, 0.34, 0.34],
  camera: [0.36, 0.28, 0.72],
  model: [1, 1, 1], // remplacé par la boîte réelle du modèle une fois chargé
};
const SELECTION_OFFSET: Record<SceneObject['type'], [number, number, number]> = {
  box: [0, 0, 0],
  sphere: [0, 0, 0],
  light: [0, 0, 0],
  camera: [0, 0, -0.07],
  model: [0, 0.5, 0],
};

/** Contour de sélection d'un modèle : sa boîte englobante réelle (légèrement agrandie). */
function useSelectionBox(obj: SceneObject | undefined): { size: [number, number, number]; center: [number, number, number] } {
  const nativeBox = useAssetStatus((s) => (obj?.type === 'model' ? s.byId[obj.model.assetId]?.nativeBox : undefined));
  return useMemo(() => {
    if (!obj) return { size: [1, 1, 1], center: [0, 0, 0] };
    if (obj.type === 'model' && nativeBox) {
      const b = localBoxOf(obj, nativeBox)!;
      const size = boxSize(b).map((v) => Math.max(v * 1.02, 0.02)) as [number, number, number];
      return { size, center: boxCenter(b) as [number, number, number] };
    }
    return { size: SELECTION_SIZE[obj.type], center: SELECTION_OFFSET[obj.type] };
  }, [obj, nativeBox]);
}

function ObjectContent({ obj, lookingThrough }: { obj: SceneObject; lookingThrough: boolean }) {
  switch (obj.type) {
    case 'box':
    case 'sphere':
      return (
        <mesh geometry={GEOMETRIES[obj.type]} castShadow receiveShadow>
          <meshStandardMaterial color={obj.material.color} roughness={0.7} metalness={0} />
        </mesh>
      );
    case 'light':
      return (
        <>
          <pointLight color={obj.light.color} intensity={obj.light.intensity} distance={obj.light.distance} decay={2} />
          <mesh geometry={GEOMETRIES.lightHandle}>
            <meshBasicMaterial color={obj.light.color} toneMapped={false} />
          </mesh>
        </>
      );
    case 'camera':
      return <CameraVisual fov={obj.camera.fov} hidden={lookingThrough} />;
    case 'model':
      return <ModelContent obj={obj} />;
  }
}

export const ObjectNode = memo(function ObjectNode({ id }: { id: ObjectId }) {
  const obj = useEditor((s) => s.doc.objects[id]);
  const selected = useEditor((s) => s.selectedId === id);
  const lookingThrough = useEditor((s) => s.lookThroughId === id);
  const selectionBox = useSelectionBox(obj);

  const ref = useCallback((node: Object3D | null) => registerObject(id, node), [id]);

  const onClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      // Un orbit/pan ou une manipulation du gizmo ne doit pas changer la sélection.
      if (e.delta > CLICK_DRAG_THRESHOLD_PX || shouldIgnoreClick()) return;
      e.stopPropagation();
      select(id);
    },
    [id],
  );

  if (!obj) return null;
  const { position, rotation, scale } = obj.transform;

  return (
    <group
      ref={ref}
      name={obj.name}
      userData={{ squaId: id }}
      position={position}
      rotation={[MathUtils.degToRad(rotation[0]), MathUtils.degToRad(rotation[1]), MathUtils.degToRad(rotation[2]), 'XYZ']}
      scale={scale}
      visible={obj.visible}
      // Un objet masqué (ou la caméra à travers laquelle on regarde) n'est pas cliquable dans le viewport ;
      // il reste sélectionnable dans la hiérarchie.
      onClick={obj.visible && !lookingThrough ? onClick : undefined}
    >
      <ObjectContent obj={obj} lookingThrough={lookingThrough} />
      {selected && !lookingThrough && (
        <lineSegments
          geometry={GEOMETRIES.selectionBox}
          scale={selectionBox.size}
          position={selectionBox.center}
          raycast={noRaycast}
        >
          <lineBasicMaterial color={SELECTION_COLOR} depthTest={false} transparent opacity={0.9} toneMapped={false} />
        </lineSegments>
      )}
      {obj.children.map((childId) => (
        <ObjectNode key={childId} id={childId} />
      ))}
    </group>
  );
});
