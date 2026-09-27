import { renameProjectTx } from '../core/index.ts';
import { createNewProject, openProject, saveProject } from '../io/projectActions.ts';
import { execute, redo, selectIsDirty, setTransformMode, undo, useEditor, type TransformMode } from '../store/editorStore.ts';
import { resetView } from '../viewport/cameraController.ts';
import { IconFile, IconHome, IconMove, IconOpen, IconRedo, IconRotate, IconSave, IconScale, IconUndo } from './icons.tsx';
import { TextField } from './widgets/TextField.tsx';

const MODES: { mode: TransformMode; label: string; key: string; Icon: typeof IconMove }[] = [
  { mode: 'translate', label: 'Déplacer', key: 'W', Icon: IconMove },
  { mode: 'rotate', label: 'Tourner', key: 'E', Icon: IconRotate },
  { mode: 'scale', label: 'Échelle', key: 'R', Icon: IconScale },
];

export function TopBar() {
  const projectName = useEditor((s) => s.doc.project.name);
  const dirty = useEditor(selectIsDirty);
  const undoLabel = useEditor((s) => s.history.past[s.history.past.length - 1]?.label);
  const redoLabel = useEditor((s) => s.history.future[0]?.label);
  const mode = useEditor((s) => s.transformMode);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">SQUA</span>
        <span className="brand-sub">World Studio</span>
      </div>

      <div className="project-name">
        <TextField
          value={projectName}
          ariaLabel="Nom du projet"
          onCommit={(name) => execute(renameProjectTx(useEditor.getState().doc, name))}
        />
        <span className={`save-state ${dirty ? 'is-dirty' : ''}`}>{dirty ? 'Non enregistré' : 'Enregistré'}</span>
      </div>

      <div className="toolbar-group">
        <button type="button" className="tb-btn" onClick={() => void createNewProject()} title="Nouvelle scène vide">
          <IconFile /> <span className="tb-label">Nouveau</span>
        </button>
        <button type="button" className="tb-btn" onClick={() => void openProject()} title="Ouvrir un fichier .squa.json (⌘/Ctrl O)">
          <IconOpen /> <span className="tb-label">Ouvrir</span>
        </button>
        <button type="button" className="tb-btn" onClick={() => void saveProject()} title="Télécharger la scène en .squa.json (⌘/Ctrl S)">
          <IconSave /> <span className="tb-label">Enregistrer</span>
        </button>
      </div>

      <div className="toolbar-group">
        <button type="button" className="tb-btn icon-only" onClick={undo} disabled={!undoLabel} title={undoLabel ? `Annuler : ${undoLabel} (⌘/Ctrl Z)` : 'Rien à annuler'} aria-label="Annuler">
          <IconUndo />
        </button>
        <button type="button" className="tb-btn icon-only" onClick={redo} disabled={!redoLabel} title={redoLabel ? `Rétablir : ${redoLabel} (⇧⌘Z / Ctrl Y)` : 'Rien à rétablir'} aria-label="Rétablir">
          <IconRedo />
        </button>
      </div>

      <div className="toolbar-group segmented" role="radiogroup" aria-label="Outil de transformation">
        {MODES.map(({ mode: m, label, key, Icon }) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            className={`tb-btn ${mode === m ? 'is-active' : ''}`}
            onClick={() => setTransformMode(m)}
            title={`${label} (${key})`}
          >
            <Icon /> <span className="tb-label">{label}</span>
          </button>
        ))}
      </div>

      <div className="toolbar-group">
        <button type="button" className="tb-btn" onClick={resetView} title="Revenir à la vue par défaut (H)">
          <IconHome /> <span className="tb-label">Vue par défaut</span>
        </button>
      </div>
    </header>
  );
}
