import { useState } from 'react';
import { renameProjectTx } from '../core/index.ts';
import { openProject, saveProject } from '../io/projectActions.ts';
import { execute, redo, selectIsDirty, setSnap, setTransformMode, setValidatorOpen, undo, useEditor, type SnapSettings, type TransformMode } from '../store/editorStore.ts';
import { resetView } from '../viewport/cameraController.ts';
import { IconCode, IconFile, IconHome, IconMagnet, IconMove, IconOpen, IconRedo, IconRotate, IconSave, IconScale, IconShield, IconUndo } from './icons.tsx';
import { openDialog } from './WorldDialogs.tsx';
import { toggleWorldPanel, useWorldPanel } from './CreateWorldPanel.tsx';
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
  const validatorOpen = useEditor((s) => s.validatorOpen);
  const worldOpen = useWorldPanel((s) => s.open);

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
        <button type="button" className={`tb-btn tb-create ${worldOpen ? 'is-active' : ''}`} aria-pressed={worldOpen} aria-label="Créer un monde" onClick={() => toggleWorldPanel()} title="Décrire un lieu et générer un monde 3D éditable">
          <span aria-hidden="true">✦</span> <span className="tb-label">Créer un monde</span>
        </button>
      </div>

      <div className="toolbar-group">
        <button type="button" className="tb-btn" aria-label="Nouveau" onClick={() => openDialog('templates')} title="Nouvelle scène : vide, pièce intérieure ou rue">
          <IconFile /> <span className="tb-label">Nouveau</span>
        </button>
        <button type="button" className="tb-btn" aria-label="Ouvrir" onClick={() => void openProject()} title="Ouvrir un fichier .squa (⌘/Ctrl O)">
          <IconOpen /> <span className="tb-label">Ouvrir</span>
        </button>
        <button type="button" className="tb-btn" aria-label="Enregistrer" onClick={() => void saveProject()} title="Télécharger la scène en .squa (⌘/Ctrl S)">
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
            aria-label={label}
            onClick={() => setTransformMode(m)}
            title={`${label} (${key})`}
          >
            <Icon /> <span className="tb-label">{label}</span>
          </button>
        ))}
      </div>

      <SnapControls />

      <div className="toolbar-group">
        <button type="button" className={`tb-btn ${validatorOpen ? 'is-active' : ''}`} aria-pressed={validatorOpen} aria-label="Valider" onClick={() => setValidatorOpen(!validatorOpen)} title="Valider la scène (sol, collisions, assets, hiérarchie)">
          <IconShield /> <span className="tb-label">Valider</span>
        </button>
        <button type="button" className="tb-btn" aria-label="Commandes" onClick={() => openDialog('commands')} title="Exécuter des commandes structurées (JSON)">
          <IconCode /> <span className="tb-label">Commandes</span>
        </button>
        <button type="button" className="tb-btn" aria-label="Vue par défaut" onClick={resetView} title="Revenir à la vue par défaut (H)">
          <IconHome /> <span className="tb-label">Vue par défaut</span>
        </button>
      </div>
    </header>
  );
}

const GRID_STEPS: SnapSettings['translate'][] = [0.1, 0.5, 1];
const ANGLE_STEPS: SnapSettings['rotate'][] = [5, 15, 45, 90];

/** Aimantation : grille / angles (activable) et pose automatique sur les surfaces. */
function SnapControls() {
  const snap = useEditor((s) => s.snap);
  const [open, setOpen] = useState(false);
  const active = snap.enabled || snap.surface;
  return (
    <div className="toolbar-group snap-group">
      <button
        type="button"
        className={`tb-btn ${snap.enabled ? 'is-active' : ''}`}
        aria-pressed={snap.enabled}
        aria-label="Grille"
        onClick={() => setSnap({ enabled: !snap.enabled })}
        title={`Aimantation à la grille (${String(snap.translate).replace('.', ',')} m) et aux angles (${snap.rotate}°)`}
      >
        <IconMagnet /> <span className="tb-label">Grille</span>
      </button>
      <button type="button" className={`tb-btn caret ${active ? '' : 'dim'}`} aria-expanded={open} aria-label="Réglages d'aimantation" onClick={() => setOpen((v) => !v)}>
        ▾
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Réglages d'aimantation" onMouseLeave={() => setOpen(false)}>
          <label className="checkbox">
            <input type="checkbox" checked={snap.enabled} onChange={(e) => setSnap({ enabled: e.target.checked })} /> Grille et angles
          </label>
          <div className="popover-row">
            <span>Pas</span>
            {GRID_STEPS.map((v) => (
              <button key={v} type="button" className={`chip ${snap.translate === v ? 'is-active' : ''}`} aria-pressed={snap.translate === v} onClick={() => setSnap({ translate: v, enabled: true })}>
                {String(v).replace('.', ',')} m
              </button>
            ))}
          </div>
          <div className="popover-row">
            <span>Angle</span>
            {ANGLE_STEPS.map((v) => (
              <button key={v} type="button" className={`chip ${snap.rotate === v ? 'is-active' : ''}`} aria-pressed={snap.rotate === v} onClick={() => setSnap({ rotate: v, enabled: true })}>
                {v}°
              </button>
            ))}
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={snap.surface} onChange={(e) => setSnap({ surface: e.target.checked })} /> Poser sur les surfaces (sol, table…) et contre les murs
          </label>
        </div>
      )}
    </div>
  );
}
