/**
 * Correspondance identifiant de scène → Object3D Three.js rendu.
 * Permet au gizmo, au cadrage caméra, etc. d'accéder à l'objet 3D sans
 * parcourir la scène ni stocker d'objets Three.js dans le store.
 */
import type { Object3D } from 'three';
import type { ObjectId } from '../core/index.ts';

const registry = new Map<ObjectId, Object3D>();

export function registerObject(id: ObjectId, object: Object3D | null): void {
  if (object) registry.set(id, object);
  else registry.delete(id);
}

export function getObject3D(id: ObjectId): Object3D | undefined {
  return registry.get(id);
}
