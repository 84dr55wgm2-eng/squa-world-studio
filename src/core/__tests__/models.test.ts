import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SCENE_FORMAT,
  addModelTx,
  applyTransaction,
  commit,
  createEmptyDocument,
  createObject,
  deleteObjectTx,
  documentToJson,
  duplicateObjectTx,
  emptyHistory,
  groundedY,
  normalizeModel,
  objectDimensions,
  parseSceneFile,
  placeOnGroundTx,
  referencedFileHashes,
  setLockedTx,
  setTransformTx,
  setVisibleTx,
  transformBox,
  undo,
  updateObjectTx,
  type AssetRecord,
  type Box,
  type SceneDocument,
  type Vec3,
} from '../index.ts';

const near = (a: number[], b: number[], eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);

const CHAIR: AssetRecord = {
  id: 'lib:chair',
  name: 'Chaise',
  category: 'props.furniture',
  source: { kind: 'library', libraryId: 'chair', modelUrl: 'assets/library/chair/chair.glb' },
  license: { spdx: 'CC0-1.0', author: 'Test' },
};
const IMPORTED: AssetRecord = {
  id: 'file:abc123',
  name: 'maison.gltf',
  source: {
    kind: 'file',
    mainFile: 'maison.gltf',
    files: [
      { name: 'maison.gltf', hash: 'abc123', size: 10 },
      { name: 'maison.bin', hash: 'def456', size: 20 },
    ],
  },
};

function withModel(asset = CHAIR, opts = {}) {
  const doc = createEmptyDocument();
  const { tx, id } = addModelTx(doc, asset, opts);
  const r = commit(doc, emptyHistory(), tx);
  if (!r.ok) assert.fail(r.error);
  return { doc: r.doc, history: r.history, id };
}

describe('bounds : normalisation non destructive', () => {
  // Boîte d'un modèle « en centimètres, Z vers le haut, pivot décalé » : 100 × 50 × 200 cm, base à z = 10.
  const native: Box = { min: [10, -25, 10], max: [110, 25, 210] };

  it('transformBox : rotation de 90° autour de X échange Y et Z', () => {
    const b = transformBox({ min: [0, 0, 0], max: [1, 2, 3] }, [1, 1, 1], [90, 0, 0]);
    assert.ok(near(b.min, [0, -3, 0], 1e-9) && near(b.max, [1, 0, 2], 1e-9), JSON.stringify(b));
  });

  it('unité + orientation + pivot centre bas', () => {
    const n = normalizeModel(native, { pivot: 'bottom-center', orientation: [-90, 0, 0], unitScale: 0.01 });
    // Après -90° en X, l'axe Z du fichier devient Y : hauteur 2 m, base à y = 0 après pivot.
    assert.ok(near(n.localBox.min, [-0.5, 0, -0.25], 1e-9), JSON.stringify(n.localBox));
    assert.ok(near(n.localBox.max, [0.5, 2, 0.25], 1e-9), JSON.stringify(n.localBox));
  });

  it('pivot « original » ne décale rien', () => {
    const n = normalizeModel(native, { pivot: 'original', orientation: [0, 0, 0], unitScale: 1 });
    assert.deepEqual(n.pivotOffset, [0, 0, 0]);
    assert.deepEqual(n.localBox, native);
  });

  it('dimensions affichées = boîte locale × échelle', () => {
    const n = normalizeModel(native, { pivot: 'center', orientation: [-90, 0, 0], unitScale: 0.01 });
    const dims = objectDimensions(n.localBox, { position: [0, 0, 0], rotation: [0, 45, 0], scale: [2, 1, 1] });
    assert.ok(near(dims, [2, 2, 0.5], 1e-9), JSON.stringify(dims));
  });

  it('groundedY pose le point le plus bas sur Y = 0, même tourné', () => {
    const box: Box = { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] };
    const y = groundedY(box, { position: [3, 7, 0], rotation: [45, 0, 0], scale: [1, 1, 1] });
    assert.ok(Math.abs(y - Math.SQRT2 / 2) < 1e-9, String(y));
  });
});

describe('objets modèle', () => {
  it('ajout : enregistre l’asset et l’instance dans une seule transaction (un undo retire les deux)', () => {
    const { doc, history, id } = withModel(CHAIR, { position: [1, 0, 2] as Vec3 });
    const obj = doc.objects[id];
    assert.equal(obj.type, 'model');
    assert.equal(obj.name, 'Chaise');
    assert.deepEqual(doc.assets['lib:chair'], CHAIR);
    const u = undo(doc, history)!;
    assert.deepEqual(u.doc.assets, {});
    assert.deepEqual(u.doc.objects, {});
  });

  it('une deuxième instance ne ré-enregistre pas l’asset', () => {
    const { doc } = withModel();
    const { tx } = addModelTx(doc, CHAIR);
    assert.equal(tx.ops.length, 1);
    assert.equal(tx.ops[0].type, 'insert');
  });

  it('refuse un modèle dont l’asset n’existe pas', () => {
    const doc = createEmptyDocument();
    const obj = createObject('model', { model: { assetId: 'inconnu' } });
    const r = commit(doc, emptyHistory(), { label: 'x', ops: [{ type: 'insert', objects: [obj], parentId: null, index: -1 }] });
    assert.equal(r.ok, false);
  });

  it('refuse de retirer un asset encore utilisé', () => {
    const { doc } = withModel();
    const r = commit(doc, emptyHistory(), { label: 'x', ops: [{ type: 'asset', id: 'lib:chair', record: null }] });
    assert.equal(r.ok, false);
  });

  it('duplication : nouvel id, même asset, décalage, réglages indépendants', () => {
    let { doc, id } = withModel(CHAIR, { model: { unitScale: 0.01, pivot: 'center' } });
    const d = duplicateObjectTx(doc, id);
    doc = applyTransaction(doc, d.tx).doc;
    const a = doc.objects[id], b = doc.objects[d.id];
    assert.notEqual(d.id, id);
    assert.ok(a.type === 'model' && b.type === 'model');
    if (a.type !== 'model' || b.type !== 'model') return;
    assert.equal(b.model.assetId, 'lib:chair');
    assert.equal(b.model.unitScale, 0.01);
    assert.deepEqual(b.transform.position, [a.transform.position[0] + 1, a.transform.position[1], a.transform.position[2]]);
    assert.equal(Object.keys(doc.assets).length, 1, 'l’asset est partagé, pas copié');
    doc = applyTransaction(doc, updateObjectTx(doc, d.id, { model: { ...b.model, pivot: 'original' } })).doc;
    const a2 = doc.objects[id];
    assert.ok(a2.type === 'model' && a2.model.pivot === 'center', 'la copie est indépendante');
  });

  it('verrou, visibilité, suppression et undo fonctionnent comme pour les autres objets', () => {
    let { doc, history, id } = withModel();
    let r = commit(doc, history, setLockedTx(doc, id, true));
    assert.ok(r.ok);
    if (!r.ok) return;
    ({ doc, history } = r);
    assert.equal(commit(doc, history, setTransformTx(doc, id, { position: [5, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] })).ok, false);
    assert.equal(commit(doc, history, deleteObjectTx(doc, id)).ok, false);
    const o = doc.objects[id];
    assert.equal(o.type === 'model' && commit(doc, history, updateObjectTx(doc, id, { model: { ...o.model, pivot: 'original' } })).ok, false);
    r = commit(doc, history, setVisibleTx(doc, id, false));
    assert.ok(r.ok);
    if (!r.ok) return;
    ({ doc, history } = r);
    r = commit(doc, history, setLockedTx(doc, id, false));
    if (!r.ok) return assert.fail();
    ({ doc, history } = r);
    r = commit(doc, history, deleteObjectTx(doc, id));
    if (!r.ok) return assert.fail();
    assert.equal(r.doc.objects[id], undefined);
    const u = undo(r.doc, r.history)!;
    assert.equal(u.doc.objects[id].visible, false);
  });

  it('poser au sol', () => {
    const { doc, id } = withModel(CHAIR, { position: [2, 5, 1] as Vec3 });
    const local: Box = { min: [-0.3, 0.2, -0.3], max: [0.3, 1.1, 0.3] };
    const next = applyTransaction(doc, placeOnGroundTx(doc, id, local)).doc;
    assert.deepEqual(next.objects[id].transform.position, [2, -0.2, 1]);
  });
});

describe('format v2 : sauvegarde / rechargement des modèles', () => {
  function sceneWithModels(): SceneDocument {
    let { doc, id } = withModel(CHAIR, { position: [1, 0, -2] as Vec3, scale: [2, 2, 2] as Vec3 });
    doc = applyTransaction(doc, setLockedTx(doc, id, true)).doc;
    const b = addModelTx(doc, IMPORTED, { model: { unitScale: 0.01, orientation: [-90, 0, 0], pivot: 'original', castShadow: false } });
    doc = applyTransaction(doc, b.tx).doc;
    doc = applyTransaction(doc, setVisibleTx(doc, b.id, false)).doc;
    return doc;
  }

  it('aller-retour : asset, référence, transform, visibilité, verrou, nom, réglages du modèle', () => {
    const doc = sceneWithModels();
    const files = { abc123: { name: 'maison.gltf', size: 10, data: 'e30=' }, def456: { name: 'maison.bin', size: 20, data: 'AAAA' } };
    const r = parseSceneFile(documentToJson(doc, new Date(), files));
    if (!r.ok) assert.fail(r.error);
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.doc.objects, doc.objects);
    assert.deepEqual(r.doc.assets, doc.assets);
    assert.deepEqual(r.files, files);
  });

  it('n’écrit que les assets utilisés et liste les fichiers à intégrer', () => {
    let doc = sceneWithModels();
    assert.deepEqual(referencedFileHashes(doc).sort(), ['abc123', 'def456']);
    const imported = Object.values(doc.objects).find((o) => o.type === 'model' && o.model.assetId === IMPORTED.id)!;
    doc = applyTransaction(doc, deleteObjectTx(doc, imported.id)).doc;
    assert.ok(doc.assets[IMPORTED.id], 'reste dans la table tant que l’undo est possible');
    assert.deepEqual(referencedFileHashes(doc), []);
    const file = JSON.parse(documentToJson(doc));
    assert.deepEqual(file.assets.map((a: AssetRecord) => a.id), ['lib:chair']);
  });

  it('migre une scène v1 (sans assets)', () => {
    const v1 = {
      format: SCENE_FORMAT,
      version: 1,
      project: { name: 'Ancienne' },
      settings: { background: '#101010', ambientIntensity: 0.5, sunIntensity: 1, gridVisible: true },
      rootIds: ['a'],
      objects: [{ id: 'a', name: 'Cube', type: 'box', parentId: null, children: [], transform: { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, locked: false }],
    };
    const r = parseSceneFile(JSON.stringify(v1));
    if (!r.ok) assert.fail(r.error);
    assert.deepEqual(r.doc.assets, {});
    assert.equal(r.doc.settings.shadows, true);
    assert.ok(r.warnings.some((w) => w.includes('v1')));
  });

  it('refuse un modèle dont l’asset manque dans le fichier', () => {
    const file = JSON.parse(documentToJson(sceneWithModels()));
    file.assets = file.assets.filter((a: AssetRecord) => a.id !== 'lib:chair');
    const r = parseSceneFile(JSON.stringify(file));
    assert.equal(r.ok, false);
  });

  it('refuse une source d’asset invalide', () => {
    const file = JSON.parse(documentToJson(sceneWithModels()));
    file.assets[0].source = { kind: 'ftp', path: 'x' };
    assert.equal(parseSceneFile(JSON.stringify(file)).ok, false);
  });
});
