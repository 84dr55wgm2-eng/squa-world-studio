import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { LIBRARY_FORMAT, filterAssets, libraryAssetRecord, parseLibraryManifest, resolveManifestPath } from '../../assets/manifest.ts';

const manifest = {
  format: LIBRARY_FORMAT,
  version: 1,
  assets: [
    {
      id: 'chair',
      name: 'Chaise damassée',
      category: 'props.furniture',
      modelUrl: 'chair/chair.glb',
      thumbnailUrl: 'chair/thumb.jpg',
      tags: ['chaise', 'intérieur'],
      license: { spdx: 'CC-BY-4.0', author: 'Eric Chadwick', sourceUrl: 'https://example.org' },
    },
    { id: 'truck', name: 'Camion', category: 'vehicles', modelUrl: 'https://cdn.example.org/truck.glb', defaultScale: 0.5, license: { spdx: 'CC0-1.0', author: 'X' } },
    { id: 'chair', name: 'Doublon', category: 'props.furniture', modelUrl: 'x.glb' },
    { id: 'bad', name: 'Pas un modèle', category: 'props.objects', modelUrl: 'x.obj' },
    { name: 'Sans id', category: 'vehicles', modelUrl: 'y.glb' },
    { id: 'nolicense', name: 'Sans licence', category: 'mystere', modelUrl: 'z.gltf' },
    { id: 'encoded', name: 'Encodé', category: 'props.objects', modelUrl: 'e/model.glb.b64.txt', license: { spdx: 'CC0-1.0', author: 'X' } },
  ],
};

describe('manifest de bibliothèque', () => {
  it('garde les entrées valides, ignore les invalides avec un avertissement', () => {
    const r = parseLibraryManifest(manifest);
    assert.deepEqual(r.assets.map((a) => a.id), ['chair', 'truck', 'nolicense', 'encoded']);
    assert.ok(r.warnings.some((w) => w.includes('dupliqué')));
    assert.ok(r.warnings.some((w) => w.includes('.glb')));
    assert.ok(r.warnings.some((w) => w.includes('licence')));
    assert.ok(r.warnings.some((w) => w.includes('catégorie inconnue')));
  });

  it('résout les chemins relatifs au dossier du manifest, garde les URL absolues', () => {
    const [chair, truck] = parseLibraryManifest(manifest).assets;
    assert.equal(chair.modelUrl, 'assets/library/chair/chair.glb');
    assert.equal(chair.thumbnailUrl, 'assets/library/chair/thumb.jpg');
    assert.equal(truck.modelUrl, 'https://cdn.example.org/truck.glb');
    assert.equal(truck.defaultScale, 0.5);
    assert.equal(resolveManifestPath('../shared/a.glb'), 'assets/shared/a.glb');
  });

  it('refuse un fichier qui n’est pas un manifest', () => {
    assert.throws(() => parseLibraryManifest({ hello: 1 }));
    assert.throws(() => parseLibraryManifest({ ...manifest, version: 9 }));
  });

  it('produit un enregistrement de scène stable (lib:<id>) avec la licence', () => {
    const rec = libraryAssetRecord(parseLibraryManifest(manifest).assets[0]);
    assert.equal(rec.id, 'lib:chair');
    assert.deepEqual(rec.source, { kind: 'library', libraryId: 'chair', modelUrl: 'assets/library/chair/chair.glb' });
    assert.equal(rec.license?.spdx, 'CC-BY-4.0');
  });

  it('filtre par catégorie, texte (sans accents) et tags', () => {
    const defs = parseLibraryManifest(manifest).assets;
    assert.deepEqual(filterAssets(defs, { category: 'props' }).map((d) => d.id), ['chair', 'encoded']);
    assert.deepEqual(filterAssets(defs, { category: 'props.furniture' }).map((d) => d.id), ['chair']);
    assert.deepEqual(filterAssets(defs, { text: 'DAMASSEE' }).map((d) => d.id), ['chair']);
    assert.deepEqual(filterAssets(defs, { tags: ['intérieur'] }).map((d) => d.id), ['chair']);
    assert.equal(filterAssets(defs, {}).length, 4);
  });
});
