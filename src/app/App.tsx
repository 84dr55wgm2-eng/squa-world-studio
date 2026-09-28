/** Mise en page de l'éditeur. Aucune logique ici : chaque zone est un module indépendant. */
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../editor/ConfirmDialog.tsx';
import { MobileTabs, type MobileTab } from '../editor/MobileTabs.tsx';
import { useEditor } from '../store/editorStore.ts';
import { useViewportDrop } from '../editor/useViewportDrop.ts';
import { loadLibrary } from '../assets/library.ts';
import { Notice } from '../editor/Notice.tsx';
import { Library } from '../editor/panels/Library.tsx';
import { PropertiesPanel } from '../editor/panels/PropertiesPanel.tsx';
import { SceneHierarchy } from '../editor/panels/SceneHierarchy.tsx';
import { useKeyboardShortcuts } from '../editor/shortcuts.ts';
import { TopBar } from '../editor/TopBar.tsx';
import { ValidatorPanel, WorldDialogs } from '../editor/WorldDialogs.tsx';
import { ViewportHelp } from '../editor/ViewportHelp.tsx';
import { startAutosave } from '../io/autosave.ts';
import { Viewport } from '../viewport/Viewport.tsx';
import { ViewportErrorBoundary, ViewportMessage, isWebGLAvailable } from '../viewport/ViewportGuard.tsx';

// Évalué une seule fois au chargement de la page.
const WEBGL_OK = isWebGLAvailable();

export function App() {
  useKeyboardShortcuts();
  useEffect(() => startAutosave(), []);
  useEffect(() => {
    void loadLibrary();
  }, []);
  const drop = useViewportDrop();

  // Sur petit écran, un seul panneau est visible à la fois sous la vue 3D (sans effet sur ordinateur).
  const [mobileTab, setMobileTab] = useState<MobileTab>('scene');
  const selectedId = useEditor((s) => s.selectedId);
  useEffect(() => {
    // Après un ajout ou une sélection dans la vue, on montre les propriétés — sauf depuis la hiérarchie.
    if (selectedId) setMobileTab((t) => (t === 'scene' ? t : 'props'));
  }, [selectedId]);

  return (
    <div className="app" data-mobile-tab={mobileTab}>
      <TopBar />
      <aside className="panel panel-left">
        <SceneHierarchy />
        <Library />
      </aside>
      <main className={`viewport ${drop.over ? 'is-drop-target' : ''}`} {...drop.handlers}>
        {WEBGL_OK ? (
          <ViewportErrorBoundary>
            <Viewport />
          </ViewportErrorBoundary>
        ) : (
          <ViewportMessage
            title="WebGL n'est pas disponible dans ce navigateur."
            detail="La vue 3D nécessite WebGL (Chrome, Safari, Firefox ou Edge récents, accélération matérielle activée)."
          />
        )}
        <ViewportHelp />
        <ValidatorPanel />
        <Notice />
      </main>
      <MobileTabs value={mobileTab} onChange={setMobileTab} />
      <aside className="panel panel-right">
        <PropertiesPanel />
      </aside>
      <WorldDialogs />
      <ConfirmDialog />
    </div>
  );
}
