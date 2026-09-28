import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  addObjectTx,
  applyTransaction,
  commit,
  createEmptyDocument,
  createObject,
  deleteObjectTx,
  duplicateObjectTx,
  emptyHistory,
  getAllIdsInOrder,
  isEffectivelyLocked,
  redo,
  renameObjectTx,
  setLockedTx,
  setTransformTx,
  setVisibleTx,
  undo,
  uniqueName,
  updateObjectTx,
  type History,
  type SceneDocument,
  type Transaction,
} from '../index.ts';

/** Applique une transaction via l'historique et échoue le test si elle est refusée. */
function mustCommit(doc: SceneDocument, history: History, tx: Transaction, opts = {}) {
  const r = commit(doc, history, tx, opts);
  if (!r.ok) assert.fail(`commit refusé : ${r.error}`);
  return r;
}

function sceneWith(...types: Array<'box' | 'sphere' | 'light' | 'camera'>) {
  let doc = createEmptyDocument('Test');
  let history = emptyHistory();
  const ids: string[] = [];
  for (const t of types) {
    const { tx, id } = addObjectTx(doc, t);
    ({ doc, history } = mustCommit(doc, history, tx));
    ids.push(id);
  }
  return { doc, history, ids };
}

describe('création et noms', () => {
  it('ajoute des objets à la racine avec des noms uniques', () => {
    const { doc, ids } = sceneWith('box', 'box', 'sphere', 'light', 'camera');
    assert.deepEqual(doc.rootIds, ids);
    assert.deepEqual(
      ids.map((id) => doc.objects[id].name),
      ['Cube', 'Cube 2', 'Sphère', 'Lumière', 'Caméra'],
    );
    assert.equal(new Set(ids).size, 5);
  });

  it('uniqueName repart de la base pour un nom numéroté', () => {
    const { doc } = sceneWith('box', 'box');
    assert.equal(uniqueName(doc, 'Cube 2'), 'Cube 3');
    assert.equal(uniqueName(doc, 'Autre'), 'Autre');
  });
});

describe('opérations et inverses', () => {
  it("n'altère jamais le document d'origine et conserve les références non modifiées", () => {
    const { doc, ids } = sceneWith('box', 'sphere');
    const snapshot = JSON.stringify(doc);
    const tx = updateObjectTx(doc, ids[0], { name: 'Mur' });
    const { doc: next } = applyTransaction(doc, tx);
    assert.equal(JSON.stringify(doc), snapshot);
    assert.equal(next.objects[ids[0]].name, 'Mur');
    assert.equal(next.objects[ids[1]], doc.objects[ids[1]], "l'objet non touché garde la même référence");
  });

  it("l'inverse d'une transaction restaure exactement l'état", () => {
    const { doc, ids } = sceneWith('box', 'sphere', 'light');
    const tx: Transaction = {
      label: 'mix',
      ops: [
        { type: 'update', id: ids[0], changes: { transform: { position: [1, 2, 3], rotation: [0, 45, 0], scale: [2, 2, 2] } } },
        { type: 'delete', id: ids[1] },
        { type: 'settings', changes: { background: '#000000' } },
        { type: 'project', changes: { name: 'Renommé' } },
      ],
    };
    const forward = applyTransaction(doc, tx);
    const back = applyTransaction(forward.doc, forward.inverse);
    assert.deepEqual(back.doc, doc);
  });

  it('refuse un champ qui ne correspond pas au type (material sur une lumière)', () => {
    const { doc, ids } = sceneWith('light');
    const r = commit(doc, emptyHistory(), updateObjectTx(doc, ids[0], { material: { color: '#ff0000', roughness: 0.7, metalness: 0, opacity: 1 } }));
    assert.equal(r.ok, false);
  });

  it('une transaction invalide ne modifie rien (tout ou rien)', () => {
    const { doc, history, ids } = sceneWith('box');
    const tx: Transaction = {
      label: 'x',
      ops: [
        { type: 'update', id: ids[0], changes: { name: 'A' } },
        { type: 'delete', id: 'inexistant' },
      ],
    };
    const r = commit(doc, history, tx);
    assert.equal(r.ok, false);
    assert.equal(doc.objects[ids[0]].name, 'Cube');
  });
});

describe('hiérarchie (préparée pour les groupes)', () => {
  function nested() {
    // parent → enfant → petit-enfant, construit par opérations d'insertion
    let doc = createEmptyDocument();
    const parent = createObject('box', { id: 'p', name: 'Parent' });
    const child = createObject('sphere', { id: 'c', name: 'Enfant' });
    const grand = createObject('box', { id: 'g', name: 'Petit-enfant' });
    doc = applyTransaction(doc, {
      label: 'build',
      ops: [
        { type: 'insert', objects: [parent], parentId: null, index: -1 },
        { type: 'insert', objects: [child], parentId: 'p', index: -1 },
        { type: 'insert', objects: [grand], parentId: 'c', index: -1 },
      ],
    }).doc;
    return doc;
  }

  it('insère des enfants et parcourt dans le bon ordre', () => {
    const doc = nested();
    assert.deepEqual(doc.rootIds, ['p']);
    assert.deepEqual(doc.objects.p.children, ['c']);
    assert.equal(doc.objects.g.parentId, 'c');
    assert.deepEqual(getAllIdsInOrder(doc), ['p', 'c', 'g']);
  });

  it('supprime un sous-arbre entier et le restaure par undo', () => {
    const doc = nested();
    const r = mustCommit(doc, emptyHistory(), deleteObjectTx(doc, 'c'));
    assert.deepEqual(Object.keys(r.doc.objects), ['p']);
    assert.deepEqual(r.doc.objects.p.children, []);
    const u = undo(r.doc, r.history)!;
    assert.deepEqual(u.doc, doc);
  });

  it('duplique un sous-arbre avec de nouveaux identifiants cohérents', () => {
    const doc = nested();
    const { tx, id } = duplicateObjectTx(doc, 'c');
    const r = mustCommit(doc, emptyHistory(), tx);
    const copy = r.doc.objects[id];
    assert.equal(copy.parentId, 'p');
    assert.deepEqual(r.doc.objects.p.children, ['c', id]);
    assert.equal(copy.children.length, 1);
    const grandCopy = r.doc.objects[copy.children[0]];
    assert.notEqual(grandCopy.id, 'g');
    assert.equal(grandCopy.parentId, id);
    assert.equal(r.doc.objects.g.parentId, 'c', "l'original n'est pas touché");
  });

  it("le verrou d'un parent protège ses descendants", () => {
    let doc = nested();
    doc = applyTransaction(doc, setLockedTx(doc, 'p', true)).doc;
    assert.equal(isEffectivelyLocked(doc, 'g'), true);
    const r = commit(doc, emptyHistory(), setTransformTx(doc, 'g', { position: [5, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }));
    assert.equal(r.ok, false);
    const del = commit(doc, emptyHistory(), deleteObjectTx(doc, 'c'));
    assert.equal(del.ok, false);
    const ins = commit(doc, emptyHistory(), {
      label: 'x',
      ops: [{ type: 'insert', objects: [createObject('box')], parentId: 'g', index: -1 }],
    });
    assert.equal(ins.ok, false);
  });
});

describe('verrouillage', () => {
  it('bloque transform, matériau et suppression ; autorise nom, visibilité et déverrouillage', () => {
    let { doc, history, ids } = sceneWith('box');
    const id = ids[0];
    ({ doc, history } = mustCommit(doc, history, setLockedTx(doc, id, true)));

    const move = commit(doc, history, setTransformTx(doc, id, { position: [3, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }));
    assert.equal(move.ok, false);
    if (!move.ok) assert.match(move.error, /verrouillé/);
    assert.equal(commit(doc, history, updateObjectTx(doc, id, { material: { color: '#ff0000', roughness: 0.7, metalness: 0, opacity: 1 } })).ok, false);
    assert.equal(commit(doc, history, deleteObjectTx(doc, id)).ok, false);

    ({ doc, history } = mustCommit(doc, history, renameObjectTx(doc, id, 'Comptoir')));
    ({ doc, history } = mustCommit(doc, history, setVisibleTx(doc, id, false)));
    assert.equal(doc.objects[id].name, 'Comptoir');
    assert.equal(doc.objects[id].visible, false);

    ({ doc, history } = mustCommit(doc, history, setLockedTx(doc, id, false)));
    assert.equal(commit(doc, history, deleteObjectTx(doc, id)).ok, true);
  });

  it('la copie d’un objet verrouillé est déverrouillée et décalée', () => {
    let { doc, history, ids } = sceneWith('box');
    ({ doc, history } = mustCommit(doc, history, setLockedTx(doc, ids[0], true)));
    const { tx, id } = duplicateObjectTx(doc, ids[0]);
    ({ doc } = mustCommit(doc, history, tx));
    assert.equal(doc.objects[id].locked, false);
    assert.deepEqual(doc.objects[id].transform.position, [1, 0.5, 0]);
    assert.deepEqual(doc.rootIds, [ids[0], id]);
  });
});

describe('undo / redo', () => {
  it('annule et rétablit une suite de commandes', () => {
    const start = sceneWith();
    let { doc, history } = start;
    const a = addObjectTx(doc, 'box');
    ({ doc, history } = mustCommit(doc, history, a.tx));
    const afterAdd = doc;
    ({ doc, history } = mustCommit(doc, history, renameObjectTx(doc, a.id, 'Table')));
    const afterRename = doc;

    let u = undo(doc, history)!;
    assert.deepEqual(u.doc, afterAdd);
    u = undo(u.doc, u.history)!;
    assert.deepEqual(u.doc, start.doc);
    assert.equal(undo(u.doc, u.history), null);

    let r = redo(u.doc, u.history)!;
    assert.deepEqual(r.doc, afterAdd);
    r = redo(r.doc, r.history)!;
    assert.deepEqual(r.doc, afterRename);
    assert.equal(redo(r.doc, r.history), null);
  });

  it('un nouveau commit après undo efface le futur', () => {
    let { doc, history, ids } = sceneWith('box');
    ({ doc, history } = mustCommit(doc, history, renameObjectTx(doc, ids[0], 'A')));
    const u = undo(doc, history)!;
    const r = mustCommit(u.doc, u.history, renameObjectTx(u.doc, ids[0], 'B'));
    assert.equal(r.history.future.length, 0);
  });

  it('fusionne les commits rapprochés ayant la même clé (ex. sélecteur de couleur)', () => {
    let { doc, history, ids } = sceneWith('box');
    const before = doc;
    const colors = ['#110000', '#220000', '#330000'];
    colors.forEach((color, i) => {
      ({ doc, history } = mustCommit(doc, history, updateObjectTx(doc, ids[0], { material: { color, roughness: 0.7, metalness: 0, opacity: 1 } }), {
        mergeKey: 'color',
        now: 1000 + i * 100,
      }));
    });
    assert.equal(history.past.length, 2, 'ajout + une seule entrée couleur');
    const u = undo(doc, history)!;
    assert.deepEqual(u.doc, before);
  });

  it('ne fusionne pas au-delà de la fenêtre de temps', () => {
    let { doc, history, ids } = sceneWith('box');
    ({ doc, history } = mustCommit(doc, history, updateObjectTx(doc, ids[0], { material: { color: '#110000', roughness: 0.7, metalness: 0, opacity: 1 } }), { mergeKey: 'c', now: 0 }));
    ({ doc, history } = mustCommit(doc, history, updateObjectTx(doc, ids[0], { material: { color: '#220000', roughness: 0.7, metalness: 0, opacity: 1 } }), { mergeKey: 'c', now: 5000 }));
    assert.equal(history.past.length, 3);
  });

  it('les commandes sans effet ne créent pas d’entrée', () => {
    const { doc, history, ids } = sceneWith('box');
    const r = mustCommit(doc, history, renameObjectTx(doc, ids[0], 'Cube'));
    assert.equal(r.changed, false);
    assert.equal(r.history, history);
  });
});
