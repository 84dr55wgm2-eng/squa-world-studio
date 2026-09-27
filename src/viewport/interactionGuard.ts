/**
 * Évite les conflits entre le gizmo et la sélection au clic.
 *
 * Quand on relâche la souris après avoir manipulé le gizmo, le navigateur émet
 * aussi un « click ». Sans garde, ce clic désélectionnerait l'objet (clic dans le
 * vide) ou sélectionnerait l'objet situé derrière la poignée du gizmo.
 */
let gizmoActive = false;
let lastGizmoRelease = 0;
const GRACE_MS = 250;

export function gizmoPointerDown(): void {
  gizmoActive = true;
}

export function gizmoPointerUp(): void {
  gizmoActive = false;
  lastGizmoRelease = performance.now();
}

/** Vrai si un clic doit être ignoré parce qu'il provient d'une manipulation du gizmo. */
export function shouldIgnoreClick(): boolean {
  return gizmoActive || performance.now() - lastGizmoRelease < GRACE_MS;
}

/** Au-delà de ce déplacement (px) entre appui et relâchement, le geste est un orbit/pan, pas un clic. */
export const CLICK_DRAG_THRESHOLD_PX = 4;
