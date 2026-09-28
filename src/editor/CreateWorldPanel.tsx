/**
 * Panneau « Créer un monde » : l'action principale de SQUA.
 *
 * - Créer : description libre → IA → ScenePlan → validation → World Composer → objets éditables.
 * - Modifier : consigne locale → IA → commandes structurées → un seul undo.
 * - Plan JSON : composer un ScenePlan écrit à la main (aucune IA, présenté comme tel).
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { askConfirm } from './ConfirmDialog.tsx';
import { IconCode, IconShield } from './icons.tsx';
import { selectIsDirty, setValidatorOpen, useEditor } from '../store/editorStore.ts';
import { applyInstruction, cancelGeneration, composeManualPlan, generateWorld, refreshAIStatus, useGeneration } from '../world/generation.ts';

// Ouvert au démarrage sur ordinateur si la scène est vide (le monde est l'action principale), sinon replié.
// Sur téléphone (consultation), il ne masque pas la vue au démarrage.
const wide = typeof matchMedia === 'undefined' || matchMedia('(min-width: 821px)').matches;
export const useWorldPanel = create<{ open: boolean }>()(() => ({ open: wide && Object.keys(useEditor.getState().doc.objects).length === 0 }));
export const toggleWorldPanel = (open?: boolean) => useWorldPanel.setState((s) => ({ open: open ?? !s.open }));

const EXAMPLES = [
  'Petit cybercafé populaire à Lagos en 2002, 8 postes informatiques, ordinateurs CRT, comptoir près de l’entrée, murs usés et petite salle rectangulaire.',
  'Petit appartement moderne avec salon, canapé, table basse, télévision, plante et grande fenêtre.',
  'Petite rue résidentielle avec route, deux trottoirs, quatre bâtiments, quelques arbres, lampadaires et deux voitures.',
];

const PLAN_EXAMPLE = `{
  "version": 1,
  "title": "Bureau d'accueil",
  "sceneType": "interior",
  "zones": [{ "id": "hall", "kind": "room", "width": 6, "depth": 5, "height": 2.8,
    "openings": [{ "kind": "door", "wall": "south", "position": 0 }, { "kind": "window", "wall": "north" }] }],
  "objects": [
    { "id": "counter", "type": "counter", "zone": "hall",
      "relationships": [{ "type": "AGAINST", "target": "hall.wall-north" }],
      "with": [{ "type": "monitor", "relation": "ON", "place": "back" }, { "type": "chair", "relation": "NEXT_TO", "side": "back" }] },
    { "id": "sofa", "type": "small-sofa", "zone": "hall", "relationships": [{ "type": "AGAINST", "target": "hall.wall-west" }] },
    { "id": "plant", "type": "plant", "zone": "hall", "layout": { "kind": "corner", "corner": "south-east" } }
  ]
}`;

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  return <>{Math.max(0, Math.round((now - since) / 1000))} s</>;
}

const PHASE_LABEL = { calling: 'Le modèle rédige le ScenePlan…', validating: 'Validation du plan…', composing: 'Composition du monde…' } as const;

async function startGeneration(text: string): Promise<void> {
  if (!(await confirmReplace())) return;
  await generateWorld(text);
  // Le monde devient l'événement principal : le panneau se replie (le rapport reste consultable).
  if (useGeneration.getState().phase === 'done') toggleWorldPanel(false);
}

async function confirmReplace(): Promise<boolean> {
  const s = useEditor.getState();
  if (!Object.keys(s.doc.objects).length || !selectIsDirty(s)) return true;
  return askConfirm('Créer un nouveau monde remplace la scène actuelle, qui contient des modifications non enregistrées. Continuer ?', 'Créer le monde');
}

function Report() {
  const g = useGeneration();
  const [showPlan, setShowPlan] = useState(false);
  if (!g.report || g.phase !== 'done') return null;
  const r = g.report;
  const warnings = g.planIssues.filter((i) => i.level === 'warning');
  return (
    <div className="world-report" role="status">
      <p className="world-report-title">
        <strong>{r.title}</strong>
        <span className={`status-pill status-${r.status.toLowerCase()}`}>{r.status === 'OK' ? 'Monde valide' : r.status === 'WARNING' ? 'Avertissements' : 'Erreurs'}</span>
      </p>
      <p className="hint">
        {g.source === 'ai' ? `Plan rédigé par ${g.model ?? 'le modèle'}` : 'Plan écrit à la main (aucune IA)'} · {r.zones} zone{r.zones > 1 ? 's' : ''} · {r.objects} objets éditables · {r.commands.length} commandes
        {g.durationMs !== null ? ` · ${(g.durationMs / 1000).toFixed(1)} s` : ''}
      </p>
      {r.adjustments.length + warnings.length > 0 && (
        <details open>
          <summary>Adaptations du plan ({r.adjustments.length + warnings.length})</summary>
          <ul>
            {warnings.map((w, i) => (
              <li key={`w${i}`}>{w.message}</li>
            ))}
            {r.adjustments.map((a, i) => (
              <li key={`a${i}`}>{a}</li>
            ))}
          </ul>
        </details>
      )}
      {r.corrections.length > 0 && (
        <details>
          <summary>Corrections automatiques ({r.corrections.length})</summary>
          <ul>
            {r.corrections.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </details>
      )}
      {r.remaining.length > 0 && (
        <details open>
          <summary>Problèmes restants ({r.remaining.length})</summary>
          <ul>
            {r.remaining.map((c, i) => (
              <li key={i}>{c.message}</li>
            ))}
          </ul>
          <button type="button" className="link-btn" onClick={() => setValidatorOpen(true)}>
            <IconShield /> Ouvrir le validateur
          </button>
        </details>
      )}
      <button type="button" className="link-btn" onClick={() => setShowPlan((v) => !v)} aria-expanded={showPlan}>
        {showPlan ? 'Masquer le ScenePlan' : 'Voir le ScenePlan (JSON)'}
      </button>
      {showPlan && <pre className="plan-json">{JSON.stringify(g.plan, null, 2)}</pre>}
    </div>
  );
}

function CreateTab() {
  const g = useGeneration();
  const [text, setText] = useState(g.prompt || '');
  const busy = g.phase === 'calling' || g.phase === 'validating' || g.phase === 'composing';
  const ready = !!g.ai?.configured;
  return (
    <>
      <label className="world-label" htmlFor="world-prompt">
        Décrivez le lieu
      </label>
      <textarea
        id="world-prompt"
        className="world-prompt"
        rows={5}
        value={text}
        maxLength={4000}
        placeholder="Ex. : petite boulangerie de quartier à Dakar, comptoir vitré, étagères de pain, deux tables près de la fenêtre…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ready && !busy) void startGeneration(text);
        }}
        disabled={busy}
      />
      <div className="example-row">
        {EXAMPLES.map((ex, i) => (
          <button key={i} type="button" className="chip" disabled={busy} onClick={() => setText(ex)} title={ex}>
            {['Cybercafé Lagos 2002', 'Appartement moderne', 'Rue résidentielle'][i]}
          </button>
        ))}
      </div>
      {g.ai && !ready && <p className="hint hint-error">{g.ai.message}</p>}
      <div className="button-row">
        {busy ? (
          <>
            <span className="world-progress" role="status">
              <span className="spinner" aria-hidden="true" /> {PHASE_LABEL[g.phase as keyof typeof PHASE_LABEL]} {g.startedAt && <Elapsed since={g.startedAt} />}
            </span>
            {g.phase === 'calling' && (
              <button type="button" className="btn" onClick={cancelGeneration}>
                Annuler
              </button>
            )}
          </>
        ) : (
          <button type="button" className="btn btn-primary btn-generate" disabled={!ready || text.trim().length < 3} onClick={() => void startGeneration(text)} title={ready ? '⌘/Ctrl + Entrée' : g.ai?.message}>
            Générer le monde
          </button>
        )}
      </div>
      {g.phase === 'error' && g.error && <p className="hint hint-error">{g.error}</p>}
      <Report />
    </>
  );
}

function EditTab() {
  const edit = useGeneration((s) => s.edit);
  const ready = useGeneration((s) => !!s.ai?.configured);
  const hasObjects = useEditor((s) => Object.keys(s.doc.objects).length > 0);
  const selection = useEditor((s) => s.selectedIds.length);
  const [text, setText] = useState('');
  const busy = edit.phase === 'calling';
  return (
    <>
      <label className="world-label" htmlFor="world-edit">
        Modification locale
      </label>
      <textarea
        id="world-edit"
        className="world-prompt"
        rows={3}
        value={text}
        maxLength={2000}
        placeholder="Ex. : ajoute une fenêtre sur le mur ouest · remplace les chaises par des fauteuils · rends la pièce plus étroite · supprime la voiture de gauche"
        onChange={(e) => setText(e.target.value)}
        disabled={busy || !hasObjects}
      />
      <p className="hint">
        Seuls les objets concernés sont modifiés (un seul « Annuler »). {selection ? `${selection} objet(s) sélectionné(s) transmis comme contexte.` : ''}
      </p>
      {!ready && <p className="hint hint-error">Modification par IA indisponible : aucun modèle connecté.</p>}
      <div className="button-row">
        <button type="button" className="btn btn-primary" disabled={!ready || busy || !hasObjects || text.trim().length < 2} onClick={() => void applyInstruction(text)}>
          {busy ? 'Le modèle prépare les commandes…' : 'Appliquer'}
        </button>
        {busy && (
          <button type="button" className="btn" onClick={cancelGeneration}>
            Annuler
          </button>
        )}
      </div>
      {edit.phase === 'error' && <p className="hint hint-error">{edit.error}</p>}
      {edit.phase === 'done' && (
        <div className="world-report">
          <p className="hint hint-ok">{edit.explanation || 'Modification appliquée.'}</p>
          {!!edit.remaining?.length && (
            <ul>
              {edit.remaining.map((i, k) => (
                <li key={k}>{i.message}</li>
              ))}
            </ul>
          )}
          {!!edit.commands?.length && (
            <details>
              <summary>Commandes exécutées ({edit.commands.length})</summary>
              <pre className="plan-json">{JSON.stringify(edit.commands, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </>
  );
}

function PlanTab() {
  const g = useGeneration();
  const [text, setText] = useState(PLAN_EXAMPLE);
  return (
    <>
      <p className="hint">
        Pour tester le World Composer sans IA : collez un ScenePlan (format dans docs/SCENE_PLAN.md). Le résultat est marqué « plan écrit à la main ».
      </p>
      <textarea className="code-area" rows={12} value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} aria-label="ScenePlan JSON" />
      <div className="button-row">
        <button type="button" className="btn" onClick={() => void confirmReplace().then((ok) => { if (ok) composeManualPlan(text); })}>
          <IconCode /> Composer ce plan
        </button>
      </div>
      {g.phase === 'error' && g.source === 'manual' && <p className="hint hint-error">{g.error}</p>}
      {g.source === 'manual' && <Report />}
    </>
  );
}

export function CreateWorldPanel() {
  const open = useWorldPanel((s) => s.open);
  const [tab, setTab] = useState<'create' | 'edit' | 'plan'>('create');
  const ai = useGeneration((s) => s.ai);
  useEffect(() => {
    void refreshAIStatus();
  }, []);
  if (!open) return null;
  return (
    <section className="world-panel" aria-label="Créer un monde">
      <header className="world-panel-head">
        <h2>Créer un monde</h2>
        <span className={`ai-badge ${ai?.configured ? 'is-on' : 'is-off'}`} title={ai?.message ?? (ai?.configured ? `Modèle : ${ai.model}` : '')}>
          {ai === null ? 'IA : vérification…' : ai.configured ? `IA : ${ai.model}` : 'IA non connectée'}
        </span>
        <button type="button" className="icon-btn" aria-label="Fermer le panneau" onClick={() => toggleWorldPanel(false)}>
          ✕
        </button>
      </header>
      <div className="world-tabs" role="tablist">
        {(
          [
            ['create', 'Créer'],
            ['edit', 'Modifier'],
            ['plan', 'Plan JSON'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`world-tab ${tab === k ? 'is-active' : ''}`} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="world-panel-body">{tab === 'create' ? <CreateTab /> : tab === 'edit' ? <EditTab /> : <PlanTab />}</div>
    </section>
  );
}
