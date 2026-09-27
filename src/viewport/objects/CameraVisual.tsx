/** Représentation visuelle d'un objet Caméra : corps, objectif et pyramide de vision (16:9). */
import { useEffect, useMemo } from 'react';
import { BufferGeometry, DoubleSide, Float32BufferAttribute, MathUtils } from 'three';
import { GEOMETRIES } from '../sharedResources.ts';

const FRUSTUM_DEPTH = 1.2;
const ASPECT = 16 / 9;
const noRaycast = () => null;

function buildFrustum(fov: number): BufferGeometry {
  const h = Math.tan(MathUtils.degToRad(fov) / 2) * FRUSTUM_DEPTH;
  const w = h * ASPECT;
  const z = -FRUSTUM_DEPTH;
  const corners = [
    [-w, -h, z],
    [w, -h, z],
    [w, h, z],
    [-w, h, z],
  ];
  const v: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    v.push(0, 0, 0, ...a); // arête depuis le centre optique
    v.push(...a, ...b); // bord du cadre
  }
  // Petit triangle au-dessus du cadre : indique le haut de l'image.
  v.push(-w * 0.3, h * 1.05, z, 0, h * 1.35, z, 0, h * 1.35, z, w * 0.3, h * 1.05, z);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(v, 3));
  return geometry;
}

export function CameraVisual({ fov, hidden = false }: { fov: number; hidden?: boolean }) {
  const frustum = useMemo(() => buildFrustum(fov), [fov]);
  useEffect(() => () => frustum.dispose(), [frustum]);
  return (
    <group visible={!hidden}>
      <mesh geometry={GEOMETRIES.cameraBody}>
        <meshStandardMaterial color="#3a3f4b" roughness={0.6} />
      </mesh>
      <mesh geometry={GEOMETRIES.cameraLens}>
        <meshStandardMaterial color="#1d2027" roughness={0.4} side={DoubleSide} />
      </mesh>
      <lineSegments geometry={frustum} raycast={noRaycast}>
        <lineBasicMaterial color="#e8c35a" transparent opacity={0.8} toneMapped={false} />
      </lineSegments>
    </group>
  );
}
