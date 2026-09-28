/**
 * Accès de diagnostic, activé seulement avec « ?debug » dans l'URL : lecture de l'état,
 * projection écran d'un point 3D (pour piloter le gizmo dans les tests), exécution de
 * commandes structurées, mesure d'images par seconde. Aucune influence sur l'usage normal.
 */
import { useEditor } from '../store/editorStore.ts';
import { invalidateView, projectToScreen } from '../viewport/cameraController.ts';
import { runCommands } from '../world/worldActions.ts';
import type { Vec3, WorldCommand } from '../core/index.ts';
import { worldTransform } from '../core/index.ts';

export function installDebugHooks(): void {
  (window as unknown as { __squa: unknown }).__squa = {
    state: () => useEditor.getState(),
    worldTransform: (id: string) => worldTransform(useEditor.getState().doc, id),
    project: (p: Vec3) => projectToScreen(p),
    run: (cmds: WorldCommand[]) => {
      const r = runCommands(cmds);
      return r.ok ? { ok: true, aliases: r.aliases, created: r.created } : r;
    },
    /** Images par seconde pendant `ms` millisecondes, en forçant le rendu continu. */
    fps: (ms = 2000) =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const t0 = performance.now();
        const tick = () => {
          frames++;
          invalidateView();
          if (performance.now() - t0 < ms) requestAnimationFrame(tick);
          else resolve((frames * 1000) / (performance.now() - t0));
        };
        requestAnimationFrame(tick);
      }),
  };
}
