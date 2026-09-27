/**
 * Affichage d'une instance de modèle 3D.
 *
 * Emboîtement (de l'extérieur vers l'intérieur, sous le groupe de l'objet) :
 *   pivot (décalage) → orientation + unité → clone du modèle
 * Le fichier d'origine n'est jamais modifié.
 */
import { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { MathUtils, type Mesh, type Object3D } from 'three';
import { normalizeModel, type ModelObject } from '../../core/index.ts';
import { acquireAsset, instantiate, releaseAsset } from '../../assets/assetCache.ts';
import { useAssetStatus } from '../../assets/assetStatus.ts';
import { useEditor } from '../../store/editorStore.ts';
import { GEOMETRIES } from '../sharedResources.ts';

/** Petit repère affiché tant que le modèle charge, ou s'il n'a pas pu être chargé (reste sélectionnable). */
function StatusMarker({ error }: { error: boolean }) {
  return (
    <mesh geometry={GEOMETRIES.box} position={[0, 0.5, 0]}>
      <meshBasicMaterial color={error ? '#e5534b' : '#7d8596'} wireframe transparent opacity={error ? 0.9 : 0.5} toneMapped={false} />
    </mesh>
  );
}

export function ModelContent({ obj }: { obj: ModelObject }) {
  const { assetId, pivot, orientation, unitScale, castShadow, receiveShadow } = obj.model;
  const record = useEditor((s) => s.doc.assets[assetId]);
  const info = useAssetStatus((s) => s.byId[assetId]);
  const invalidate = useThree((s) => s.invalidate);
  const [template, setTemplate] = useState<{ id: string; root: Object3D } | null>(null);

  // Une réservation par instance : le premier charge, les suivants réutilisent le cache.
  useEffect(() => {
    if (!record) return;
    let alive = true;
    acquireAsset(record).then(
      (root) => alive && setTemplate({ id: assetId, root }),
      () => alive && setTemplate(null),
    );
    return () => {
      alive = false;
      releaseAsset(assetId);
    };
    // La source d'un asset ne change pas pour un même identifiant ; après le chargement
    // d'une autre scène, les objets sont remontés (clé docEpoch), ce qui relance le chargement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  const instance = useMemo(() => (template && template.id === assetId ? instantiate(template.root) : null), [template, assetId]);

  useEffect(() => {
    if (!instance) return;
    instance.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.castShadow = castShadow;
        m.receiveShadow = receiveShadow;
      }
    });
    invalidate();
  }, [instance, castShadow, receiveShadow, invalidate]);

  const pivotOffset = useMemo(
    () => (info?.nativeBox ? normalizeModel(info.nativeBox, { pivot, orientation, unitScale }).pivotOffset : ([0, 0, 0] as const)),
    [info?.nativeBox, pivot, orientation, unitScale],
  );

  if (!record || info?.status === 'error') return <StatusMarker error />;
  if (!instance) return <StatusMarker error={false} />;
  return (
    <group position={pivotOffset as [number, number, number]}>
      <group
        rotation={[MathUtils.degToRad(orientation[0]), MathUtils.degToRad(orientation[1]), MathUtils.degToRad(orientation[2]), 'XYZ']}
        scale={unitScale}
      >
        <primitive object={instance} />
      </group>
    </group>
  );
}
