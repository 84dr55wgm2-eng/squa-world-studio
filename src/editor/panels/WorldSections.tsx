/**
 * Sections de l'inspecteur liées à la composition du monde : rôle sémantique, élément
 * paramétrique, matériaux, placement relationnel + validation, groupe / prefab, sélection multiple.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  ALL_ROLES,
  ROLES,
  SHAPES,
  clampSize,
  getSubtreeIds,
  normalizeParams,
  updateObjectTx,
  validatePlacement,
  type ElementObject,
  type MaterialOverride,
  type MaterialProps,
  type ModelObject,
  type ObjectId,
  type RelationType,
  type SceneObject,
  type SemanticRole,
  type Side,
  type Vec3,
} from '../../core/index.ts';
import { useAssetStatus } from '../../assets/assetStatus.ts';
import {
  deleteSelection,
  duplicateSelection,
  execute,
  groupSelection,
  selectionRoots,
  setSelectionFlag,
  ungroupSelection,
  useEditor,
} from '../../store/editorStore.ts';
import { frameSelection } from '../../viewport/cameraController.ts';
import { changeMaterial, dropSelection, placeSelected, saveSelectionAsPrefab } from '../../world/worldActions.ts';
import { worldContext } from '../../world/worldContext.ts';
import { IconCopy, IconEye, IconEyeOff, IconGround, IconGroup, IconLock, IconPrefab, IconTarget, IconTrash, IconUngroup, IconUnlock } from '../icons.tsx';
import { NumberField } from '../widgets/NumberField.tsx';
import { TextField } from '../widgets/TextField.tsx';

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="panel-section">
      <h3 className="section-title">
        {title}
        {aside}
      </h3>
      {children}
    </section>
  );
}

const doc = () => useEditor.getState().doc;

/* ------------------------------------------------------------------ Sémantique */

export function SemanticsSection({ obj, locked }: { obj: SceneObject; locked: boolean }) {
  return (
    <Section title="Sémantique">
      <div className="prop-row">
        <span className="prop-label">Rôle</span>
        <select
          className="select-field"
          disabled={locked}
          value={obj.semanticRole}
          aria-label="Rôle sémantique"
          onChange={(e) => execute(updateObjectTx(doc(), obj.id, { semanticRole: e.target.value as SemanticRole }, `Rôle de ${obj.name}`))}
        >
          {ALL_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLES[r].label}
            </option>
          ))}
        </select>
      </div>
      <div className="prop-row">
        <span className="prop-label">Tags</span>
        <TextField
          key={obj.id}
          value={obj.tags.join(', ')}
          ariaLabel="Tags (séparés par des virgules)"
          onCommit={(text) =>
            execute(
              updateObjectTx(
                doc(),
                obj.id,
                { tags: [...new Set(text.split(',').map((t) => t.trim()).filter(Boolean))] },
                `Tags de ${obj.name}`,
              ),
            )
          }
        />
      </div>
      <p className="hint">
        Appui attendu : {SUPPORT_LABEL[ROLES[obj.semanticRole].support]}
        {obj.source ? ` · Origine : ${SOURCE_LABEL[obj.source.kind]}${obj.source.ref ? ` (${obj.source.ref})` : ''}` : ''}
      </p>
    </Section>
  );
}

const SUPPORT_LABEL = { ground: 'le sol', surface: 'une surface (sol, table…)', wall: 'un mur', ceiling: 'le plafond', none: 'aucun (peut flotter)' } as const;
const SOURCE_LABEL = { user: 'ajout manuel', template: 'modèle de scène', prefab: 'prefab', composer: 'commandes', import: 'import', ai: 'IA' } as const;

/* ------------------------------------------------------------------ Élément paramétrique */

export function ElementSection({ obj, locked }: { obj: ElementObject; locked: boolean }) {
  const def = SHAPES[obj.element.shape];
  const set = (changes: Partial<ElementObject['element']>, label: string) =>
    execute(updateObjectTx(doc(), obj.id, { element: { ...obj.element, ...changes } }, `${label} de ${obj.name}`));
  const size = obj.element.size;
  const setSize = (i: number, v: number) => {
    const next = [...size] as Vec3;
    next[i] = v;
    set({ size: clampSize(obj.element.shape, next) }, 'Dimensions');
  };
  return (
    <Section title={def.label}>
      {(['Largeur', 'Hauteur', 'Profondeur'] as const).map((label, i) => (
        <div className="prop-row" key={label}>
          <span className="prop-label">{label}</span>
          <div className="single-field">
            <NumberField value={size[i]} step={0.05} min={def.minSize[i]} disabled={locked} ariaLabel={label} onCommit={(v) => setSize(i, v)} />
            <span className="suffix">m</span>
          </div>
        </div>
      ))}
      {Object.entries(def.params).map(([key, p]) => (
        <div className="prop-row" key={key}>
          <span className="prop-label">{p.label}</span>
          <div className="single-field">
            <NumberField
              value={obj.element.params[key] ?? p.default}
              step={p.integer ? 1 : 0.01}
              min={p.min}
              max={p.max}
              disabled={locked}
              ariaLabel={p.label}
              onCommit={(v) => set({ params: normalizeParams(obj.element.shape, { ...obj.element.params, [key]: v }) }, p.label)}
            />
            {p.unit && <span className="suffix">{p.unit}</span>}
          </div>
        </div>
      ))}
      <p className="hint">Élément paramétrique : volume propre généré à partir de dimensions réelles.</p>
    </Section>
  );
}

/* ------------------------------------------------------------------ Matériaux */

function Slider({ label, value, disabled, onChange }: { label: string; value: number; disabled?: boolean; onChange: (v: number) => void }) {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <div className="slider-field">
        <input type="range" min={0} max={1} step={0.01} value={value} disabled={disabled} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
        <code>{value.toFixed(2)}</code>
      </div>
    </div>
  );
}

export function MaterialEditor({
  ids,
  value,
  locked,
  onReset,
  note,
}: {
  ids: ObjectId[];
  value: MaterialProps;
  locked: boolean;
  onReset?: () => void;
  note?: string;
}) {
  const key = ids.join('|');
  const apply = (patch: MaterialOverride, field: string) => changeMaterial(ids, patch, `mat:${field}:${key}`);
  return (
    <Section
      title="Matériau"
      aside={
        onReset && (
          <button type="button" className="link-btn section-action" disabled={locked} onClick={onReset} title="Revenir aux matériaux d'origine">
            Réinitialiser
          </button>
        )
      }
    >
      <div className="prop-row">
        <span className="prop-label">Couleur</span>
        <div className="color-field">
          <input type="color" value={value.color} disabled={locked} aria-label="Couleur de base" onChange={(e) => apply({ color: e.target.value }, 'color')} />
          <code>{value.color}</code>
        </div>
      </div>
      <Slider label="Rugosité" value={value.roughness} disabled={locked} onChange={(roughness) => apply({ roughness }, 'roughness')} />
      <Slider label="Métal" value={value.metalness} disabled={locked} onChange={(metalness) => apply({ metalness }, 'metalness')} />
      <Slider label="Opacité" value={value.opacity} disabled={locked} onChange={(opacity) => apply({ opacity }, 'opacity')} />
      {note && <p className="hint">{note}</p>}
    </Section>
  );
}

/** Valeurs affichées pour un modèle : sa surcharge, sinon des valeurs neutres (le fichier garde ses matériaux). */
export function modelMaterialValue(obj: ModelObject): MaterialProps {
  const o = obj.model.materialOverride ?? {};
  return { color: o.color ?? '#ffffff', roughness: o.roughness ?? 0.5, metalness: o.metalness ?? 0, opacity: o.opacity ?? 1 };
}

/* ------------------------------------------------------------------ Placement */

const RELATIONS: { type: RelationType; label: string; hint: string }[] = [
  { type: 'ON', label: 'Sur', hint: 'Posé sur le dessus de la cible (table, bureau, sol…)' },
  { type: 'NEXT_TO', label: 'À côté de', hint: 'Au sol, à côté de la cible, sans la toucher, tourné vers elle' },
  { type: 'AGAINST', label: 'Contre', hint: 'Dos plaqué contre la cible (mur, meuble)' },
  { type: 'INSIDE', label: 'Dans', hint: 'Au sol, à l’intérieur de la cible (pièce, groupe)' },
  { type: 'CENTERED_IN', label: 'Centré dans', hint: 'Au centre de la cible, au sol' },
  { type: 'FACING', label: 'Face à', hint: 'Tourné vers la cible, sans bouger' },
  { type: 'ATTACHED_TO', label: 'Fixé à', hint: 'Fixé dans un mur (porte, fenêtre) : devient son enfant et le perce' },
  { type: 'ALONG', label: 'Le long de', hint: 'Sur la cible, aligné sur son axe long (route, trottoir)' },
];

const SIDES: { value: Side | 'auto'; label: string }[] = [
  { value: 'auto', label: 'Automatique' },
  { value: 'front', label: 'Devant' },
  { value: 'back', label: 'Derrière' },
  { value: 'left', label: 'Gauche' },
  { value: 'right', label: 'Droite' },
];

const STATUS_LABEL = { OK: 'OK', WARNING: 'Attention', INVALID: 'Invalide' } as const;

export function PlacementSection({ obj, locked }: { obj: SceneObject; locked: boolean }) {
  // Validation recalculée à chaque modification du document (et des boîtes mesurées).
  const revision = useEditor((s) => s.revision);
  const assets = useAssetStatus((s) => s.byId);
  const report = useMemo(() => {
    void revision;
    void assets;
    const d = doc();
    return d.objects[obj.id] ? validatePlacement(d, obj.id, worldContext(d)) : null;
  }, [obj.id, revision, assets]);

  const [type, setType] = useState<RelationType>('NEXT_TO');
  const [target, setTarget] = useState<ObjectId>('');
  const [side, setSide] = useState<Side | 'auto'>('auto');
  const [gap, setGap] = useState(0.1);
  const candidates = useEditor((s) => {
    const excluded = new Set(getSubtreeIds(s.doc, obj.id));
    return Object.values(s.doc.objects)
      .filter((o) => !excluded.has(o.id) && o.type !== 'light' && o.type !== 'camera')
      .map((o) => `${o.id}\u0000${o.name}`)
      .join('\u0001');
  });
  const options = useMemo(() => (candidates ? candidates.split('\u0001').map((x) => x.split('\u0000') as [string, string]) : []), [candidates]);
  const current = RELATIONS.find((r) => r.type === type)!;
  const targetId = options.some(([id]) => id === target) ? target : '';

  return (
    <Section title="Placement">
      {report && (
        <div className={`validation-badge status-${report.status.toLowerCase()}`} role="status">
          <strong>{STATUS_LABEL[report.status]}</strong>
          {report.issues.length === 0 ? <span> — aucun problème de placement détecté.</span> : null}
          {report.issues.length > 0 && (
            <ul>
              {report.issues.slice(0, 5).map((i, k) => (
                <li key={k}>{i.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {obj.relation && (
        <p className="hint">
          Dernière relation : {RELATIONS.find((r) => r.type === obj.relation!.type)?.label ?? obj.relation.type} « {doc().objects[obj.relation.targetId]?.name ?? 'objet supprimé'} »
        </p>
      )}
      <div className="prop-row">
        <span className="prop-label">Relation</span>
        <select className="select-field" value={type} disabled={locked} onChange={(e) => setType(e.target.value as RelationType)} aria-label="Type de relation" title={current.hint}>
          {RELATIONS.map((r) => (
            <option key={r.type} value={r.type}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="prop-row">
        <span className="prop-label">Cible</span>
        <select className="select-field" value={targetId} disabled={locked} onChange={(e) => setTarget(e.target.value)} aria-label="Objet cible">
          <option value="">Choisir un objet…</option>
          {options.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </div>
      {(type === 'NEXT_TO' || type === 'AGAINST') && (
        <div className="prop-row">
          <span className="prop-label">Côté</span>
          <select className="select-field" value={side} disabled={locked} onChange={(e) => setSide(e.target.value as Side | 'auto')} aria-label="Côté">
            {SIDES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {type === 'NEXT_TO' && (
        <div className="prop-row">
          <span className="prop-label">Écart</span>
          <div className="single-field">
            <NumberField value={gap} step={0.05} min={0} disabled={locked} ariaLabel="Écart" onCommit={setGap} />
            <span className="suffix">m</span>
          </div>
        </div>
      )}
      <p className="hint">{current.hint}.</p>
      <div className="button-row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={locked || !targetId}
          onClick={() => placeSelected({ type, target: targetId, ...(type === 'NEXT_TO' || type === 'AGAINST' ? { side } : {}), ...(type === 'NEXT_TO' ? { gap } : {}) })}
        >
          Placer
        </button>
        <button type="button" className="btn" disabled={locked} onClick={dropSelection} title="Pose l'objet sur ce qui est dessous (sol, table…)">
          <IconGround /> Poser sur la surface
        </button>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ Groupe / prefab */

export function GroupSection({ obj }: { obj: SceneObject }) {
  const [name, setName] = useState('');
  return (
    <Section title={obj.type === 'group' ? 'Groupe' : 'Prefab'}>
      {obj.type === 'group' && (
        <>
          <p className="hint">
            {obj.children.length} objet{obj.children.length > 1 ? 's' : ''}. Déplacer, masquer, verrouiller, dupliquer ou supprimer le groupe agit sur tout son contenu.
            Cliquez à nouveau sur un objet du groupe dans la vue pour le sélectionner seul.
          </p>
          <div className="button-row">
            <button type="button" className="btn" onClick={ungroupSelection} title="Dégrouper (⇧⌘G / Ctrl ⇧G)">
              <IconUngroup /> Dégrouper
            </button>
          </div>
        </>
      )}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (saveSelectionAsPrefab(name || obj.name)) setName('');
        }}
      >
        <input className="text-field" placeholder={obj.name} value={name} onChange={(e) => setName(e.target.value)} aria-label="Nom du prefab" />
        <button type="submit" className="btn">
          <IconPrefab /> Enregistrer comme prefab
        </button>
      </form>
      <p className="hint">Le prefab apparaît dans la bibliothèque (catégorie Prefabs) et reste dans ce navigateur.</p>
    </Section>
  );
}

/* ------------------------------------------------------------------ Sélection multiple */

export function MultiSelectionPanel() {
  const ids = useEditor((s) => s.selectedIds);
  const names = useEditor((s) => s.selectedIds.map((id) => s.doc.objects[id]?.name ?? '').join('\u0000'));
  const allVisible = useEditor((s) => s.selectedIds.every((id) => s.doc.objects[id]?.visible));
  const allLocked = useEditor((s) => s.selectedIds.every((id) => s.doc.objects[id]?.locked));
  const hasGroup = useEditor((s) => s.selectedIds.some((id) => s.doc.objects[id]?.type === 'group'));
  const materialIds = useEditor((s) => {
    const roots = selectionRoots();
    return roots.flatMap((id) => getSubtreeIds(s.doc, id)).filter((id) => ['box', 'sphere', 'element', 'model'].includes(s.doc.objects[id]?.type)).join('|');
  });
  const list = names.split('\u0000');
  return (
    <>
      <div className="panel-header">
        <span className="type-badge">
          <IconGroup /> {ids.length} objets sélectionnés
        </span>
      </div>
      <Section title="Sélection">
        <ul className="selection-list">
          {list.slice(0, 10).map((n, i) => (
            <li key={i}>{n}</li>
          ))}
          {list.length > 10 && <li className="muted">… et {list.length - 10} autre(s)</li>}
        </ul>
        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={groupSelection} title="Grouper (⌘/Ctrl G)">
            <IconGroup /> Grouper
          </button>
          {hasGroup && (
            <button type="button" className="btn" onClick={ungroupSelection} title="Dégrouper (⇧⌘G)">
              <IconUngroup /> Dégrouper
            </button>
          )}
          <button type="button" className="btn" onClick={frameSelection} title="Cadrer (F)">
            <IconTarget /> Cadrer
          </button>
          <button type="button" className="btn" onClick={duplicateSelection} title="Dupliquer (⌘/Ctrl D)">
            <IconCopy /> Dupliquer
          </button>
          <button type="button" className="btn" onClick={dropSelection} title="Poser chaque objet sur ce qui est dessous">
            <IconGround /> Poser
          </button>
        </div>
        <div className="toggle-row">
          <button type="button" className={`toggle ${allVisible ? '' : 'is-off'}`} onClick={() => setSelectionFlag('visible', !allVisible)}>
            {allVisible ? <IconEye /> : <IconEyeOff />} {allVisible ? 'Masquer tout' : 'Afficher tout'}
          </button>
          <button type="button" className={`toggle ${allLocked ? 'is-locked' : ''}`} onClick={() => setSelectionFlag('locked', !allLocked)}>
            {allLocked ? <IconUnlock /> : <IconLock />} {allLocked ? 'Déverrouiller' : 'Verrouiller'}
          </button>
        </div>
        <div className="button-row">
          <button type="button" className="btn btn-danger" onClick={deleteSelection} title="Supprimer (Suppr)">
            <IconTrash /> Supprimer la sélection
          </button>
        </div>
      </Section>
      {materialIds && (
        <MaterialEditor
          ids={materialIds.split('|')}
          value={{ color: '#b8bcc6', roughness: 0.7, metalness: 0, opacity: 1 }}
          locked={allLocked}
          onReset={() => changeMaterial(materialIds.split('|'), null)}
          note="Appliqué à tous les objets de la sélection. « Réinitialiser » rend leurs matériaux d'origine aux modèles 3D."
        />
      )}
    </>
  );
}
