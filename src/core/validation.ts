/**
 * Validation de placement et de scène (pure).
 *
 * validatePlacement(obj) → OK / WARNING / INVALID avec des raisons lisibles
 *   ex. « Chaise » chevauche « Bureau » à 42 %.
 * validateScene(doc) → liste de problèmes (sous le sol, transform invalide, échelle nulle,
 *   asset manquant, modèle non chargé, parent cassé, collisions…).
 */
import { effectiveRules, overlapAllowed, ROLES } from './semantics.ts';
import { ancestorsOf, isSolid, objectSpatial, overlapOf, footprintsOverlap, type BoundsContext, type Spatial } from './spatial.ts';
import type { ObjectId, SceneDocument, SceneObject } from './types.ts';

export type Severity = 'OK' | 'WARNING' | 'INVALID';
export type SceneSeverity = 'OK' | 'WARNING' | 'ERROR';

export interface ValidationContext extends BoundsContext {
  /** État de chargement d'un asset ('ready' | 'loading' | 'error' | undefined si inconnu). */
  assetLoadState?(assetId: string): 'ready' | 'loading' | 'error' | undefined;
}

export interface Issue {
  objectId: ObjectId | null;
  severity: Exclude<Severity, 'OK'>;
  code: string;
  message: string;
  otherId?: ObjectId;
}

export interface PlacementReport {
  status: Severity;
  issues: Issue[];
}

/** Tolérance (m) pour « posé sur » / « sous le sol ». */
export const CONTACT_EPS = 0.02;
/** Chevauchement en dessous duquel on ignore (contact de surface), au-dessus duquel c'est INVALID. */
export const OVERLAP_WARN = 0.05;
export const OVERLAP_INVALID = 0.5;

const pct = (r: number) => `${Math.round(r * 100)} %`;
const worst = (issues: Issue[]): Severity => (issues.some((i) => i.severity === 'INVALID') ? 'INVALID' : issues.length ? 'WARNING' : 'OK');

function effectiveVisible(doc: SceneDocument, id: ObjectId): boolean {
  if (!doc.objects[id]?.visible) return false;
  return ancestorsOf(doc, id).every((a) => doc.objects[a].visible);
}

/** Les deux objets appartiennent-ils à la même lignée (parent/enfant) ? Alors leur recouvrement est voulu. */
const related = (doc: SceneDocument, a: ObjectId, b: ObjectId) => ancestorsOf(doc, a).includes(b) || ancestorsOf(doc, b).includes(a);

interface Solid {
  obj: SceneObject;
  s: Spatial;
}

function solids(doc: SceneDocument, ctx: BoundsContext): Solid[] {
  const out: Solid[] = [];
  for (const obj of Object.values(doc.objects)) {
    if (!isSolid(obj) || !effectiveVisible(doc, obj.id)) continue;
    const s = objectSpatial(doc, obj.id, ctx);
    if (s) out.push({ obj, s });
  }
  return out;
}

function placementIssues(doc: SceneDocument, subject: Solid, all: Solid[]): Issue[] {
  const issues: Issue[] = [];
  const { obj, s } = subject;
  const rules = effectiveRules(obj);
  const label = ROLES[obj.semanticRole]?.label ?? obj.semanticRole;

  if (s.base < -CONTACT_EPS && rules.support !== 'none' && obj.semanticRole !== 'floor' && obj.semanticRole !== 'road' && obj.semanticRole !== 'sidewalk') {
    issues.push({ objectId: obj.id, severity: 'INVALID', code: 'under-ground', message: `« ${obj.name} » passe sous le sol (${s.base.toFixed(2)} m).` });
  }

  // Appui : un objet qui doit reposer sur quelque chose ne doit pas flotter.
  if (!rules.allowFloating && s.base > CONTACT_EPS) {
    const supported = all.some(
      (o) => o.obj.id !== obj.id && Math.abs(o.s.top - s.base) <= CONTACT_EPS && footprintsOverlap(s, o.s),
    );
    const attached = rules.support === 'wall' && obj.parentId && ['wall', 'building'].includes(doc.objects[obj.parentId]?.semanticRole);
    if (!supported && !attached) {
      issues.push({ objectId: obj.id, severity: 'WARNING', code: 'floating', message: `« ${obj.name} » (${label}) flotte à ${s.base.toFixed(2)} m sans appui.` });
    }
  }
  if (rules.support === 'wall') {
    const parent = obj.parentId ? doc.objects[obj.parentId] : null;
    if (!parent || !['wall', 'building'].includes(parent.semanticRole)) {
      issues.push({ objectId: obj.id, severity: 'WARNING', code: 'not-attached', message: `« ${obj.name} » (${label}) n'est fixé à aucun mur.` });
    }
  }

  for (const o of all) {
    if (o.obj.id === obj.id || related(doc, obj.id, o.obj.id) || overlapAllowed(obj, o.obj)) continue;
    const ov = overlapOf(s, o.s);
    if (ov.ratio < OVERLAP_WARN) continue;
    const contained = ov.aInsideB || ov.bInsideA;
    const severity = ov.ratio >= OVERLAP_INVALID || contained ? 'INVALID' : 'WARNING';
    issues.push({
      objectId: obj.id,
      otherId: o.obj.id,
      severity,
      code: 'overlap',
      message: contained
        ? `« ${obj.name} » et « ${o.obj.name} » sont imbriqués.`
        : `« ${obj.name} » chevauche « ${o.obj.name} » à ${pct(ov.ratio)}.`,
    });
  }
  return issues;
}

/** Valide le placement d'un objet dans son contexte. */
export function validatePlacement(doc: SceneDocument, id: ObjectId, ctx: BoundsContext): PlacementReport {
  const obj = doc.objects[id];
  if (!obj) return { status: 'INVALID', issues: [{ objectId: id, severity: 'INVALID', code: 'missing', message: `Objet introuvable : ${id}` }] };
  const all = solids(doc, ctx);
  const subjects: Solid[] = [];
  if (isSolid(obj)) {
    const me = all.find((x) => x.obj.id === id);
    if (me) subjects.push(me);
  } else {
    // Groupe : valide chacun de ses descendants solides contre le reste de la scène.
    const desc = new Set(Object.keys(doc.objects).filter((k) => ancestorsOf(doc, k).includes(id)));
    subjects.push(...all.filter((x) => desc.has(x.obj.id)));
  }
  const issues = subjects.flatMap((sub) => placementIssues(doc, sub, all));
  return { status: worst(issues), issues };
}

export interface SceneIssue {
  objectId: ObjectId | null;
  severity: Exclude<SceneSeverity, 'OK'>;
  code: string;
  message: string;
}

export interface SceneReport {
  status: SceneSeverity;
  issues: SceneIssue[];
  checked: number;
}

const finite = (v: readonly number[]) => v.every(Number.isFinite);

/** Valide la scène entière. Les collisions ne sont signalées qu'une fois par paire. */
export function validateScene(doc: SceneDocument, ctx: ValidationContext): SceneReport {
  const issues: SceneIssue[] = [];
  const push = (objectId: ObjectId | null, severity: 'ERROR' | 'WARNING', code: string, message: string) =>
    issues.push({ objectId, severity, code, message });

  for (const id of doc.rootIds) if (!doc.objects[id]) push(null, 'ERROR', 'broken-root', `La racine référence un objet absent : ${id}`);
  for (const obj of Object.values(doc.objects)) {
    const t = obj.transform;
    if (!finite(t.position) || !finite(t.rotation) || !finite(t.scale)) push(obj.id, 'ERROR', 'invalid-transform', `« ${obj.name} » a une transformation invalide (NaN / infini).`);
    else if (t.scale.some((v) => Math.abs(v) < 1e-6)) push(obj.id, 'ERROR', 'zero-scale', `« ${obj.name} » a une échelle nulle.`);
    if (obj.parentId !== null) {
      const p = doc.objects[obj.parentId];
      if (!p) push(obj.id, 'ERROR', 'broken-parent', `« ${obj.name} » référence un parent absent (${obj.parentId}).`);
      else if (!p.children.includes(obj.id)) push(obj.id, 'ERROR', 'broken-parent', `« ${obj.name} » n'apparaît pas dans les enfants de « ${p.name} ».`);
    } else if (!doc.rootIds.includes(obj.id)) push(obj.id, 'ERROR', 'orphan', `« ${obj.name} » n'est rattaché à rien.`);
    for (const c of obj.children) if (!doc.objects[c]) push(obj.id, 'ERROR', 'broken-child', `« ${obj.name} » référence un enfant absent (${c}).`);
    if (obj.type === 'model') {
      const asset = doc.assets[obj.model.assetId];
      if (!asset) push(obj.id, 'ERROR', 'missing-asset', `« ${obj.name} » : asset introuvable (${obj.model.assetId}).`);
      else {
        const state = ctx.assetLoadState?.(obj.model.assetId);
        if (state === 'error') push(obj.id, 'ERROR', 'model-not-loaded', `« ${obj.name} » : le modèle n'a pas pu être chargé.`);
        else if (state === 'loading') push(obj.id, 'WARNING', 'model-loading', `« ${obj.name} » : modèle en cours de chargement.`);
        else if (!ctx.nativeModelBox(obj.model.assetId)) push(obj.id, 'WARNING', 'no-bounds', `« ${obj.name} » : dimensions inconnues, placement non vérifiable.`);
      }
    }
    if (obj.type === 'group' && obj.children.length === 0) push(obj.id, 'WARNING', 'empty-group', `Le groupe « ${obj.name} » est vide.`);
  }

  // Placement (appui, sol, collisions), une fois par paire.
  const all = solids(doc, ctx);
  const seen = new Set<string>();
  for (const sub of all) {
    for (const i of placementIssues(doc, sub, all)) {
      if (i.code === 'overlap' && i.otherId) {
        const key = [i.objectId, i.otherId].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
      }
      push(i.objectId, i.severity === 'INVALID' ? 'ERROR' : 'WARNING', i.code, i.message);
    }
  }
  const status: SceneSeverity = issues.some((i) => i.severity === 'ERROR') ? 'ERROR' : issues.length ? 'WARNING' : 'OK';
  return { status, issues, checked: Object.keys(doc.objects).length };
}
