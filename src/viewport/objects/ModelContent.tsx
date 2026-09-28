/**
 * Affichage d'une instance de modèle 3D.
 *
 * Emboîtement (de l'extérieur vers l'intérieur, sous le groupe de l'objet) :
 *   pivot (décalage) → orientation + unité → clone du modèle
 * Le fichier d'origine n'est jamais modifié.
 */
import { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { MathUtils, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
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

  // Surcharge de matériau : chaque instance reçoit ses propres copies des matériaux (le fichier
  // et les autres instances ne sont pas touchés). « Réinitialiser » rend les matériaux d'origine.
  const override = obj.model.materialOverride;
  const overrideKey = override ? JSON.stringify(override) : '';
  useEffect(() => {
    if (!instance) return;
    instance.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const original = (m.userData.squaOriginalMaterial ??= m.material) as Material | Material[];
      if (!override) {
        if (m.material !== original) {
          (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
          m.material = original;
        }
        return;
      }
      if (m.material === original) m.material = Array.isArray(original) ? original.map((x) => x.clone()) : original.clone();
      const origList = Array.isArray(original) ? original : [original];
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat, i) => {
        const std = mat as MeshStandardMaterial;
        const src = origList[i] as MeshStandardMaterial;
        if (override.color !== undefined && std.color) std.color.set(override.color);
        else if (std.color && src.color) std.color.copy(src.color);
        if ('roughness' in std) std.roughness = override.roughness ?? src.roughness;
        if ('metalness' in std) std.metalness = override.metalness ?? src.metalness;
        const opacity = override.opacity ?? src.opacity;
        std.opacity = opacity;
        std.transparent = src.transparent || opacity < 1;
        std.depthWrite = src.depthWrite && opacity >= 1;
        std.needsUpdate = true;
      });
    });
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance, overrideKey, invalidate]);

  // Libère les copies de matériaux de cette instance.
  useEffect(
    () => () => {
      instance?.traverse((o) => {
        const m = o as Mesh;
        const original = m.userData?.squaOriginalMaterial;
        if (m.isMesh && original && m.material !== original) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
      });
    },
    [instance],
  );

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
