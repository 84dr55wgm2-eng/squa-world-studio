/**
 * Contexte compact d'une scène pour une modification locale par IA : ce que le modèle doit savoir
 * pour viser les bons objets (ids, noms, rôles, parents, positions, dimensions), sans géométrie.
 */
import { isEffectivelyLocked, objectSpatial, type SceneDocument } from '../core/index.ts';
import { worldContext } from '../world/worldContext.ts';

const r = (v: number) => Math.round(v * 100) / 100;

export function buildSceneContext(doc: SceneDocument, selectedIds: string[] = [], limit = 400) {
  const ctx = worldContext(doc);
  const objects = Object.values(doc.objects)
    .slice(0, limit)
    .map((o) => {
      const s = objectSpatial(doc, o.id, ctx);
      return {
        id: o.id,
        name: o.name,
        role: o.semanticRole,
        type: o.type === 'element' ? o.element.shape : o.type === 'model' ? o.model.assetId.replace(/^lib:/, '') : o.type,
        parent: o.parentId,
        ...(s ? { position: [r(s.center[0]), r(s.base), r(s.center[2])], size: [r(s.width), r(s.height), r(s.depth)], yaw: r(s.obb.yaw) } : {}),
        ...(o.type === 'element' || o.type === 'box' || o.type === 'sphere' ? { color: o.type === 'element' ? o.element.material.color : o.material.color } : {}),
        ...(o.type === 'model' && o.model.materialOverride?.color ? { color: o.model.materialOverride.color } : {}),
        ...(isEffectivelyLocked(doc, o.id) ? { locked: true } : {}),
      };
    });
  return {
    title: doc.project.name,
    selected: selectedIds,
    conventions: 'Mètres, Y vers le haut. Murs de pièce : « Mur nord » = côté -Z, « Mur sud » = +Z, « Mur est » = +X, « Mur ouest » = -X.',
    objects,
    truncated: Object.keys(doc.objects).length > limit,
  };
}
