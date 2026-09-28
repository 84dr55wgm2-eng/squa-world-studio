import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SCENE_FORMAT,
  addObjectTx,
  applyTransaction,
  createEmptyDocument,
  createObject,
  documentToJson,
  parseSceneFile,
  serializeDocument,
  setLockedTx,
  setVisibleTx,
  updateObjectTx,
  updateSettingsTx,
  type SceneDocument,
} from '../index.ts';

function richScene(): SceneDocument {
  let doc = createEmptyDocument('Cybercafé');
  const ids: string[] = [];
  for (const t of ['box', 'sphere', 'light', 'camera'] as const) {
    const { tx, id } = addObjectTx(doc, t);
    doc = applyTransaction(doc, tx).doc;
    ids.push(id);
  }
  doc = applyTransaction(doc, updateObjectTx(doc, ids[0], {
    name: 'Comptoir',
    transform: { position: [1.5, 0.5, -2], rotation: [0, 90, 0], scale: [3, 1, 0.8] },
    material: { color: '#8a5a3c', roughness: 0.7, metalness: 0, opacity: 1 },
    tags: ['mobilier'],
    metadata: { note: 'près de l’entrée' },
  })).doc;
  doc = applyTransaction(doc, setLockedTx(doc, ids[0], true)).doc;
  doc = applyTransaction(doc, setVisibleTx(doc, ids[1], false)).doc;
  doc = applyTransaction(doc, updateObjectTx(doc, ids[2], { light: { kind: 'point', color: '#ffaa55', intensity: 25, distance: 8 } })).doc;
  doc = applyTransaction(doc, updateObjectTx(doc, ids[3], { camera: { fov: 24, near: 0.1, far: 500 } })).doc;
  doc = applyTransaction(doc, updateSettingsTx({ background: '#101010', gridVisible: false })).doc;
  // un enfant, pour vérifier la hiérarchie dans le fichier
  const child = createObject('box', { id: 'enfant', name: 'Écran' });
  doc = applyTransaction(doc, { label: 'x', ops: [{ type: 'insert', objects: [child], parentId: ids[0], index: -1 }] }).doc;
  return doc;
}

describe('sauvegarde / chargement JSON', () => {
  it('aller-retour sans perte (objets, noms, transforms, visibilité, verrou, réglages, hiérarchie)', () => {
    const doc = richScene();
    const json = documentToJson(doc, new Date('2026-01-01T00:00:00Z'));
    const r = parseSceneFile(json);
    if (!r.ok) assert.fail(r.error);
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.doc.objects, doc.objects);
    assert.deepEqual(r.doc.rootIds, doc.rootIds);
    assert.deepEqual(r.doc.settings, doc.settings);
    assert.equal(r.doc.project.name, 'Cybercafé');
    assert.equal(r.doc.project.updatedAt, '2026-01-01T00:00:00.000Z');
  });

  it('écrit un en-tête de format et les objets dans l’ordre de la hiérarchie', () => {
    const file = serializeDocument(richScene());
    assert.equal(file.format, SCENE_FORMAT);
    assert.equal(file.schemaVersion, 3);
    const names = file.objects.map((o) => o.name);
    assert.deepEqual(names.slice(0, 2), ['Comptoir', 'Écran']);
  });

  it('refuse un JSON invalide ou étranger', () => {
    assert.equal(parseSceneFile('{ pas du json').ok, false);
    assert.equal(parseSceneFile(JSON.stringify({ hello: 1 })).ok, false);
  });

  it('refuse une version de format plus récente', () => {
    const file = { ...serializeDocument(richScene()), schemaVersion: 99 };
    const r = parseSceneFile(JSON.stringify(file));
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /plus récente/);
  });

  it('refuse les identifiants dupliqués et une hiérarchie incohérente', () => {
    const file = serializeDocument(richScene());
    const dup = { ...file, objects: [...file.objects, file.objects[0]] };
    assert.equal(parseSceneFile(JSON.stringify(dup)).ok, false);

    const orphan = { ...file, rootIds: file.rootIds.slice(1) };
    const r = parseSceneFile(JSON.stringify(orphan));
    assert.equal(r.ok, false);
  });

  it('refuse un transform invalide', () => {
    const file = serializeDocument(richScene()) as unknown as { objects: Array<Record<string, unknown>> };
    file.objects[0].transform = { position: [0, 'a', 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
    assert.equal(parseSceneFile(JSON.stringify(file)).ok, false);
  });

  it('complète les champs optionnels manquants avec des avertissements', () => {
    const minimal = {
      format: SCENE_FORMAT,
      version: 1,
      rootIds: ['a'],
      objects: [{ id: 'a', type: 'box', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }],
    };
    const r = parseSceneFile(JSON.stringify(minimal));
    if (!r.ok) assert.fail(r.error);
    const obj = r.doc.objects.a;
    assert.equal(obj.visible, true);
    assert.equal(obj.locked, false);
    assert.equal(obj.name, 'Cube');
    assert.ok(r.warnings.length >= 1);
  });

  it('refuse un type d’objet inconnu', () => {
    const bad = {
      format: SCENE_FORMAT,
      version: 1,
      rootIds: ['a'],
      objects: [{ id: 'a', type: 'dragon', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }],
    };
    const r = parseSceneFile(JSON.stringify(bad));
    assert.equal(r.ok, false);
  });
});
