/**
 * Panneau droit : propriétés de l'objet sélectionné, ou réglages de la scène
 * lorsque rien n'est sélectionné.
 */
import {
  groundedY,
  isEffectivelyLocked,
  objectDimensions,
  objectLocalBox,
  placeOnGroundTx,
  type ModelObject,
  type ModelPivot,
  type ModelProps,
  renameObjectTx,
  setLockedTx,
  setTransformTx,
  setVisibleTx,
  updateObjectTx,
  updateSettingsTx,
  type CameraObject,
  type LightObject,
  type SceneObject,
  type Transform,
} from '../../core/index.ts';
import { deleteObject, duplicateObject, execute, selectSelectedObject, setValidatorOpen, useEditor } from '../../store/editorStore.ts';
import { worldContext } from '../../world/worldContext.ts';
import { changeMaterial } from '../../world/worldActions.ts';
import { ElementSection, GroupSection, MaterialEditor, MultiSelectionPanel, PlacementSection, Section, SemanticsSection, modelMaterialValue } from './WorldSections.tsx';
import { currentViewAsTransform, frameObject, viewThroughCamera } from '../../viewport/cameraController.ts';
import { useAssetStatus } from '../../assets/assetStatus.ts';
import { IconCopy, IconGround, IconEye, IconEyeOff, IconLock, IconShield, IconTarget, IconTrash, IconUnlock, ObjectTypeIcon, TYPE_LABEL } from '../icons.tsx';
import { NumberField } from '../widgets/NumberField.tsx';
import { TextField } from '../widgets/TextField.tsx';
import { Vec3Field } from '../widgets/Vec3Field.tsx';

const MIN_SCALE = 0.001;
const safeScale = (n: number) => (Math.abs(n) < MIN_SCALE ? (n < 0 ? -MIN_SCALE : MIN_SCALE) : n);

function ColorRow({ label, value, disabled, onChange }: { label: string; value: string; disabled?: boolean; onChange: (v: string) => void }) {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <div className="color-field">
        <input type="color" value={value} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.value)} />
        <code>{value}</code>
      </div>
    </div>
  );
}

function NumberRow(props: { label: string; value: number; disabled?: boolean; step?: number; min?: number; max?: number; onCommit: (v: number) => void; suffix?: string }) {
  return (
    <div className="prop-row">
      <span className="prop-label">{props.label}</span>
      <div className="single-field">
        <NumberField value={props.value} step={props.step} min={props.min} max={props.max} disabled={props.disabled} ariaLabel={props.label} onCommit={props.onCommit} />
        {props.suffix && <span className="suffix">{props.suffix}</span>}
      </div>
    </div>
  );
}

function TransformSection({ obj, locked }: { obj: SceneObject; locked: boolean }) {
  const commitTransform = (transform: Transform, what: string) => {
    const doc = useEditor.getState().doc;
    execute(setTransformTx(doc, obj.id, transform, `${what} ${obj.name}`));
  };
  const t = obj.transform;
  return (
    <Section title="Transform">
      <Vec3Field label="Position" value={t.position} disabled={locked} step={0.1} onCommit={(v) => commitTransform({ ...t, position: v }, 'Déplacer')} />
      <Vec3Field label="Rotation °" value={t.rotation} disabled={locked} step={5} precision={2} onCommit={(v) => commitTransform({ ...t, rotation: v }, 'Tourner')} />
      <Vec3Field label="Échelle" value={t.scale} disabled={locked} step={0.1} sanitize={safeScale} onCommit={(v) => commitTransform({ ...t, scale: v }, 'Redimensionner')} />
      <DimensionsRow obj={obj} locked={locked} />
    </Section>
  );
}

/** Dimensions réelles (L × H × P) et « Poser au sol », pour les objets dont la boîte est connue. */
function DimensionsRow({ obj, locked }: { obj: SceneObject; locked: boolean }) {
  // Boîte réelle : élément (dimensions), modèle (mesure du fichier), groupe (union de ses enfants).
  useAssetStatus((s) => (obj.type === 'model' ? s.byId[obj.model.assetId]?.nativeBox : undefined));
  const localKey = useEditor((s) => JSON.stringify(objectLocalBox(s.doc, obj.id, worldContext(s.doc))));
  const local = localKey && localKey !== 'null' ? JSON.parse(localKey) : null;
  if (!local || obj.type === 'light' || obj.type === 'camera') return null;
  const [w, h, d] = objectDimensions(local, obj.transform);
  const fmt = (v: number) => (v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3)).replace('.', ',');
  const onGround = Math.abs(groundedY(local, obj.transform) - obj.transform.position[1]) < 1e-4;
  return (
    <>
      <div className="prop-row">
        <span className="prop-label">Dimensions</span>
        <span className="dims" title="Largeur × Hauteur × Profondeur, en mètres (rotation de l'objet non comprise)">
          L {fmt(w)} · H {fmt(h)} · P {fmt(d)} m
        </span>
      </div>
      <div className="button-row">
        <button
          type="button"
          className="btn"
          disabled={locked || onGround}
          onClick={() => execute(placeOnGroundTx(useEditor.getState().doc, obj.id, local))}
          title="Aligne le point le plus bas de l'objet sur le sol (Y = 0)"
        >
          <IconGround /> {onGround ? 'Posé au sol' : 'Poser au sol'}
        </button>
      </div>
    </>
  );
}

const UNITS: { value: number; label: string }[] = [
  { value: 1, label: 'Mètre (1)' },
  { value: 0.01, label: 'Centimètre (0,01)' },
  { value: 0.001, label: 'Millimètre (0,001)' },
  { value: 0.0254, label: 'Pouce (0,0254)' },
  { value: 0.3048, label: 'Pied (0,3048)' },
];

const SOURCE_LABEL = { library: 'Bibliothèque', file: 'Fichier importé', url: 'URL distante' } as const;

function ModelSection({ obj, locked }: { obj: ModelObject; locked: boolean }) {
  const record = useEditor((s) => s.doc.assets[obj.model.assetId]);
  const info = useAssetStatus((s) => s.byId[obj.model.assetId]);
  const set = (changes: Partial<ModelProps>, label: string) =>
    execute(updateObjectTx(useEditor.getState().doc, obj.id, { model: { ...obj.model, ...changes } }, `${label} de ${obj.name}`));
  const m = obj.model;
  const unitKnown = UNITS.some((u) => u.value === m.unitScale);
  return (
    <Section title="Modèle 3D">
      <div className="prop-row">
        <span className="prop-label">Asset</span>
        <span className="value-text">{record?.name ?? 'Inconnu'}</span>
      </div>
      <div className="prop-row">
        <span className="prop-label">Source</span>
        <span className="value-text">
          {record ? SOURCE_LABEL[record.source.kind] : '—'}
          {record?.source.kind === 'file' ? ` · ${record.source.mainFile}` : ''}
        </span>
      </div>
      <div className="prop-row">
        <span className="prop-label">État</span>
        <span className={`value-text status-${info?.status ?? 'loading'}`}>
          {info?.status === 'ready' ? (info.warning ? 'Chargé (incomplet)' : 'Chargé') : info?.status === 'error' ? 'Impossible de charger cet asset.' : 'Chargement…'}
        </span>
      </div>
      {info?.status === 'error' && info.error && <p className="hint hint-error">{info.error}</p>}
      {info?.warning && <p className="hint hint-error">{info.warning}</p>}
      {info?.status === 'ready' && (
        <dl className="inspector-grid" aria-label="Informations sur l'asset">
          <dt>Maillages</dt>
          <dd>{formatCount(info.meshCount ?? 0)}</dd>
          <dt>Triangles</dt>
          <dd>{formatCount(info.triangleCount ?? 0)}</dd>
          <dt>Matériaux</dt>
          <dd>{formatCount(info.materialCount ?? 0)}</dd>
          <dt>Textures</dt>
          <dd>{formatCount(info.textureCount ?? 0)}</dd>
          <dt>Fichier</dt>
          <dd>{info.byteSize ? formatBytes(info.byteSize) : '—'}</dd>
          <dt>ID asset</dt>
          <dd>
            <code>{obj.model.assetId}</code>
          </dd>
        </dl>
      )}
      <div className="prop-row">
        <span className="prop-label">Unité</span>
        <select
          id="model-unit"
          className="select-field"
          disabled={locked}
          value={unitKnown ? String(m.unitScale) : 'custom'}
          onChange={(e) => set({ unitScale: Number(e.target.value) }, 'Unité')}
          aria-label="Unité du fichier"
        >
          {UNITS.map((u) => (
            <option key={u.value} value={String(u.value)}>
              {u.label}
            </option>
          ))}
          {!unitKnown && <option value="custom">Personnalisée ({m.unitScale})</option>}
        </select>
      </div>
      <div className="prop-row">
        <span className="prop-label">Pivot</span>
        <select id="model-pivot" className="select-field" disabled={locked} value={m.pivot} onChange={(e) => set({ pivot: e.target.value as ModelPivot }, 'Pivot')} aria-label="Pivot du modèle">
          <option value="bottom-center">Centre bas (posé au sol)</option>
          <option value="center">Centre</option>
          <option value="original">Original du fichier</option>
        </select>
      </div>
      <Vec3Field label="Orientation °" value={m.orientation} disabled={locked} step={90} precision={2} onCommit={(orientation) => set({ orientation }, 'Orientation')} />
      <div className="button-row">
        <button
          type="button"
          className="btn"
          disabled={locked}
          onClick={() => set({ orientation: m.orientation[0] === -90 ? [0, m.orientation[1], m.orientation[2]] : [-90, m.orientation[1], m.orientation[2]] }, 'Orientation')}
          title="Pour un modèle exporté avec l'axe Z vers le haut (3ds Max, SketchUp, certains exports Blender)"
        >
          {m.orientation[0] === -90 ? 'Annuler « Z vers le haut »' : 'Corriger « Z vers le haut »'}
        </button>
      </div>
      <div className="prop-row">
        <span className="prop-label">Ombres</span>
        <div className="checks">
          <label className="checkbox">
            <input type="checkbox" disabled={locked} checked={m.castShadow} onChange={(e) => set({ castShadow: e.target.checked }, 'Ombres')} /> Projette
          </label>
          <label className="checkbox">
            <input type="checkbox" disabled={locked} checked={m.receiveShadow} onChange={(e) => set({ receiveShadow: e.target.checked }, 'Ombres')} /> Reçoit
          </label>
        </div>
      </div>
      {record?.license && (
        <p className="hint">
          Licence {record.license.spdx} · {record.license.author}
          {record.license.sourceUrl && (
            <>
              {' · '}
              <a href={record.license.sourceUrl} target="_blank" rel="noreferrer">
                source
              </a>
            </>
          )}
        </p>
      )}
    </Section>
  );
}

const formatCount = (n: number) => n.toLocaleString('fr-FR');
const formatBytes = (n: number) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo` : `${Math.max(1, Math.round(n / 1e3))} Ko`);

function LightSection({ obj, locked }: { obj: LightObject; locked: boolean }) {
  const update = (light: LightObject['light'], label: string, mergeKey?: string) =>
    execute(updateObjectTx(useEditor.getState().doc, obj.id, { light }, `${label} ${obj.name}`), { mergeKey });
  return (
    <Section title="Lumière">
      <ColorRow label="Couleur" value={obj.light.color} disabled={locked} onChange={(color) => update({ ...obj.light, color }, 'Couleur de', `lightcolor:${obj.id}`)} />
      <NumberRow label="Intensité" value={obj.light.intensity} min={0} step={1} disabled={locked} suffix="cd" onCommit={(intensity) => update({ ...obj.light, intensity }, 'Intensité de')} />
      <NumberRow label="Portée" value={obj.light.distance} min={0} step={0.5} disabled={locked} suffix="m (0 = ∞)" onCommit={(distance) => update({ ...obj.light, distance }, 'Portée de')} />
    </Section>
  );
}

function CameraSection({ obj, locked }: { obj: CameraObject; locked: boolean }) {
  const setFov = (fov: number) => execute(updateObjectTx(useEditor.getState().doc, obj.id, { camera: { ...obj.camera, fov } }, `Champ de vision de ${obj.name}`));
  const alignToView = () => {
    const result = currentViewAsTransform(obj.id, obj.transform.scale);
    if (!result) return;
    const doc = useEditor.getState().doc;
    execute({
      label: `Placer ${obj.name} sur la vue`,
      ops: [...setTransformTx(doc, obj.id, result.transform).ops, ...updateObjectTx(doc, obj.id, { camera: { ...obj.camera, fov: result.fov } }).ops],
    });
  };
  return (
    <Section title="Caméra">
      <NumberRow label="Champ de vision" value={obj.camera.fov} min={1} max={170} step={1} disabled={locked} suffix="° vertical" onCommit={setFov} />
      <div className="button-row">
        <button type="button" className="btn" onClick={() => viewThroughCamera(obj.id, obj.camera.fov)} title="Place la vue de travail au point de vue de cette caméra">
          Voir depuis cette caméra
        </button>
        <button type="button" className="btn" disabled={locked} onClick={alignToView} title="Déplace cette caméra à la position de la vue de travail actuelle">
          Placer sur la vue actuelle
        </button>
      </div>
    </Section>
  );
}

function ObjectProperties({ obj }: { obj: SceneObject }) {
  const locked = useEditor((s) => isEffectivelyLocked(s.doc, obj.id));
  const inheritedLock = locked && !obj.locked;
  const doc = () => useEditor.getState().doc;

  return (
    <>
      <div className="panel-header">
        <span className="type-badge">
          <ObjectTypeIcon type={obj.type} /> {TYPE_LABEL[obj.type]}
        </span>
      </div>

      <Section title="Objet">
        <div className="prop-row">
          <span className="prop-label">Nom</span>
          <TextField key={obj.id} value={obj.name} ariaLabel="Nom de l'objet" onCommit={(name) => execute(renameObjectTx(doc(), obj.id, name))} />
        </div>
        <div className="toggle-row">
          <button
            type="button"
            className={`toggle ${obj.visible ? '' : 'is-off'}`}
            aria-pressed={obj.visible}
            onClick={() => execute(setVisibleTx(doc(), obj.id, !obj.visible))}
          >
            {obj.visible ? <IconEye /> : <IconEyeOff />} {obj.visible ? 'Visible' : 'Masqué'}
          </button>
          <button
            type="button"
            className={`toggle ${obj.locked ? 'is-locked' : ''}`}
            aria-pressed={obj.locked}
            onClick={() => execute(setLockedTx(doc(), obj.id, !obj.locked))}
          >
            {obj.locked ? <IconLock /> : <IconUnlock />} {obj.locked ? 'Verrouillé' : 'Déverrouillé'}
          </button>
        </div>
        {locked && (
          <p className="hint">
            {inheritedLock ? 'Un parent de cet objet est verrouillé.' : 'Objet verrouillé : il ne peut être ni déplacé, ni modifié, ni supprimé.'}
          </p>
        )}
        <div className="button-row">
          <button type="button" className="btn" onClick={() => frameObject(obj.id)} title="Cadrer (F)">
            <IconTarget /> Cadrer
          </button>
          <button type="button" className="btn" onClick={() => duplicateObject(obj.id)} title="Dupliquer (⌘/Ctrl + D)">
            <IconCopy /> Dupliquer
          </button>
          <button type="button" className="btn btn-danger" disabled={locked} onClick={() => deleteObject(obj.id)} title="Supprimer (Suppr)">
            <IconTrash /> Supprimer
          </button>
        </div>
      </Section>

      <TransformSection obj={obj} locked={locked} />
      {obj.type === 'element' && <ElementSection obj={obj} locked={locked} />}
      {(obj.type === 'box' || obj.type === 'sphere') && <MaterialEditor ids={[obj.id]} value={obj.material} locked={locked} />}
      {obj.type === 'element' && <MaterialEditor ids={[obj.id]} value={obj.element.material} locked={locked} />}
      {obj.type === 'light' && <LightSection obj={obj} locked={locked} />}
      {obj.type === 'camera' && <CameraSection obj={obj} locked={locked} />}
      {obj.type === 'model' && <ModelSection obj={obj} locked={locked} />}
      {obj.type === 'model' && (
        <MaterialEditor
          ids={[obj.id]}
          value={modelMaterialValue(obj)}
          locked={locked}
          onReset={obj.model.materialOverride ? () => changeMaterial([obj.id], null) : undefined}
          note={obj.model.materialOverride ? 'Matériaux du fichier modifiés pour cet objet uniquement.' : 'Matériaux d\u2019origine du fichier (GLTF) conservés. Une modification ne touche que cet objet.'}
        />
      )}
      {obj.type !== 'light' && obj.type !== 'camera' && <PlacementSection obj={obj} locked={locked} />}
      <SemanticsSection obj={obj} locked={locked} />
      {(obj.type === 'group' || obj.type === 'element' || obj.type === 'model') && <GroupSection obj={obj} />}

      <p className="id-line" title="Identifiant unique de l'objet">
        id : <code>{obj.id}</code>
      </p>
    </>
  );
}

function SceneSettingsPanel() {
  const settings = useEditor((s) => s.doc.settings);
  const count = useEditor((s) => Object.keys(s.doc.objects).length);
  const set = (changes: Parameters<typeof updateSettingsTx>[0], mergeKey?: string) => execute(updateSettingsTx(changes), { mergeKey });
  return (
    <>
      <div className="panel-header">
        <span className="type-badge">Scène</span>
        <span className="muted">
          {count} objet{count > 1 ? 's' : ''}
        </span>
      </div>
      <p className="hint">Aucun objet sélectionné. Cliquez sur un objet dans la vue ou dans la hiérarchie (⇧ + clic pour en sélectionner plusieurs).</p>
      <div className="button-row">
        <button type="button" className="btn" onClick={() => setValidatorOpen(true)}>
          <IconShield /> Valider la scène
        </button>
      </div>
      <Section title="Environnement">
        <ColorRow label="Fond" value={settings.background} onChange={(background) => set({ background }, 'bg')} />
        <NumberRow label="Ambiance" value={settings.ambientIntensity} min={0} step={0.1} onCommit={(ambientIntensity) => set({ ambientIntensity })} />
        <NumberRow label="Soleil" value={settings.sunIntensity} min={0} step={0.1} onCommit={(sunIntensity) => set({ sunIntensity })} />
        <NumberRow label="Reflets" value={settings.environmentIntensity} min={0} step={0.1} onCommit={(environmentIntensity) => set({ environmentIntensity })} />
        <div className="prop-row">
          <span className="prop-label">Ombres</span>
          <label className="checkbox">
            <input type="checkbox" checked={settings.shadows} onChange={(e) => set({ shadows: e.target.checked })} /> Ombres du soleil
          </label>
        </div>
        <div className="prop-row">
          <span className="prop-label">Grille</span>
          <label className="checkbox">
            <input type="checkbox" checked={settings.gridVisible} onChange={(e) => set({ gridVisible: e.target.checked })} /> Afficher
          </label>
        </div>
      </Section>
    </>
  );
}

export function PropertiesPanel() {
  const obj = useEditor(selectSelectedObject);
  const multi = useEditor((s) => s.selectedIds.length > 1);
  return <div className="properties">{multi ? <MultiSelectionPanel /> : obj ? <ObjectProperties obj={obj} /> : <SceneSettingsPanel />}</div>;
}
