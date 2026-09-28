/**
 * Bibliothèque d'assets.
 * Données : objets intégrés + manifest (public/assets/library/library.json) + modèles
 * importés de la scène. Seules les catégories non vides sont affichées.
 * Clic sur une carte = ajout au centre de la vue ; glisser une carte sur la vue = ajout à cet endroit.
 */
import { memo, useMemo, useRef, useState, type DragEvent } from 'react';
import { importModelFiles, importModelUrl } from '../../assets/assetActions.ts';
import { CATEGORY_TREE, categoryLabel, topLevelCategory } from '../../assets/categories.ts';
import { useLibrary } from '../../assets/library.ts';
import { BUILTIN_ENTRIES, DRAG_MIME, ELEMENT_ENTRIES, addEntry, libraryEntry, prefabEntry, sceneEntry, type LibraryEntry } from '../../assets/libraryEntries.ts';
import { BUILTIN_PREFABS } from '../../core/index.ts';
import { useEditor } from '../../store/editorStore.ts';
import { removeUserPrefab, usePrefabs } from '../../world/prefabStore.ts';
import { askConfirm } from '../ConfirmDialog.tsx';
import { IconCamera, IconElement, IconImport, IconLight, IconModel, IconPrefab, IconSearch, IconTrash, ObjectTypeIcon } from '../icons.tsx';

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function NeutralThumb({ entry }: { entry: LibraryEntry }) {
  return (
    <span className="thumb thumb-neutral" aria-hidden="true">
      {entry.kind === 'builtin' ? (
        entry.type === 'light' ? <IconLight size={26} /> : entry.type === 'camera' ? <IconCamera size={26} /> : <ObjectTypeIcon type={entry.type} size={26} />
      ) : entry.kind === 'element' ? (
        <IconElement size={26} />
      ) : entry.kind === 'prefab' ? (
        <IconPrefab size={26} />
      ) : (
        <IconModel size={26} />
      )}
    </span>
  );
}

const KIND_HINT: Record<LibraryEntry['kind'], string> = {
  builtin: '',
  element: ' — élément paramétrique (dimensions modifiables)',
  prefab: ' — prefab (groupe prêt à l\u2019emploi)',
  library: '',
  scene: '',
};

const AssetCard = memo(function AssetCard({ entry, userPrefab }: { entry: LibraryEntry; userPrefab?: boolean }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const thumb = entry.kind === 'library' && entry.thumbnailUrl && !thumbFailed ? entry.thumbnailUrl : null;
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_MIME, entry.key);
    e.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <button
      type="button"
      className={`asset-card ${busy ? 'is-busy' : ''}`}
      draggable
      onDragStart={onDragStart}
      aria-label={entry.name}
      title={`Ajouter : ${entry.name}${KIND_HINT[entry.kind]} (ou glisser sur la vue)`}
      onClick={async () => {
        setBusy(true);
        try {
          await addEntry(entry);
        } finally {
          setBusy(false);
        }
      }}
    >
      {thumb ? (
        <img className="thumb" src={thumb} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setThumbFailed(true)} />
      ) : (
        <NeutralThumb entry={entry} />
      )}
      <span className="asset-name">{entry.name}</span>
      <span className="asset-cat">{busy ? 'Chargement…' : entry.category === 'imported' ? 'Importé' : entry.kind === 'element' ? 'Paramétrique' : categoryLabel(entry.category)}</span>
      {userPrefab && entry.kind === 'prefab' && (
        <span
          role="button"
          tabIndex={0}
          className="card-delete"
          title="Supprimer ce prefab de la bibliothèque"
          aria-label={`Supprimer le prefab ${entry.name}`}
          onClick={async (e) => {
            e.stopPropagation();
            if (await askConfirm(`Supprimer le prefab « ${entry.name} » de la bibliothèque ? Les objets déjà placés ne sont pas touchés.`, 'Supprimer')) removeUserPrefab(entry.prefab.id);
          }}
        >
          <IconTrash size={12} />
        </span>
      )}
    </button>
  );
});

function ImportControls() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="import-controls">
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp"
        onChange={(e) => {
          const files = e.target.files;
          if (files?.length) void run(() => importModelFiles(files));
          e.target.value = '';
        }}
      />
      <button type="button" className="btn btn-import" disabled={busy} onClick={() => fileInput.current?.click()} title="Fichier .glb, ou .gltf avec ses fichiers annexes">
        <IconImport /> {busy ? 'Import en cours…' : 'Importer un modèle 3D'}
      </button>
      <button type="button" className="link-btn" onClick={() => setShowUrl((v) => !v)} aria-expanded={showUrl}>
        {showUrl ? 'Masquer' : 'Depuis une URL'}
      </button>
      {showUrl && (
        <form
          className="url-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) void run(() => importModelUrl(url)).then(() => setUrl(''));
          }}
        >
          <input
            id="import-url"
            className="text-field"
            type="url"
            inputMode="url"
            placeholder="https://…/modele.glb"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Adresse d'un modèle .glb ou .gltf"
          />
          <button type="submit" className="btn" disabled={busy || !url.trim()}>
            Ajouter
          </button>
        </form>
      )}
    </div>
  );
}

export function Library() {
  const libraryStatus = useLibrary((s) => s.status);
  const libraryError = useLibrary((s) => s.error);
  const defs = useLibrary((s) => s.assets);
  const sceneAssets = useEditor((s) => s.doc.assets);
  const userPrefabs = usePrefabs((s) => s.user);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  // Sur ordinateur, la bibliothèque est un outil d'appoint : repliée par défaut (la hiérarchie a la place).
  const [expanded, setExpanded] = useState(false);

  const all = useMemo(() => {
    const imported = Object.values(sceneAssets).filter((a) => a.source.kind !== 'library').map(sceneEntry);
    return [...BUILTIN_ENTRIES, ...ELEMENT_ENTRIES, ...[...BUILTIN_PREFABS, ...userPrefabs].map(prefabEntry), ...defs.map(libraryEntry), ...imported];
  }, [defs, sceneAssets, userPrefabs]);

  // Tags les plus fréquents (filtres rapides).
  const topTags = useMemo(() => {
    const count = new Map<string, number>();
    for (const e of all) for (const t of e.tags) count.set(t, (count.get(t) ?? 0) + 1);
    return [...count.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t);
  }, [all]);

  const groups = useMemo(() => {
    const q = fold(query.trim());
    const entries = all.filter((e) => (!tag || e.tags.includes(tag)) && (!q || fold([e.name, categoryLabel(e.category), ...e.tags].join(' ')).includes(q)));
    const known = new Set(CATEGORY_TREE.map((g) => g.id));
    const result = CATEGORY_TREE.map((g) => ({ id: g.id, label: g.label, entries: entries.filter((e) => e.category !== 'imported' && topLevelCategory(e.category) === g.id) }));
    const others = entries.filter((e) => e.category !== 'imported' && !known.has(topLevelCategory(e.category)));
    if (others.length) result.push({ id: 'others', label: 'Autres', entries: others });
    const imported = entries.filter((e) => e.category === 'imported');
    if (imported.length) result.unshift({ id: 'imported', label: 'Importés dans cette scène', entries: imported });
    return result.filter((g) => g.entries.length > 0);
  }, [all, query, tag]);

  const userIds = useMemo(() => new Set(userPrefabs.map((p) => p.id)), [userPrefabs]);

  return (
    <section className={`panel-block library-block ${expanded ? '' : 'is-collapsed'}`}>
      <h2 className="panel-title">
        <button type="button" className="collapse-btn" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          <span className="collapse-caret" aria-hidden="true">{expanded ? '▾' : '▸'}</span> Bibliothèque <span className="muted">{all.length}</span>
        </button>
      </h2>
      <div className="library-content">
      <ImportControls />
      <label className="search-field">
        <IconSearch />
        <input type="search" placeholder="Rechercher (nom, catégorie, tag)" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Rechercher dans la bibliothèque" />
      </label>
      {topTags.length > 0 && (
        <div className="tag-row" role="group" aria-label="Filtrer par tag">
          {topTags.map((t) => (
            <button key={t} type="button" className={`tag-chip ${tag === t ? 'is-active' : ''}`} aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      {groups.length === 0 && <p className="empty">Aucun résultat{query ? ` pour « ${query} »` : ''}{tag ? ` avec le tag « ${tag} »` : ''}.</p>}
      {groups.map((g) => (
        <div key={g.id} className="library-group">
          <h3 className="section-title">{g.label}</h3>
          <div className="asset-grid">
            {g.entries.map((e) => (
              <AssetCard key={e.key} entry={e} userPrefab={e.kind === 'prefab' && userIds.has(e.prefab.id)} />
            ))}
          </div>
        </div>
      ))}
      {libraryStatus === 'loading' && <p className="hint">Chargement de la bibliothèque de modèles…</p>}
      {libraryStatus === 'error' && <p className="hint hint-error">{libraryError}</p>}
      <p className="hint">Cliquez pour ajouter au centre de la vue, ou glissez une carte (ou un fichier .glb) sur la vue. Avec l'aimantation aux surfaces, l'objet se pose sur ce qui est dessous (sol, table…).</p>
      </div>
    </section>
  );
}
