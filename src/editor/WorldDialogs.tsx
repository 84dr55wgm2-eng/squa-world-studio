/**
 * Fenêtres de composition du monde :
 * - choix d'un modèle de scène (Nouveau) ;
 * - console de commandes structurées (JSON) — l'interface que produira l'IA ;
 * - validateur de scène.
 */
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { validateScene, type SceneTemplate } from '../core/index.ts';
import { parseWorldCommands } from '../core/index.ts';
import { useAssetStatus } from '../assets/assetStatus.ts';
import { useLibrary } from '../assets/library.ts';
import { confirmDiscardChanges } from '../io/projectActions.ts';
import { select, setValidatorOpen, useEditor } from '../store/editorStore.ts';
import { frameObject, frameObjects, resetView } from '../viewport/cameraController.ts';
import { TEMPLATES, createFromTemplate, runCommands } from '../world/worldActions.ts';
import { worldContext } from '../world/worldContext.ts';

type DialogKind = 'templates' | 'commands' | null;
export const useDialogs = create<{ open: DialogKind }>()(() => ({ open: null }));
export const openDialog = (open: DialogKind) => useDialogs.setState({ open });

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

/* ------------------------------------------------------------------ Modèles de scène */

function TemplateDialog() {
  const libraryReady = useLibrary((s) => s.status === 'ready');
  const close = () => openDialog(null);
  useEscape(close);
  const pick = async (t: SceneTemplate) => {
    if (!(await confirmDiscardChanges())) return;
    if (createFromTemplate(t)) {
      close();
      resetView();
      // Cadre l'ensemble de la scène créée (une rue de 60 m ne tient pas dans la vue par défaut).
      if (t.commands.length) setTimeout(() => frameObjects(useEditor.getState().doc.rootIds), 150);
    }
  };
  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="tpl-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="tpl-title" className="dialog-title">
          Nouvelle scène
        </h2>
        <div className="template-grid">
          {TEMPLATES.map((t) => {
            const needsLibrary = t.commands.some((c) => 'assetId' in c || c.action === 'INSTANTIATE_PREFAB');
            return (
              <button key={t.id} type="button" className="template-card" disabled={needsLibrary && !libraryReady} onClick={() => void pick(t)}>
                <strong>{t.name}</strong>
                <span>{t.description}</span>
                {t.commands.length > 0 && <span className="muted">{t.commands.length} commandes structurées · objets ordinaires, entièrement modifiables</span>}
                {needsLibrary && !libraryReady && <span className="muted">Chargement de la bibliothèque…</span>}
              </button>
            );
          })}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={close}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Console de commandes */

const EXAMPLE = `[
  { "action": "CREATE_ROOM", "as": "room", "width": 5, "depth": 4, "height": 2.8,
    "doors": [{ "wall": "south" }], "windows": [{ "wall": "north" }] },
  { "action": "ADD_OBJECT", "element": "desk", "as": "desk",
    "relation": { "type": "AGAINST", "target": "room.wall_north" } },
  { "action": "ADD_OBJECT", "element": "monitor", "relation": { "type": "ON", "target": "desk" } },
  { "action": "ADD_OBJECT", "assetId": "sheen-chair",
    "relation": { "type": "NEXT_TO", "target": "desk", "side": "front" } }
]`;

function CommandConsole() {
  const [text, setText] = useState(EXAMPLE);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const close = () => openDialog(null);
  useEscape(close);
  const run = () => {
    try {
      const cmds = parseWorldCommands(text);
      const r = runCommands(cmds, `Commandes (${cmds.length})`);
      setResult(
        r.ok
          ? { ok: true, text: `${cmds.length} commande(s) exécutée(s) en une seule action annulable · ${r.created.length} objet(s) créé(s).${r.notes.length ? ` ${r.notes.join(' ')}` : ''}` }
          : { ok: false, text: `Commande ${r.index + 1} : ${r.error} Rien n'a été modifié.` },
      );
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    }
  };
  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="cmd-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="cmd-title" className="dialog-title">
          Commandes structurées
        </h2>
        <p className="hint">
          Le format que produira l'IA : une liste JSON d'actions (ADD_OBJECT, PLACE, GROUP_OBJECTS, CREATE_ROOM, CREATE_STREET, INSTANTIATE_PREFAB…) avec relations spatiales (ON, NEXT_TO, AGAINST, INSIDE,
          CENTERED_IN, FACING, ATTACHED_TO, ALONG). Tout ou rien : une commande invalide annule le script. Voir docs/WORLD_COMMANDS.md.
        </p>
        <textarea className="code-area" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Script de commandes JSON" rows={14} />
        {result && <p className={`hint ${result.ok ? 'hint-ok' : 'hint-error'}`}>{result.text}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={close}>
            Fermer
          </button>
          <button type="button" className="btn btn-primary" onClick={run}>
            Exécuter
          </button>
        </div>
      </div>
    </div>
  );
}

export function WorldDialogs() {
  const open = useDialogs((s) => s.open);
  if (open === 'templates') return <TemplateDialog />;
  if (open === 'commands') return <CommandConsole />;
  return null;
}

/* ------------------------------------------------------------------ Validateur de scène */

const SEVERITY_LABEL = { ERROR: 'Erreur', WARNING: 'Attention' } as const;

export function ValidatorPanel() {
  const open = useEditor((s) => s.validatorOpen);
  const revision = useEditor((s) => s.revision);
  const assets = useAssetStatus((s) => (open ? s.byId : null));
  const report = useMemo(() => {
    if (!open) return null;
    void revision;
    void assets;
    const doc = useEditor.getState().doc;
    const t0 = performance.now();
    const r = validateScene(doc, worldContext(doc));
    return { ...r, ms: performance.now() - t0 };
  }, [open, revision, assets]);
  if (!open || !report) return null;
  return (
    <section className="validator-panel" aria-label="Validation de la scène">
      <header>
        <strong className={`status-${report.status.toLowerCase()}`}>{report.status === 'OK' ? 'Scène valide' : report.status === 'ERROR' ? 'Erreurs dans la scène' : 'Avertissements'}</strong>
        <span className="muted">
          {report.checked} objets · {report.issues.length} problème(s) · {report.ms.toFixed(0)} ms
        </span>
        <button type="button" className="icon-btn" aria-label="Fermer la validation" onClick={() => setValidatorOpen(false)}>
          ✕
        </button>
      </header>
      {report.issues.length === 0 ? (
        <p className="hint">Aucun problème : objets au-dessus du sol, transformations valides, assets présents et chargés, hiérarchie cohérente, pas de collision anormale.</p>
      ) : (
        <ul>
          {report.issues.map((i, k) => (
            <li key={k} className={`issue severity-${i.severity.toLowerCase()}`}>
              <span className="issue-badge">{SEVERITY_LABEL[i.severity]}</span>
              {i.objectId && useEditor.getState().doc.objects[i.objectId] ? (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    select(i.objectId);
                    frameObject(i.objectId!);
                  }}
                >
                  {i.message}
                </button>
              ) : (
                <span>{i.message}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
