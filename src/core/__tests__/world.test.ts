import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyTransaction,
  commit,
  createEmptyDocument,
  documentBoundsContext,
  emptyHistory,
  groupObjectsTx,
  objectSpatial,
  overlapOf,
  runWorldCommands,
  snapshotPrefab,
  undo,
  ungroupTx,
  validatePlacement,
  validateScene,
  worldTransform,
  type AssetRecord,
  type PrefabDefinition,
  type SceneDocument,
  type WorldCommand,
  type WorldContext,
} from '../index.ts';

const CHAIR: AssetRecord = {
  id: 'chair-01',
  name: 'Chaise',
  category: 'props.furniture',
  source: { kind: 'library', libraryId: 'chair-01', modelUrl: '/assets/library/chair.glb' },
  // Boîte d'un fichier fictif : 0,5 × 0,9 × 0,5 m, pivot quelconque.
  bounds: { min: [-0.25, 0, -0.25], max: [0.25, 0.9, 0.25] },
  semanticRole: 'furniture',
};

function ctxFor(prefabs: PrefabDefinition[] = []): (doc: SceneDocument) => WorldContext {
  return (doc) => ({
    ...documentBoundsContext(doc),
    nativeModelBox: (id) => doc.assets[id]?.bounds ?? (id === CHAIR.id ? CHAIR.bounds : undefined),
    resolveAsset: (id) => (id === CHAIR.id ? CHAIR : undefined),
    resolvePrefab: (id) => prefabs.find((p) => p.id === id),
  });
}

function run(doc: SceneDocument, cmds: WorldCommand[], prefabs: PrefabDefinition[] = []) {
  const r = runWorldCommands(doc, cmds, ctxFor(prefabs)(doc));
  if (!r.ok) assert.fail(`commande ${r.index} refusée : ${r.error}`);
  return r;
}

const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

describe('moteur de placement', () => {
  it('chaise À CÔTÉ du bureau : au sol, sans intersection, tournée vers le bureau', () => {
    const r = run(createEmptyDocument(), [
      { action: 'ADD_OBJECT', element: 'desk', as: 'desk', position: [1, 0, 2], rotation: [0, 30, 0] },
      { action: 'ADD_OBJECT', assetId: 'chair-01', as: 'chair', relation: { type: 'NEXT_TO', target: 'desk', side: 'front' } },
    ]);
    const ctx = ctxFor()(r.doc);
    const chair = objectSpatial(r.doc, r.aliases.chair, ctx)!;
    const desk = objectSpatial(r.doc, r.aliases.desk, ctx)!;
    near(chair.base, 0);
    assert.equal(overlapOf(chair, desk).volume, 0);
    // Face au bureau : lacet = 30 + 180 (l'avant de la chaise regarde l'avant du bureau).
    near(((chair.obb.yaw % 360) + 360) % 360, 210, 1e-2);
    // Écart de 10 cm entre les boîtes le long de l'axe avant du bureau.
    const d = Math.hypot(chair.center[0] - desk.center[0], chair.center[2] - desk.center[2]);
    near(d, desk.depth / 2 + 0.1 + chair.depth / 2, 1e-2);
    assert.equal(validatePlacement(r.doc, r.aliases.chair, ctx).status, 'OK');
    assert.deepEqual(r.doc.objects[r.aliases.chair].relation, { type: 'NEXT_TO', targetId: r.aliases.desk, params: { side: 'front' } });
  });

  it('NEXT_TO automatique choisit un côté libre', () => {
    const r = run(createEmptyDocument(), [
      { action: 'ADD_OBJECT', element: 'desk', as: 'desk' },
      { action: 'ADD_OBJECT', element: 'shelf', as: 'blocker', position: [0, 0, 0.9] },
      { action: 'ADD_OBJECT', assetId: 'chair-01', as: 'chair', relation: { type: 'NEXT_TO', target: 'desk' } },
    ]);
    const ctx = ctxFor()(r.doc);
    assert.equal(validatePlacement(r.doc, r.aliases.chair, ctx).status, 'OK');
  });

  it('écran SUR le bureau : sa base est au niveau du plateau', () => {
    const r = run(createEmptyDocument(), [
      { action: 'ADD_OBJECT', element: 'desk', as: 'desk', position: [3, 0, 0] },
      { action: 'ADD_OBJECT', element: 'monitor', as: 'screen', relation: { type: 'ON', target: 'desk' } },
    ]);
    const ctx = ctxFor()(r.doc);
    near(objectSpatial(r.doc, r.aliases.screen, ctx)!.base, 0.75);
    near(objectSpatial(r.doc, r.aliases.screen, ctx)!.center[0], 3);
    assert.equal(validatePlacement(r.doc, r.aliases.screen, ctx).status, 'OK');
  });

  it('porte FIXÉE au mur : enfant du mur, au sol, épaisseur du mur', () => {
    const r = run(createEmptyDocument(), [
      { action: 'ADD_OBJECT', element: 'wall', as: 'wall', size: [5, 2.8, 0.2], rotation: [0, 90, 0], position: [2, 0, 0] },
      { action: 'ADD_OBJECT', element: 'door', as: 'door', relation: { type: 'ATTACHED_TO', target: 'wall', offset: 1 } },
    ]);
    const door = r.doc.objects[r.aliases.door];
    assert.equal(door.parentId, r.aliases.wall);
    assert.deepEqual(door.transform.position, [1, 0, 0]);
    assert.equal(door.type === 'element' && door.element.size[2], 0.22);
    assert.equal(validatePlacement(r.doc, r.aliases.door, ctxFor()(r.doc)).status, 'OK');
  });

  it('voiture SUR la route, le long de son axe', () => {
    const r = run(createEmptyDocument(), [
      { action: 'ADD_OBJECT', element: 'road', as: 'road', rotation: [0, 90, 0] },
      { action: 'ADD_OBJECT', element: 'box', as: 'car', size: [1.8, 1.4, 4.5], role: 'vehicle', relation: { type: 'ALONG', target: 'road', t: 0.25, offset: 1.75 } },
    ]);
    const ctx = ctxFor()(r.doc);
    const car = objectSpatial(r.doc, r.aliases.car, ctx)!;
    near(car.base, 0.05);
    // La route est tournée de 90° : son axe long est X ; la voiture est alignée dessus.
    near(Math.abs(car.aabb.max[0] - car.aabb.min[0]), 4.5, 1e-2);
    assert.equal(validatePlacement(r.doc, r.aliases.car, ctx).status, 'OK');
  });

  it('CONTRE le mur et FACE à un objet', () => {
    const r = run(createEmptyDocument(), [
      { action: 'ADD_OBJECT', element: 'wall', as: 'wall', position: [0, 0, -3] },
      { action: 'ADD_OBJECT', element: 'shelf', as: 'shelf', position: [1, 0, 0], relation: { type: 'AGAINST', target: 'wall' } },
      { action: 'ADD_OBJECT', primitive: 'box', as: 'cube', position: [4, 0.5, 4], relation: { type: 'FACING', target: 'shelf' } },
    ]);
    const ctx = ctxFor()(r.doc);
    const shelf = objectSpatial(r.doc, r.aliases.shelf, ctx)!;
    near(shelf.aabb.min[2], -3 + 0.1 + 0.005); // mur de 20 cm centré sur z = -3
    near(shelf.center[0], 1);
    const cube = worldTransform(r.doc, r.aliases.cube);
    near(cube.rotation[1], (Math.atan2(1 - 4, shelf.center[2] - 4) * 180) / Math.PI, 1e-2);
  });

  it('refuse une relation vers soi-même ou une cible inconnue', () => {
    const doc = createEmptyDocument();
    const r1 = runWorldCommands(doc, [{ action: 'ADD_OBJECT', element: 'desk', as: 'a', relation: { type: 'ON', target: 'a' } }], ctxFor()(doc));
    assert.equal(r1.ok, false);
    const r2 = runWorldCommands(doc, [{ action: 'ADD_OBJECT', element: 'desk', relation: { type: 'ON', target: 'fantôme' } }], ctxFor()(doc));
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.match(r2.error, /introuvable/);
  });
});

describe('validation', () => {
  it('signale un chevauchement avec son pourcentage', () => {
    const r = run(createEmptyDocument(), [
      { action: 'ADD_OBJECT', element: 'desk', name: 'Bureau', as: 'desk' },
      { action: 'ADD_OBJECT', element: 'box', name: 'Chaise', size: [0.5, 0.9, 0.5], role: 'furniture', as: 'chair', position: [0.85, 0, 0] },
    ]);
    const rep = validatePlacement(r.doc, r.aliases.chair, ctxFor()(r.doc));
    assert.equal(rep.status, 'WARNING');
    assert.match(rep.issues[0].message, /« Chaise » chevauche « Bureau » à \d+ %/);
  });

  it('INVALID si imbriqué ou sous le sol ; WARNING si flottant', () => {
    const r = run(createEmptyDocument(), [
      { action: 'ADD_OBJECT', element: 'desk', as: 'desk' },
      { action: 'ADD_OBJECT', element: 'box', size: [0.2, 0.2, 0.2], as: 'inside', position: [0, 0.3, 0] },
      { action: 'ADD_OBJECT', element: 'box', as: 'under', position: [5, -0.3, 0] },
      { action: 'ADD_OBJECT', element: 'box', as: 'float', position: [-5, 1, 0] },
    ]);
    const ctx = ctxFor()(r.doc);
    assert.equal(validatePlacement(r.doc, r.aliases.inside, ctx).status, 'INVALID');
    assert.equal(validatePlacement(r.doc, r.aliases.under, ctx).status, 'INVALID');
    const f = validatePlacement(r.doc, r.aliases.float, ctx);
    assert.equal(f.status, 'WARNING');
    assert.equal(f.issues[0].code, 'floating');
  });

  it('validateScene : parent cassé, échelle nulle, asset manquant, modèle en erreur', () => {
    const r = run(createEmptyDocument(), [{ action: 'ADD_OBJECT', assetId: 'chair-01', as: 'c' }, { action: 'ADD_OBJECT', primitive: 'box', as: 'b' }]);
    const doc = structuredClone(r.doc);
    doc.objects[r.aliases.b].transform.scale = [0, 1, 1];
    const ctx = { ...ctxFor()(doc), assetLoadState: () => 'error' as const };
    let rep = validateScene(doc, ctx);
    assert.equal(rep.status, 'ERROR');
    assert.ok(rep.issues.some((i) => i.code === 'zero-scale'));
    assert.ok(rep.issues.some((i) => i.code === 'model-not-loaded'));
    doc.objects[r.aliases.b].parentId = 'nope';
    delete doc.assets['chair-01'];
    rep = validateScene(doc, ctxFor()(doc));
    assert.ok(rep.issues.some((i) => i.code === 'broken-parent'));
    assert.ok(rep.issues.some((i) => i.code === 'missing-asset'));
  });
});

describe('groupes', () => {
  it('grouper conserve les positions monde, dégrouper aussi, un seul undo', () => {
    const r = run(createEmptyDocument(), [
      { action: 'ADD_OBJECT', element: 'desk', as: 'a', position: [2, 0, 1], rotation: [0, 45, 0] },
      { action: 'ADD_OBJECT', primitive: 'box', as: 'b', position: [-1, 0.5, 3] },
    ]);
    const before = [worldTransform(r.doc, r.aliases.a), worldTransform(r.doc, r.aliases.b)];
    const ctx = ctxFor()(r.doc);
    const g = groupObjectsTx(r.doc, [r.aliases.a, r.aliases.b], ctx);
    const c = commit(r.doc, emptyHistory(), g.tx);
    assert.ok(c.ok);
    if (!c.ok) return;
    assert.deepEqual(c.doc.objects[g.id].children, [r.aliases.a, r.aliases.b]);
    const after = [worldTransform(c.doc, r.aliases.a), worldTransform(c.doc, r.aliases.b)];
    for (let i = 0; i < 2; i++) for (let k = 0; k < 3; k++) near(after[i].position[k], before[i].position[k]);
    // Déplacer le groupe déplace les enfants.
    const moved = applyTransaction(c.doc, { label: '', ops: [{ type: 'update', id: g.id, changes: { transform: { ...c.doc.objects[g.id].transform, position: [10, 0, 0] } } }] }).doc;
    assert.ok(worldTransform(moved, r.aliases.b).position[0] > 5);
    const u = ungroupTx(c.doc, g.id);
    const d = applyTransaction(c.doc, u.tx).doc;
    assert.equal(d.objects[g.id], undefined);
    near(worldTransform(d, r.aliases.a).position[0], 2);
    assert.deepEqual(undo(c.doc, c.history)!.doc, r.doc);
  });

  it('un groupe verrouillé protège ses enfants', () => {
    const r = run(createEmptyDocument(), [
      { action: 'ADD_OBJECT', primitive: 'box', as: 'a' },
      { action: 'GROUP_OBJECTS', targets: ['a'], as: 'g' },
      { action: 'SET_LOCK', target: 'g', locked: true },
    ]);
    const bad = runWorldCommands(r.doc, [{ action: 'TRANSFORM_OBJECT', target: r.aliases.a, position: [3, 0, 0] }], ctxFor()(r.doc));
    assert.equal(bad.ok, false);
  });
});

describe('composition (pièce, rue, prefabs)', () => {
  it('CREATE_ROOM : sol, 4 murs, porte, fenêtre, lumière ; scène valide', () => {
    const r = run(createEmptyDocument(), [
      { action: 'CREATE_ROOM', width: 6, depth: 8, height: 3, as: 'room', doors: [{ wall: 'south' }], windows: [{ wall: 'east', offset: 1 }] },
      { action: 'ADD_OBJECT', element: 'desk', as: 'desk', relation: { type: 'AGAINST', target: 'room.wall_north' } },
      { action: 'ADD_OBJECT', assetId: 'chair-01', relation: { type: 'NEXT_TO', target: 'desk', side: 'front' } },
      { action: 'ADD_OBJECT', element: 'shelf', relation: { type: 'INSIDE', target: 'room', x: -2.5, z: 2 } },
    ]);
    const room = r.doc.objects[r.aliases.room];
    assert.equal(room.semanticRole, 'room');
    const walls = room.children.filter((id) => r.doc.objects[id].semanticRole === 'wall');
    assert.equal(walls.length, 4);
    assert.equal(r.doc.objects[r.aliases['room.door']].parentId, r.aliases['room.wall_south']);
    const rep = validateScene(r.doc, ctxFor()(r.doc));
    assert.equal(rep.status, 'OK', rep.issues.map((i) => i.message).join('\n'));
  });

  it('CREATE_STREET : route, trottoirs, bâtiments, lampadaires ; scène valide', () => {
    const r = run(createEmptyDocument(), [
      { action: 'CREATE_STREET', length: 40, as: 'street' },
      { action: 'ADD_OBJECT', element: 'box', role: 'vehicle', name: 'Voiture', size: [1.8, 1.4, 4.4], relation: { type: 'ALONG', target: 'street.road', t: 0.3, offset: 1.75 } },
    ]);
    const kids = r.doc.objects[r.aliases.street].children.map((id) => r.doc.objects[id]);
    assert.ok(kids.some((o) => o.semanticRole === 'road'));
    assert.equal(kids.filter((o) => o.semanticRole === 'sidewalk').length, 2);
    assert.ok(kids.filter((o) => o.semanticRole === 'building').length >= 4);
    assert.ok(kids.filter((o) => o.type === 'element' && o.element.shape === 'streetlight').length >= 4);
    const rep = validateScene(r.doc, ctxFor()(r.doc));
    assert.equal(rep.status, 'OK', rep.issues.map((i) => i.message).join('\n'));
  });

  it('prefab : script intégré puis instantané utilisateur réinstancié ailleurs', () => {
    const builtin: PrefabDefinition = {
      id: 'office-desk',
      name: 'Poste de bureau',
      category: 'prefabs',
      tags: [],
      kind: 'commands',
      commands: [
        { action: 'ADD_OBJECT', element: 'desk', as: 'desk' },
        { action: 'ADD_OBJECT', element: 'monitor', relation: { type: 'ON', target: 'desk' } },
        { action: 'ADD_OBJECT', assetId: 'chair-01', relation: { type: 'NEXT_TO', target: 'desk', side: 'front' } },
      ],
    };
    const r = run(createEmptyDocument(), [{ action: 'INSTANTIATE_PREFAB', prefabId: 'office-desk', as: 'p', position: [5, 0, 5] }], [builtin]);
    const g = r.doc.objects[r.aliases.p];
    assert.equal(g.type, 'group');
    assert.equal(g.children.length, 3);
    assert.equal(validateScene(r.doc, ctxFor()(r.doc)).status, 'OK');

    const snap = snapshotPrefab(r.doc, r.aliases.p, { id: 'user-1', name: 'Mon poste' });
    const r2 = run(r.doc, [{ action: 'INSTANTIATE_PREFAB', prefabId: 'user-1', as: 'q', position: [-5, 0, -5] }], [snap]);
    const q = r2.doc.objects[r2.aliases.q];
    assert.equal(q.children.length, 3);
    assert.ok(q.children.every((id) => !g.children.includes(id)), 'nouveaux identifiants');
    assert.equal(validateScene(r2.doc, ctxFor()(r2.doc)).status, 'OK');
    near(worldTransform(r2.doc, q.children[0]).position[0], -5);
  });

  it('tout ou rien : une commande invalide annule tout le script', () => {
    const doc = createEmptyDocument();
    const r = runWorldCommands(doc, [{ action: 'CREATE_ROOM', width: 4, depth: 4, height: 3 }, { action: 'ADD_OBJECT', assetId: 'inconnu' }], ctxFor()(doc));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.index, 1);
  });
});

import { dropToSurface, snapAgainstNearestWall, supportLevel } from '../index.ts';

describe('aimantation aux surfaces', () => {
  it('pose sur la table sous le centre, sinon au sol ; plaque contre un mur proche', () => {
    const r = run(createEmptyDocument(), [
      { action: 'ADD_OBJECT', element: 'table', as: 'table' },
      { action: 'ADD_OBJECT', element: 'box', size: [0.2, 0.2, 0.2], as: 'cup', position: [0.3, 2, 0.1] },
      { action: 'ADD_OBJECT', element: 'box', size: [0.2, 0.2, 0.2], as: 'far', position: [4, 2, 0] },
      { action: 'ADD_OBJECT', element: 'wall', as: 'wall', position: [0, 0, -3] },
      { action: 'ADD_OBJECT', element: 'shelf', as: 'shelf', position: [1, 0, -2.6], rotation: [0, 20, 0] },
    ]);
    const ctx = ctxFor()(r.doc);
    near(supportLevel(r.doc, r.aliases.cup, ctx), 0.75);
    assert.equal(dropToSurface(r.doc, r.aliases.cup, ctx)!.transform.position[1], 0.75);
    assert.equal(dropToSurface(r.doc, r.aliases.far, ctx)!.transform.position[1], 0);
    const sol = snapAgainstNearestWall(r.doc, r.aliases.shelf, ctx)!;
    assert.ok(sol);
    near(sol.transform.rotation[1], 0);
    near(sol.transform.position[2], -3 + 0.1 + 0.005 + 0.175);
    assert.equal(snapAgainstNearestWall(r.doc, r.aliases.far, ctx), null);
  });
});
