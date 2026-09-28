/**
 * Rendu d'UN objet de scène, identifié par son id.
 *
 * Chaque ObjectNode s'abonne uniquement à son propre objet dans le store :
 * modifier un objet ne re-rend que ce nœud, pas tout le viewport.
 * Les groupes n'ont pas de géométrie propre : leur transform s'applique à leurs enfants.
 */
import { memo, useCallback, useEffect, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { MathUtils, MeshStandardMaterial, type Object3D } from 'three';
import { ancestorsOf, boxCenter, boxSize, objectLocalBox, type MaterialProps, type ObjectId, type SceneDocument, type SceneObject } from '../../core/index.ts';
import { useAssetStatus } from '../../assets/assetStatus.ts';
import { select, useEditor } from '../../store/editorStore.ts';
import { worldContext } from '../../world/worldContext.ts';
import { CLICK_DRAG_THRESHOLD_PX, shouldIgnoreClick } from '../interactionGuard.ts';
import { registerObject } from '../objectRegistry.ts';
import { GEOMETRIES, SELECTION_COLOR } from '../sharedResources.ts';
import { CameraVisual } from './CameraVisual.tsx';
import { ElementContent } from './ElementContent.tsx';
import { ModelContent } from './ModelContent.tsx';

const noRaycast = () => null;

/**
 * Objet à sélectionner quand on clique sur `clickedId` : d'abord le groupe le plus haut, puis,
 * à chaque nouveau clic, un niveau plus profond (groupe → mur → porte). La hiérarchie permet
 * toujours de sélectionner directement n'importe quel objet.
 */
export function clickTarget(doc: SceneDocument, clickedId: ObjectId, current: ObjectId | null): ObjectId {
  const chain = [...ancestorsOf(doc, clickedId).reverse(), clickedId];
  if (current) {
    const i = chain.indexOf(current);
    if (i >= 0) return chain[Math.min(i + 1, chain.length - 1)];
    // La sélection courante est un descendant plus profond (ex. clic sur un autre enfant du même groupe).
  }
  return chain[0];
}

/** Boîte de sélection (repère local de l'objet), calculée seulement quand l'objet est sélectionné. */
function useSelectionBox(id: ObjectId, selected: boolean): { size: [number, number, number]; center: [number, number, number] } | null {
  const assetBoxes = useAssetStatus((s) => (selected ? s.byId : null));
  const key = useEditor((s) => {
    if (!selected || !s.doc.objects[id]) return '';
    const box = objectLocalBox(s.doc, id, worldContext(s.doc));
    return box ? JSON.stringify(box) : '';
  });
  return useMemo(() => {
    void assetBoxes;
    if (!key) return null;
    const b = JSON.parse(key);
    const size = boxSize(b).map((v) => Math.max(v * 1.02 + 0.01, 0.02)) as [number, number, number];
    return { size, center: boxCenter(b) as [number, number, number] };
  }, [key, assetBoxes]);
}

function PrimitiveMesh({ type, material }: { type: 'box' | 'sphere'; material: MaterialProps }) {
  const mat = useMemo(() => new MeshStandardMaterial(), []);
  useEffect(() => () => mat.dispose(), [mat]);
  mat.color.set(material.color);
  mat.roughness = material.roughness;
  mat.metalness = material.metalness;
  mat.opacity = material.opacity;
  mat.transparent = material.opacity < 1;
  mat.depthWrite = material.opacity >= 1;
  return <mesh geometry={GEOMETRIES[type]} material={mat} castShadow receiveShadow />;
}

function ObjectContent({ obj, lookingThrough }: { obj: SceneObject; lookingThrough: boolean }) {
  switch (obj.type) {
    case 'box':
    case 'sphere':
      return <PrimitiveMesh type={obj.type} material={obj.material} />;
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
    case 'element':
      return <ElementContent obj={obj} />;
    case 'group':
      return null;
  }
}

export const ObjectNode = memo(function ObjectNode({ id }: { id: ObjectId }) {
  const obj = useEditor((s) => s.doc.objects[id]);
  const selected = useEditor((s) => s.selectedIds.includes(id));
  const primary = useEditor((s) => s.selectedId === id);
  const lookingThrough = useEditor((s) => s.lookThroughId === id);
  const selectionBox = useSelectionBox(id, selected);

  const ref = useCallback((node: Object3D | null) => registerObject(id, node), [id]);

  const onClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      // Un orbit/pan ou une manipulation du gizmo ne doit pas changer la sélection.
      if (e.delta > CLICK_DRAG_THRESHOLD_PX || shouldIgnoreClick()) return;
      e.stopPropagation();
      const s = useEditor.getState();
      const toggle = e.shiftKey || e.metaKey || e.ctrlKey;
      const target = clickTarget(s.doc, id, toggle ? null : s.selectedId);
      select(target, toggle ? 'toggle' : 'replace');
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
      {selected && !lookingThrough && selectionBox && (
        <lineSegments geometry={GEOMETRIES.selectionBox} scale={selectionBox.size} position={selectionBox.center} raycast={noRaycast} renderOrder={10}>
          <lineBasicMaterial color={primary ? SELECTION_COLOR : '#9cc9ff'} depthTest={false} transparent opacity={primary ? 0.95 : 0.7} toneMapped={false} />
        </lineSegments>
      )}
      {obj.children.map((childId) => (
        <ObjectNode key={childId} id={childId} />
      ))}
    </group>
  );
});
