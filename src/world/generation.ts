/**
 * Pipeline « Créer un monde » côté application :
 *
 *   description → fournisseur d'IA → ScenePlan brut → validateScenePlan → composeWorld → transaction
 *
 * et « Modifier » : consigne → fournisseur d'IA → commandes → runWorldCommands (local, un undo).
 * Chaque étape est réelle et observable ; aucune étape n'est simulée. Un plan écrit à la main peut
 * aussi être composé (mode « Plan JSON »), explicitement présenté comme tel.
 */
import { create } from 'zustand';
import {
  autoCorrect,
  composeWorld,
  objectSpatial,
  runWorldCommands,
  type Rect,
  type SceneDocument,
  createEmptyDocument,
  validateScene,
  validateScenePlan,
  type ComposeReport,
  type PlanIssue,
  type SceneIssue,
  type ScenePlan,
  type WorldCommand,
} from '../core/index.ts';
import { AIError, aiProvider, type AIStatus } from '../ai/aiProvider.ts';
import { buildSceneContext } from '../ai/sceneContext.ts';
import { execute, notify, replaceDocument, useEditor } from '../store/editorStore.ts';
import { frameObjects, resetView, viewThroughCamera } from '../viewport/cameraController.ts';
import { worldContext } from './worldContext.ts';

export type GenerationPhase = 'idle' | 'calling' | 'validating' | 'composing' | 'done' | 'error';

export interface GenerationState {
  phase: GenerationPhase;
  /** Origine du dernier plan : IA (modèle) ou plan écrit à la main. */
  source: 'ai' | 'manual' | null;
  startedAt: number | null;
  durationMs: number | null;
  error: string | null;
  prompt: string;
  plan: ScenePlan | null;
  planIssues: PlanIssue[];
  report: ComposeReport | null;
  ai: AIStatus | null;
  model: string | null;
  /** Dernière modification locale. */
  edit: { phase: 'idle' | 'calling' | 'done' | 'error'; instruction: string; explanation?: string; commands?: unknown[]; error?: string; remaining?: SceneIssue[] } ;
}

export const useGeneration = create<GenerationState>()(() => ({
  phase: 'idle',
  source: null,
  startedAt: null,
  durationMs: null,
  error: null,
  prompt: '',
  plan: null,
  planIssues: [],
  report: null,
  ai: null,
  model: null,
  edit: { phase: 'idle', instruction: '' },
}));

const set = useGeneration.setState;
let controller: AbortController | null = null;

export async function refreshAIStatus(): Promise<AIStatus> {
  const ai = await aiProvider.status();
  set({ ai, model: ai.model ?? null });
  return ai;
}

export function cancelGeneration(): void {
  controller?.abort();
}

/** Valide + compose un plan brut et remplace la scène par le monde obtenu (un seul undo le retire). */
function composeAndCommit(raw: unknown, source: 'ai' | 'manual', started: number): boolean {
  set({ phase: 'validating' });
  const v = validateScenePlan(raw);
  set({ planIssues: v.issues });
  if (!v.ok || !v.plan) {
    set({ phase: 'error', error: `Plan refusé : ${v.issues.filter((i) => i.level === 'error').map((i) => `${i.path ? `${i.path} : ` : ''}${i.message}`).join(' ; ')}`, durationMs: Date.now() - started });
    return false;
  }
  set({ phase: 'composing', plan: v.plan });
  const base = createEmptyDocument(v.plan.title);
  const r = composeWorld(base, v.plan, worldContext(base), { kind: source === 'ai' ? 'ai' : 'composer' });
  if (!r.ok) {
    set({ phase: 'error', error: r.error, durationMs: Date.now() - started });
    return false;
  }
  replaceDocument({ ...base, metadata: { ...base.metadata, scenePlan: v.plan, generatedBy: source, ...(source === 'ai' ? { prompt: useGeneration.getState().prompt } : {}) } });
  // La génération est la première action de l'historique : « Annuler » revient à la scène vide.
  execute(r.tx, { select: null });
  set({ phase: 'done', report: r.report, durationMs: Date.now() - started });
  resetView();
  // Première vue : la première caméra du plan (depuis l'entrée, au niveau de la rue…), sinon vue d'ensemble.
  setTimeout(() => {
    const doc = useEditor.getState().doc;
    const cam = Object.values(doc.objects).find((o) => o.type === 'camera');
    if (cam && cam.type === 'camera') viewThroughCamera(cam.id, cam.camera.fov);
    else frameObjects(doc.rootIds);
  }, 150);
  notify('info', `« ${r.report.title} » : ${r.report.objects} objets éditables${r.report.status === 'OK' ? ', monde valide.' : ` — ${r.report.remaining.length} problème(s) signalé(s).`}`);
  return true;
}

export async function generateWorld(prompt: string): Promise<void> {
  const text = prompt.trim();
  if (text.length < 3) return;
  controller?.abort();
  controller = new AbortController();
  const started = Date.now();
  set({ phase: 'calling', source: 'ai', startedAt: started, error: null, prompt: text, report: null, plan: null, planIssues: [], durationMs: null });
  let raw: unknown;
  try {
    raw = await aiProvider.generateScenePlan(text, controller.signal);
  } catch (e) {
    const err = e as AIError;
    set({ phase: err.code === 'ABORTED' ? 'idle' : 'error', error: err.code === 'ABORTED' ? null : err.message, durationMs: Date.now() - started });
    if (err.code === 'AI_NOT_CONFIGURED') void refreshAIStatus();
    return;
  }
  composeAndCommit(raw, 'ai', started);
}

/** Compose un ScenePlan fourni directement (JSON écrit à la main) — aucune IA. */
export function composeManualPlan(json: string): void {
  const started = Date.now();
  set({ phase: 'validating', source: 'manual', startedAt: started, error: null, prompt: '', report: null, plan: null, planIssues: [] });
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    set({ phase: 'error', error: `JSON invalide : ${(e as Error).message}` });
    return;
  }
  composeAndCommit(raw, 'manual', started);
}

/** Modification locale : l'IA propose des commandes, exécutées comme UNE action annulable. */
export async function applyInstruction(instruction: string): Promise<void> {
  const text = instruction.trim();
  if (text.length < 2) return;
  controller?.abort();
  controller = new AbortController();
  const s = useEditor.getState();
  set({ edit: { phase: 'calling', instruction: text } });
  let result;
  try {
    result = await aiProvider.modifyScene(buildSceneContext(s.doc, s.selectedIds), text, controller.signal);
  } catch (e) {
    const err = e as AIError;
    set({ edit: { phase: err.code === 'ABORTED' ? 'idle' : 'error', instruction: text, error: err.message } });
    return;
  }
  if (!result.commands.length) {
    set({ edit: { phase: 'done', instruction: text, explanation: result.explanation || 'Aucune modification proposée.', commands: [] } });
    return;
  }
  const before = useEditor.getState().doc;
  const ctx = worldContext(before);
  const r = runWorldCommands(before, result.commands as WorldCommand[], ctx, { source: { kind: 'ai' } });
  if (!r.ok) {
    set({ edit: { phase: 'error', instruction: text, commands: result.commands, error: `Commande ${r.index + 1} refusée : ${r.error} Rien n'a été modifié.` } });
    return;
  }
  // Seuls les objets touchés par la modification sont vérifiés et, si besoin, corrigés.
  const scope = new Set(Object.keys(r.doc.objects).filter((id) => r.doc.objects[id] !== before.objects[id]));
  const fix = autoCorrect(r.doc, scope, worldContext(r.doc), (unit) => roomRectOf(r.doc, unit));
  execute({ label: text.length > 40 ? `IA : ${text.slice(0, 40)}…` : `IA : ${text}`, ops: [...r.tx.ops, ...fix.ops] }, { select: r.created.length ? r.created : undefined });
  const doc = useEditor.getState().doc;
  const remaining = validateScene(doc, worldContext(doc)).issues.filter((i) => i.objectId && scope.has(i.objectId));
  set({ edit: { phase: 'done', instruction: text, explanation: [result.explanation, ...fix.corrections].filter(Boolean).join(' '), commands: result.commands, remaining } });
  if (!remaining.length) notify('info', result.explanation || 'Modification appliquée.');
}

/** Intérieur de la pièce qui contient un objet (pour garder les corrections dans la pièce). */
function roomRectOf(doc: SceneDocument, id: string): Rect | null {
  let p = doc.objects[id]?.parentId ?? null;
  while (p && doc.objects[p] && doc.objects[p].semanticRole !== 'room') p = doc.objects[p].parentId;
  if (!p || !doc.objects[p]) return null;
  const floor = doc.objects[p].children.map((c) => doc.objects[c]).find((o) => o?.semanticRole === 'floor');
  const s = floor && objectSpatial(doc, floor.id, worldContext(doc));
  if (!s || floor.type !== 'element') return null;
  const t = 0.2;
  return { minX: s.aabb.min[0] + t, maxX: s.aabb.max[0] - t, minZ: s.aabb.min[2] + t, maxZ: s.aabb.max[2] - t };
}
