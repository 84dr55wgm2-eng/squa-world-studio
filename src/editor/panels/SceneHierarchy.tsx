/**
 * Hiérarchie de la scène. Chaque ligne s'abonne à son propre objet.
 * Clic = sélection, double-clic = renommer, icônes = visibilité / verrou.
 */
import { memo, useState } from 'react';
import { renameObjectTx, setLockedTx, setVisibleTx, type ObjectId } from '../../core/index.ts';
import { execute, select, useEditor } from '../../store/editorStore.ts';
import { IconEye, IconEyeOff, IconLock, IconUnlock, IconWarning, ObjectTypeIcon } from '../icons.tsx';
import { useAssetStatus } from '../../assets/assetStatus.ts';
import { TextField } from '../widgets/TextField.tsx';

const HierarchyRow = memo(function HierarchyRow({ id, depth }: { id: ObjectId; depth: number }) {
  const obj = useEditor((s) => s.doc.objects[id]);
  const selected = useEditor((s) => s.selectedId === id);
  const [renaming, setRenaming] = useState(false);
  const assetStatus = useAssetStatus((s) => (obj?.type === 'model' ? s.byId[obj.model.assetId]?.status : undefined));
  if (!obj) return null;
  const doc = () => useEditor.getState().doc;

  return (
    <>
      <div
        className={`tree-row ${selected ? 'is-selected' : ''} ${obj.visible ? '' : 'is-hidden'}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        role="treeitem"
        aria-selected={selected}
        data-object-id={id}
        onClick={() => select(id)}
        onDoubleClick={() => setRenaming(true)}
      >
        <span className={`tree-icon ${assetStatus === 'error' ? 'is-error' : ''}`} title={assetStatus === 'error' ? 'Impossible de charger cet asset.' : assetStatus === 'loading' ? 'Chargement…' : undefined}>
          {assetStatus === 'error' ? <IconWarning /> : <ObjectTypeIcon type={obj.type} />}
        </span>
        {renaming ? (
          <TextField
            className="tree-rename"
            value={obj.name}
            autoFocus
            ariaLabel="Renommer"
            onCommit={(name) => execute(renameObjectTx(doc(), id, name))}
            onDone={() => setRenaming(false)}
          />
        ) : (
          <span className="tree-name" title="Double-clic pour renommer">
            {obj.name}
          </span>
        )}
        <button
          type="button"
          className={`icon-btn ${obj.visible ? 'dim' : 'active'}`}
          title={obj.visible ? 'Masquer' : 'Afficher'}
          aria-label={obj.visible ? `Masquer ${obj.name}` : `Afficher ${obj.name}`}
          onClick={(e) => {
            e.stopPropagation();
            execute(setVisibleTx(doc(), id, !obj.visible));
          }}
        >
          {obj.visible ? <IconEye /> : <IconEyeOff />}
        </button>
        <button
          type="button"
          className={`icon-btn ${obj.locked ? 'active lock' : 'dim'}`}
          title={obj.locked ? 'Déverrouiller' : 'Verrouiller'}
          aria-label={obj.locked ? `Déverrouiller ${obj.name}` : `Verrouiller ${obj.name}`}
          onClick={(e) => {
            e.stopPropagation();
            execute(setLockedTx(doc(), id, !obj.locked));
          }}
        >
          {obj.locked ? <IconLock /> : <IconUnlock />}
        </button>
      </div>
      {obj.children.map((child) => (
        <HierarchyRow key={child} id={child} depth={depth + 1} />
      ))}
    </>
  );
});

export function SceneHierarchy() {
  const rootIds = useEditor((s) => s.doc.rootIds);
  return (
    <section className="panel-block hierarchy-block">
      <h2 className="panel-title">
        Scène <span className="muted">{rootIds.length > 0 ? rootIds.length : ''}</span>
      </h2>
      <div className="tree" role="tree" aria-label="Hiérarchie de la scène">
        {rootIds.length === 0 ? (
          <p className="empty">Scène vide. Ajoutez un objet ou un modèle 3D depuis la bibliothèque.</p>
        ) : (
          rootIds.map((id) => <HierarchyRow key={id} id={id} depth={0} />)
        )}
      </div>
    </section>
  );
}
