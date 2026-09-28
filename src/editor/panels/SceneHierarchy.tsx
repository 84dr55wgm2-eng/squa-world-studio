/**
 * World Outliner : arbre de la scène.
 * - clic = sélection ; ⇧ / ⌘ / Ctrl + clic = ajouter / retirer ; double-clic = renommer ;
 * - flèche = déplier / replier (un groupe se déplie tout seul quand un de ses objets est sélectionné) ;
 * - glisser une ligne sur une autre = la ranger dedans (position à l'écran conservée),
 *   sur l'en-tête « Scène » = la remonter à la racine ;
 * - recherche par nom, rôle ou tag (les parents des résultats restent affichés).
 * Chaque ligne s'abonne à son propre objet : 500 objets restent fluides.
 */
import { memo, useEffect, useMemo, useState, type DragEvent } from 'react';
import { create } from 'zustand';
import { ancestorsOf, reparentTx, renameObjectTx, ROLES, setLockedTx, setVisibleTx, type ObjectId, type SceneDocument } from '../../core/index.ts';
import { execute, notify, select, useEditor } from '../../store/editorStore.ts';
import { IconChevron, IconEye, IconEyeOff, IconLock, IconSearch, IconUnlock, IconWarning, ObjectTypeIcon } from '../icons.tsx';
import { useAssetStatus } from '../../assets/assetStatus.ts';
import { TextField } from '../widgets/TextField.tsx';

const ROW_MIME = 'application/x-squa-object';

/** Groupes dépliés (état d'interface) : chaque ligne s'abonne à SON état, rien d'autre ne se re-rend. */
const useOutliner = create<{ open: Record<ObjectId, true> }>()(() => ({ open: {} }));
const toggle = (id: ObjectId) =>
  useOutliner.setState((s) => {
    const open = { ...s.open };
    if (open[id]) delete open[id];
    else open[id] = true;
    return { open };
  });
const expandAll = (ids: ObjectId[]) =>
  useOutliner.setState((s) => (ids.every((id) => s.open[id]) ? s : { open: { ...s.open, ...Object.fromEntries(ids.map((id) => [id, true as const])) } }));
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function reparent(ids: ObjectId[], parentId: ObjectId | null) {
  const doc = useEditor.getState().doc;
  try {
    execute(reparentTx(doc, ids, parentId), { select: ids });
  } catch (e) {
    notify('error', (e as Error).message);
  }
}

interface RowProps {
  id: ObjectId;
  depth: number;
  /** Filtre de recherche : ensemble des objets à afficher (null = tous). */
  visibleIds: Set<ObjectId> | null;
}

const HierarchyRow = memo(function HierarchyRow({ id, depth, visibleIds }: RowProps) {
  const expanded = useOutliner((s) => !!s.open[id]);
  const obj = useEditor((s) => s.doc.objects[id]);
  const selected = useEditor((s) => s.selectedIds.includes(id));
  const [renaming, setRenaming] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const assetStatus = useAssetStatus((s) => (obj?.type === 'model' ? s.byId[obj.model.assetId]?.status : undefined));
  if (!obj || (visibleIds && !visibleIds.has(id))) return null;
  const doc = () => useEditor.getState().doc;
  const hasChildren = obj.children.length > 0;
  const open = hasChildren && (expanded || visibleIds !== null);

  const onDragStart = (e: DragEvent) => {
    const s = useEditor.getState();
    const ids = s.selectedIds.includes(id) ? s.selectedIds : [id];
    e.dataTransfer.setData(ROW_MIME, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDrop = (e: DragEvent) => {
    setDropOver(false);
    const raw = e.dataTransfer.getData(ROW_MIME);
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    const ids = (JSON.parse(raw) as ObjectId[]).filter((x) => x !== id);
    if (ids.length) reparent(ids, id);
  };

  return (
    <>
      <div
        className={`tree-row ${selected ? 'is-selected' : ''} ${obj.visible ? '' : 'is-hidden'} ${dropOver ? 'is-drop' : ''}`}
        style={{ paddingLeft: 4 + depth * 14 }}
        role="treeitem"
        aria-selected={selected}
        aria-expanded={hasChildren ? open : undefined}
        data-object-id={id}
        draggable={!renaming}
        onDragStart={onDragStart}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(ROW_MIME)) return;
          e.preventDefault();
          if (!dropOver) setDropOver(true);
        }}
        onDragLeave={() => setDropOver(false)}
        onDrop={onDrop}
        onClick={(e) => select(id, e.shiftKey || e.metaKey || e.ctrlKey ? 'toggle' : 'replace')}
        onDoubleClick={() => setRenaming(true)}
      >
        <button
          type="button"
          className={`tree-toggle ${hasChildren ? '' : 'is-leaf'}`}
          aria-label={open ? `Replier ${obj.name}` : `Déplier ${obj.name}`}
          tabIndex={hasChildren ? 0 : -1}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) toggle(id);
          }}
        >
          {hasChildren && <IconChevron open={open} size={12} />}
        </button>
        <span className={`tree-icon ${assetStatus === 'error' ? 'is-error' : ''}`} title={assetStatus === 'error' ? 'Impossible de charger cet asset.' : assetStatus === 'loading' ? 'Chargement…' : undefined}>
          {assetStatus === 'error' ? <IconWarning /> : <ObjectTypeIcon type={obj.type} />}
        </span>
        {renaming ? (
          <TextField className="tree-rename" value={obj.name} autoFocus ariaLabel="Renommer" onCommit={(name) => execute(renameObjectTx(doc(), id, name))} onDone={() => setRenaming(false)} />
        ) : (
          <span className="tree-name" title={`${obj.name} — ${ROLES[obj.semanticRole]?.label ?? obj.semanticRole} (double-clic pour renommer)`}>
            {obj.name}
            {hasChildren && <span className="tree-count">{obj.children.length}</span>}
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
      {open && obj.children.map((child) => <HierarchyRow key={child} id={child} depth={depth + 1} visibleIds={visibleIds} />)}
    </>
  );
});

/** Objets correspondant à la recherche, plus leurs ancêtres (pour garder l'arbre lisible). */
function searchMatches(doc: SceneDocument, query: string): Set<ObjectId> {
  const q = fold(query.trim());
  const out = new Set<ObjectId>();
  for (const o of Object.values(doc.objects)) {
    const hay = fold([o.name, ROLES[o.semanticRole]?.label ?? '', o.semanticRole, ...o.tags].join(' '));
    if (hay.includes(q)) {
      out.add(o.id);
      ancestorsOf(doc, o.id).forEach((a) => out.add(a));
    }
  }
  return out;
}

export function SceneHierarchy() {
  const rootIds = useEditor((s) => s.doc.rootIds);
  const total = useEditor((s) => Object.keys(s.doc.objects).length);
  const [query, setQuery] = useState('');
  const [rootDrop, setRootDrop] = useState(false);
  // Ancêtres de la sélection : dépliés automatiquement (la ligne sélectionnée est toujours visible).
  const autoKey = useEditor((s) => [...new Set(s.selectedIds.flatMap((id) => (s.doc.objects[id] ? ancestorsOf(s.doc, id) : [])))].join('|'));
  useEffect(() => {
    if (autoKey) expandAll(autoKey.split('|'));
  }, [autoKey]);
  const primary = useEditor((s) => s.selectedId);
  useEffect(() => {
    if (!primary) return;
    // Après le rendu des lignes dépliées.
    const t = requestAnimationFrame(() => document.querySelector(`.tree-row[data-object-id="${CSS.escape(primary)}"]`)?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(t);
  }, [primary, autoKey]);
  // La recherche est recalculée quand la requête ou le document change.
  const doc = useEditor((s) => (query.trim() ? s.doc : null));
  const visibleIds = useMemo(() => (doc && query.trim() ? searchMatches(doc, query) : null), [doc, query]);

  return (
    <section className="panel-block hierarchy-block">
      <h2
        className={`panel-title ${rootDrop ? 'is-drop' : ''}`}
        title="Déposez un objet ici pour le sortir de son groupe"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(ROW_MIME)) return;
          e.preventDefault();
          setRootDrop(true);
        }}
        onDragLeave={() => setRootDrop(false)}
        onDrop={(e) => {
          setRootDrop(false);
          const raw = e.dataTransfer.getData(ROW_MIME);
          if (raw) reparent(JSON.parse(raw) as ObjectId[], null);
        }}
      >
        Scène <span className="muted">{total > 0 ? total : ''}</span>
      </h2>
      {total > 0 && (
        <label className="search-field">
          <IconSearch />
          <input type="search" placeholder="Rechercher (nom, rôle, tag)" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Rechercher dans la scène" />
        </label>
      )}
      <div className="tree" role="tree" aria-label="Hiérarchie de la scène" aria-multiselectable>
        {rootIds.length === 0 ? (
          <p className="empty">Scène vide. Ajoutez un objet, un élément ou un modèle 3D depuis la bibliothèque, ou partez d'un modèle de scène (Nouveau).</p>
        ) : visibleIds && visibleIds.size === 0 ? (
          <p className="empty">Aucun objet ne correspond à « {query} ».</p>
        ) : (
          rootIds.map((id) => <HierarchyRow key={id} id={id} depth={0} visibleIds={visibleIds} />)
        )}
      </div>
    </section>
  );
}
