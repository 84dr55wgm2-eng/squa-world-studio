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
import { BUILTIN_ENTRIES, DRAG_MIME, addEntry, libraryEntry, sceneEntry, type LibraryEntry } from '../../assets/libraryEntries.ts';
import { useEditor } from '../../store/editorStore.ts';
import { IconCamera, IconImport, IconLight, IconModel, ObjectTypeIcon } from '../icons.tsx';

function NeutralThumb({ entry }: { entry: LibraryEntry }) {
  return (
    <span className="thumb thumb-neutral" aria-hidden="true">
      {entry.kind === 'builtin' ? (
        entry.type === 'light' ? <IconLight size={26} /> : entry.type === 'camera' ? <IconCamera size={26} /> : <ObjectTypeIcon type={entry.type} size={26} />
      ) : (
        <IconModel size={26} />
      )}
    </span>
  );
}

const AssetCard = memo(function AssetCard({ entry }: { entry: LibraryEntry }) {
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
      title={`Ajouter : ${entry.name} (ou glisser sur la vue)`}
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
      <span className="asset-cat">{busy ? 'Chargement…' : entry.category === 'imported' ? 'Importé' : categoryLabel(entry.category)}</span>
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

  const groups = useMemo(() => {
    const entries: LibraryEntry[] = [...BUILTIN_ENTRIES, ...defs.map(libraryEntry)];
    const known = new Set(CATEGORY_TREE.map((g) => g.id));
    const result = CATEGORY_TREE.map((g) => ({ id: g.id, label: g.label, entries: entries.filter((e) => topLevelCategory(e.category) === g.id) }));
    const others = entries.filter((e) => !known.has(topLevelCategory(e.category)));
    if (others.length) result.push({ id: 'others', label: 'Autres', entries: others });
    const imported = Object.values(sceneAssets).filter((a) => a.source.kind !== 'library').map(sceneEntry);
    if (imported.length) result.unshift({ id: 'imported', label: 'Importés dans cette scène', entries: imported });
    return result.filter((g) => g.entries.length > 0);
  }, [defs, sceneAssets]);

  return (
    <section className="panel-block library-block">
      <h2 className="panel-title">Bibliothèque</h2>
      <ImportControls />
      {groups.map((g) => (
        <div key={g.id} className="library-group">
          <h3 className="section-title">{g.label}</h3>
          <div className="asset-grid">
            {g.entries.map((e) => (
              <AssetCard key={e.key} entry={e} />
            ))}
          </div>
        </div>
      ))}
      {libraryStatus === 'loading' && <p className="hint">Chargement de la bibliothèque de modèles…</p>}
      {libraryStatus === 'error' && <p className="hint hint-error">{libraryError}</p>}
      <p className="hint">Cliquez pour ajouter au centre de la vue, ou glissez une carte (ou un fichier .glb) sur la vue.</p>
    </section>
  );
}
