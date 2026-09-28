/**
 * Affichage d'un élément paramétrique (mur, sol, porte, fenêtre, route…).
 * Un mur se découpe automatiquement autour des portes et fenêtres qui lui sont fixées.
 */
import { useEffect, useMemo } from 'react';
import { MeshStandardMaterial } from 'three';
import type { ElementObject, SceneDocument } from '../../core/index.ts';
import { useEditor } from '../../store/editorStore.ts';
import { PART_MATERIALS, claimElementGeometry, elementKey, peekElementGeometry, releaseElementGeometry, type Opening, type PartKind } from './elementGeometry.ts';

/** Ouvertures d'un mur : ses enfants porte / fenêtre non tournés, dans le repère du mur. */
export function wallOpeningsKey(doc: SceneDocument, wallId: string): string {
  const wall = doc.objects[wallId];
  if (!wall || wall.type !== 'element' || wall.element.shape !== 'wall') return '';
  const out: Opening[] = [];
  for (const cid of wall.children) {
    const c = doc.objects[cid];
    if (!c || !c.visible || c.type !== 'element' || (c.element.shape !== 'door' && c.element.shape !== 'window')) continue;
    const { position, rotation, scale } = c.transform;
    if (rotation.some((r) => Math.abs(r % 360) > 0.01)) continue;
    const w = c.element.size[0] * scale[0], h = c.element.size[1] * scale[1];
    out.push({ x0: position[0] - w / 2, x1: position[0] + w / 2, y0: position[1], y1: position[1] + h });
  }
  return JSON.stringify(out);
}

const SHADOWLESS: PartKind[] = ['glass', 'facade', 'marking', 'lamp', 'screen'];

export function ElementContent({ obj }: { obj: ElementObject }) {
  const openingsKey = useEditor((s) => (obj.element.shape === 'wall' ? wallOpeningsKey(s.doc, obj.id) : ''));
  const openings = useMemo(() => (openingsKey ? (JSON.parse(openingsKey) as Opening[]) : []), [openingsKey]);
  const key = elementKey(obj.element, openings);

  // Géométrie partagée entre éléments identiques : lue pendant le rendu, réservée / libérée par l'effet.
  const parts = useMemo(() => peekElementGeometry(key, obj.element, openings), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    claimElementGeometry(key);
    return () => releaseElementGeometry(key);
  }, [key]);

  const { color, roughness, metalness, opacity } = obj.element.material;
  const main = useMemo(() => new MeshStandardMaterial(), []);
  useEffect(() => () => main.dispose(), [main]);
  main.color.set(color);
  main.roughness = roughness;
  main.metalness = metalness;
  main.opacity = opacity;
  main.transparent = opacity < 1;
  main.depthWrite = opacity >= 1;

  return (
    <>
      {(Object.entries(parts) as [PartKind, NonNullable<(typeof parts)[PartKind]>][]).map(([kind, geometry]) => (
        <mesh
          key={kind}
          geometry={geometry}
          material={kind === 'main' ? main : PART_MATERIALS[kind]}
          castShadow={!SHADOWLESS.includes(kind)}
          receiveShadow={kind !== 'lamp'}
        />
      ))}
    </>
  );
}
