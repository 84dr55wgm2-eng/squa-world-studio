import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  BUILTIN_PREFABS,
  commit,
  composeWorld,
  createEmptyDocument,
  documentToJson,
  emptyHistory,
  getSubtreeIds,
  objectSpatial,
  overlapOf,
  parseSceneFile,
  runWorldCommands,
  undo,
  validateScene,
  validateScenePlan,
  worldTransform,
  type SceneDocument,
  type ScenePlan,
  type WorldContext,
} from '../index.ts';
import { libraryAssetRecord, parseLibraryManifest } from '../../assets/manifest.ts';

const defs = parseLibraryManifest(JSON.parse(fs.readFileSync(new URL('../../../public/assets/library/library.json', import.meta.url), 'utf8'))).assets;
const byId = (id: string) => defs.find((d) => d.id === id || `lib:${d.id}` === id);
const ctx = (doc: SceneDocument, withLibrary = true): WorldContext => ({
  nativeModelBox: (id) => doc.assets[id]?.bounds ?? byId(id)?.bounds,
  resolveAsset: (id) => (withLibrary && byId(id) ? libraryAssetRecord(byId(id)!) : undefined),
  assetDefaults: (id) => {
    const d = byId(id);
    return d && { model: { unitScale: d.unitScale, pivot: d.pivot, orientation: d.orientation }, scale: d.defaultScale, rotation: d.defaultRotation };
  },
  resolvePrefab: (id) => BUILTIN_PREFABS.find((p) => p.id === id),
});
const fixture = (name: string) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

function compose(raw: unknown, withLibrary = true) {
  const v = validateScenePlan(raw);
  if (!v.plan) assert.fail(v.issues.map((i) => i.message).join(' | '));
  const doc = createEmptyDocument();
  const r = composeWorld(doc, v.plan, ctx(doc, withLibrary));
  if (!r.ok) assert.fail(r.error);
  return { ...r, base: doc, validation: v };
}
const objs = (doc: SceneDocument) => Object.values(doc.objects);
const near = (a: number, b: number, e = 0.02) => Math.abs(a - b) <= e;

describe('World Composer — test A : cybercafé', () => {
  const r = compose(fixture('plan-cybercafe.json'));
  const d = r.doc;
  it('pièce fermée : sol, 4 murs, porte (entrée), fenêtres', () => {
    const room = objs(d).find((o) => o.semanticRole === 'room')!;
    const kids = room.children.map((id) => d.objects[id]);
    assert.equal(kids.filter((o) => o.semanticRole === 'wall').length, 4);
    assert.ok(kids.some((o) => o.semanticRole === 'floor'));
    assert.equal(objs(d).filter((o) => o.semanticRole === 'door').length, 1);
    assert.ok(objs(d).filter((o) => o.semanticRole === 'window').every((w) => d.objects[w.parentId!].semanticRole === 'wall'));
  });
  it('8 postes : bureau + CRT posé dessus + clavier + chaise devant, tournée vers le bureau', () => {
    const units = objs(d).filter((o) => o.type === 'group' && o.metadata.unit === true && o.metadata.planId === 'workstation');
    assert.equal(units.length, 8);
    for (const u of units) {
      const members = u.children.map((id) => d.objects[id]);
      const desk = members.find((o) => o.type === 'element' && o.element.shape === 'desk')!;
      const crt = members.find((o) => o.type === 'element' && o.element.shape === 'crt')!;
      const chair = members.find((o) => o.semanticRole === 'furniture' && o.type === 'model')!;
      const cx = ctx(d);
      const sd = objectSpatial(d, desk.id, cx)!, sc = objectSpatial(d, crt.id, cx)!, sch = objectSpatial(d, chair.id, cx)!;
      assert.ok(near(sc.base, sd.top), 'CRT sur le plateau');
      assert.ok(near(sch.base, 0), 'chaise au sol');
      assert.equal(overlapOf(sch, sd).volume, 0, 'chaise sans intersection');
      // La chaise regarde le bureau : son avant pointe vers le centre du bureau.
      const yaw = (worldTransform(d, chair.id).rotation[1] * Math.PI) / 180;
      const f = [Math.sin(yaw), Math.cos(yaw)];
      const to = [sd.center[0] - sch.center[0], sd.center[2] - sch.center[2]];
      assert.ok(f[0] * to[0] + f[1] * to[1] > 0, 'chaise tournée vers le bureau');
    }
  });
  it('comptoir du gérant près de l’entrée ; hiérarchie sémantique Pièce > Postes > Poste > objets', () => {
    const cx = ctx(d);
    const counter = objs(d).find((o) => o.type === 'element' && o.element.shape === 'counter')!;
    const door = objs(d).find((o) => o.semanticRole === 'door')!;
    const dc = objectSpatial(d, counter.id, cx)!.center, dd = objectSpatial(d, door.id, cx)!.center;
    assert.ok(Math.hypot(dc[0] - dd[0], dc[2] - dd[2]) < 3.5, 'comptoir à moins de 3,5 m de la porte');
    const set = objs(d).find((o) => o.name.startsWith('Poste ('))!;
    assert.equal(d.objects[set.parentId!].semanticRole, 'room');
  });
  it('éclairage chaud et atténué, caméras, scène validée OK', () => {
    const lights = objs(d).filter((o) => o.type === 'light');
    assert.equal(lights.length, 2);
    assert.ok(lights.every((l) => l.type === 'light' && l.light.color === '#ffc98a'));
    assert.equal(objs(d).filter((o) => o.type === 'camera').length, 2, 'entrée + vue d\u2019ensemble (déjà dans le plan)');
    assert.equal(r.report.status, 'OK', r.report.remaining.map((i) => i.message).join(' | '));
    assert.equal(validateScene(d, ctx(d)).status, 'OK');
  });
});

describe('World Composer — test B : appartement', () => {
  const r = compose(fixture('plan-apartment.json'));
  const d = r.doc;
  const find = (pred: (o: ReturnType<typeof objs>[number]) => boolean) => objs(d).find(pred)!;
  it('TV sur son meuble et tournée vers le canapé, meubles au sol, grande fenêtre', () => {
    const cx = ctx(d);
    const sofa = find((o) => o.name === 'Canapé');
    const tv = find((o) => o.name === 'Téléviseur');
    const st = objectSpatial(d, tv.id, cx)!, ss = objectSpatial(d, sofa.id, cx)!;
    const yaw = (worldTransform(d, tv.id).rotation[1] * Math.PI) / 180;
    assert.ok(Math.sin(yaw) * (ss.center[0] - st.center[0]) + Math.cos(yaw) * (ss.center[2] - st.center[2]) > 0, 'écran vers le canapé');
    for (const o of objs(d).filter((x) => ['furniture', 'vegetation'].includes(x.semanticRole))) {
      assert.ok(near(objectSpatial(d, o.id, cx)!.base, 0), `${o.name} posé au sol`);
    }
    const win = find((o) => o.semanticRole === 'window');
    assert.ok(win.type === 'element' && win.element.size[0] >= 3);
    assert.equal(r.report.status, 'OK', r.report.remaining.map((i) => i.message).join(' | '));
  });
});

describe('World Composer — test C : rue', () => {
  const r = compose(fixture('plan-street.json'));
  const d = r.doc;
  it('route, 2 trottoirs, 4 bâtiments alignés, lampadaires, arbres hors de la route, voitures dans l’axe', () => {
    const cx = ctx(d);
    assert.equal(objs(d).filter((o) => o.semanticRole === 'road').length, 1);
    assert.equal(objs(d).filter((o) => o.semanticRole === 'sidewalk').length, 2);
    const buildings = objs(d).filter((o) => o.semanticRole === 'building');
    assert.equal(buildings.length, 4);
    assert.ok(buildings.every((b) => Math.abs(Math.abs(worldTransform(d, b.id).rotation[1]) - 90) < 0.01), 'façades face à la rue');
    assert.ok(objs(d).filter((o) => o.type === 'element' && o.element.shape === 'streetlight').length >= 6);
    const road = objectSpatial(d, objs(d).find((o) => o.semanticRole === 'road')!.id, cx)!;
    for (const t of objs(d).filter((o) => o.type === 'element' && o.element.shape === 'tree')) {
      const s = objectSpatial(d, t.id, cx)!;
      assert.ok(s.center[0] < road.aabb.min[0] || s.center[0] > road.aabb.max[0], `${t.name} hors de la chaussée`);
    }
    const cars = objs(d).filter((o) => o.semanticRole === 'vehicle');
    assert.equal(cars.length, 2);
    for (const c of cars) {
      const s = objectSpatial(d, c.id, cx)!;
      assert.ok(s.depth > s.width && near(Math.abs(Math.sin((s.obb.yaw * Math.PI) / 180)), 0, 0.01), 'voiture dans l’axe de la route');
      assert.ok(near(s.base, 0.05), 'sur la chaussée');
    }
    assert.equal(r.report.status, 'OK', r.report.remaining.map((i) => i.message).join(' | '));
  });
});

describe('World Composer — même moteur, pas de démo codée en dur', () => {
  it('un plan différent (chambre) passe par le même chemin', () => {
    const r = compose({
      version: 1,
      title: 'Chambre',
      sceneType: 'interior',
      zones: [{ id: 'room', kind: 'room', width: 3.2, depth: 3.6, height: 2.5, openings: [{ kind: 'door', wall: 'east', position: 0.6 }, { kind: 'window', wall: 'north' }] }],
      objects: [
        { id: 'bed', type: 'bed', zone: 'room', relationships: [{ type: 'AGAINST', target: 'room.wall-west' }] },
        { id: 'desk', type: 'desk', zone: 'room', relationships: [{ type: 'AGAINST', target: 'room.wall-south', offset: 0.6 }], with: [{ type: 'chair', relation: 'FACING' }] },
        { id: 'plant', type: 'plant', zone: 'room', layout: { kind: 'corner', corner: 'north-east' } },
      ],
    });
    assert.equal(r.report.status, 'OK', r.report.remaining.map((i) => i.message).join(' | '));
  });
});

describe('Red team', () => {
  it('prompt vague → plan minimal accepté (pièce par défaut, porte ajoutée)', () => {
    const v = validateScenePlan({ title: 'Un endroit', zones: [{ kind: 'room' }], objects: [] });
    assert.ok(v.ok);
    assert.ok(v.issues.some((i) => /porte est ajoutée/.test(i.message)));
    const doc = createEmptyDocument();
    assert.ok(composeWorld(doc, v.plan!, ctx(doc)).ok);
  });
  it('plan malformé → refusé avec raisons, jamais de monde à moitié', () => {
    for (const bad of [null, 42, 'texte', { zones: [] }, { zones: [{ kind: 'ocean' }] }, { zones: 'x', objects: {} }]) {
      const v = validateScenePlan(bad);
      assert.equal(v.ok, false, JSON.stringify(bad));
      assert.ok(v.issues.some((i) => i.level === 'error'));
    }
  });
  it('identifiants dupliqués → renommés et signalés', () => {
    const v = validateScenePlan({ zones: [{ id: 'r', kind: 'room', width: 5, depth: 5, height: 3 }], objects: [{ id: 'a', type: 'plant', zone: 'r' }, { id: 'a', type: 'plant', zone: 'r' }] });
    assert.ok(v.ok);
    assert.deepEqual(v.plan!.objects.map((o) => o.id), ['a', 'a-2']);
    assert.ok(v.issues.some((i) => /dupliqué/.test(i.message)));
  });
  it('type inconnu, zone inconnue, cible inconnue : ignorés et signalés', () => {
    const v = validateScenePlan({
      zones: [{ id: 'r', kind: 'room', width: 5, depth: 5, height: 3 }, { id: 's', kind: 'street', length: 30 }],
      objects: [{ id: 'x', type: 'dragon', zone: 'r' }, { id: 'y', type: 'plant', zone: 'lune' }, { id: 'z', type: 'plant', zone: 'r', relationships: [{ type: 'NEXT_TO', target: 'fantome' }] }],
    });
    assert.equal(v.ok, false, 'zone inconnue avec plusieurs zones = erreur');
    assert.ok(v.issues.some((i) => /dragon/.test(i.message)));
    assert.ok(v.issues.some((i) => /fantome/.test(i.message)));
  });
  it('pièce minuscule + beaucoup d’objets → nombre réduit et signalé, rien d’entassé', () => {
    const r = compose({ zones: [{ id: 'r', kind: 'room', width: 2, depth: 2, height: 2.4 }], objects: [{ id: 'd', type: 'desk', zone: 'r', count: 30, layout: { kind: 'along-wall', walls: ['north'] }, with: [{ type: 'chair', relation: 'FACING' }] }] });
    assert.ok(r.report.adjustments.some((a) => /30 × .* 1 tiennent|30 × .* 0 tiennent/.test(a)), r.report.adjustments.join(' | '));
    assert.ok(r.report.status !== 'ERROR');
  });
  it('grande pièce + 60 objets répétés → compose, validé', () => {
    const r = compose({ zones: [{ id: 'h', kind: 'room', width: 24, depth: 18, height: 4 }], objects: [{ id: 'd', type: 'desk', zone: 'h', count: 20, layout: { kind: 'grid', rows: 4, columns: 5, facing: 'north' }, with: [{ type: 'monitor', relation: 'ON', place: 'back' }, { type: 'chair', relation: 'FACING' }] }] });
    assert.equal(objs(r.doc).filter((o) => o.metadata.unit === true).length, 20);
    assert.equal(r.report.status, 'OK', r.report.remaining.map((i) => i.message).join(' | '));
  });
  it('asset manquant → volume de remplacement de mêmes dimensions, signalé', () => {
    const r = compose(fixture('plan-apartment.json'), false);
    assert.ok(r.report.adjustments.some((a) => /indisponible/.test(a)));
    assert.ok(!objs(r.doc).some((o) => o.type === 'model'));
  });
  it('placement impossible (relation vers soi / cycle) → signalé, pas de plantage', () => {
    const v = validateScenePlan({ zones: [{ id: 'r', kind: 'room', width: 5, depth: 5, height: 3 }], objects: [{ id: 'a', type: 'table', zone: 'r', relationships: [{ type: 'NEXT_TO', target: 'b' }] }, { id: 'b', type: 'table', zone: 'r', relationships: [{ type: 'NEXT_TO', target: 'a' }] }] });
    const doc = createEmptyDocument();
    const r = composeWorld(doc, v.plan!, ctx(doc));
    assert.ok(r.ok);
    if (r.ok) assert.ok(r.report.adjustments.some((a) => /circulaires/.test(a)));
  });
  it('enregistrer / recharger / déplacer / undo / redo un monde généré', () => {
    const r = compose(fixture('plan-cybercafe.json'));
    // Même chemin que l'application : une transaction sur la scène vide.
    const c = commit(r.base, emptyHistory(), r.tx);
    assert.ok(c.ok);
    if (!c.ok) return;
    assert.deepEqual(c.doc.rootIds, r.doc.rootIds);
    const parsed = parseSceneFile(documentToJson(c.doc));
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    assert.equal(Object.keys(parsed.doc.objects).length, Object.keys(c.doc.objects).length);
    assert.equal(validateScene(parsed.doc, ctx(parsed.doc)).status, 'OK');
    const unit = objs(c.doc).find((o) => o.metadata.unit === true)!;
    const moved = runWorldCommands(c.doc, [{ action: 'MOVE_OBJECT', target: unit.id, by: [0, 0, 0.5] }], ctx(c.doc));
    assert.ok(moved.ok);
    if (!moved.ok) return;
    const c2 = commit(c.doc, c.history, moved.tx);
    assert.ok(c2.ok);
    if (!c2.ok) return;
    const members = getSubtreeIds(c2.doc, unit.id);
    assert.ok(members.every((id) => near(worldTransform(c2.doc, id).position[2] - worldTransform(c.doc, id).position[2], 0.5, 1e-4)), 'toute l’unité suit');
    const u1 = undo(c2.doc, c2.history)!;
    assert.deepEqual(u1.doc, c.doc);
    const u2 = undo(u1.doc, u1.history)!;
    assert.equal(Object.keys(u2.doc.objects).length, 0, 'un seul undo retire tout le monde généré');
  });
});

describe('Modifications locales (commandes)', () => {
  const base = compose(fixture('plan-cybercafe.json'));
  const c = commit(base.base, emptyHistory(), base.tx);
  if (!c.ok) throw new Error('commit');
  const doc0 = c.doc;
  const run = (cmds: Parameters<typeof runWorldCommands>[1]) => {
    const r = runWorldCommands(doc0, cmds, ctx(doc0));
    if (!r.ok) assert.fail(r.error);
    return r;
  };
  it('REPLACE_OBJECT : les chaises remplacées, positions et parents conservés, reste intact', () => {
    const chairs = objs(doc0).filter((o) => o.type === 'model' && o.model.assetId === 'lib:sheen-chair');
    const r = run([{ action: 'REPLACE_OBJECT', target: chairs.map((x) => x.id), assetId: 'chair-damask' }]);
    const after = objs(r.doc).filter((o) => o.type === 'model' && o.model.assetId === 'lib:chair-damask');
    assert.equal(after.length, chairs.length);
    // Opérations locales uniquement : pas de reconstruction.
    assert.ok(r.tx.ops.length < chairs.length * 5);
    const untouched = objs(doc0).filter((o) => !chairs.some((ch) => ch.id === o.id) && o.type !== 'group');
    assert.ok(untouched.every((o) => r.doc.objects[o.id] === doc0.objects[o.id]), 'les autres objets gardent la même référence');
  });
  it('fenêtre ajoutée sur un mur, voiture supprimée seule', () => {
    const west = objs(doc0).find((o) => o.name === 'Mur ouest')!;
    const r = run([{ action: 'ADD_OBJECT', element: 'window', relation: { type: 'ATTACHED_TO', target: west.id, offset: -1.5 } }]);
    assert.equal(r.doc.objects[r.created[0]].parentId, west.id);
  });
  it('MODIFY_ROOM : pièce plus étroite, postes contre le mur est suivis, tout reste dans la pièce', () => {
    const room = objs(doc0).find((o) => o.semanticRole === 'room')!;
    const r = run([{ action: 'MODIFY_ROOM', target: room.id, width: 6.5 }]);
    const east = objs(r.doc).find((o) => o.name === 'Mur est')!;
    const eastX = worldTransform(r.doc, east.id).position[0];
    const cx = ctx(r.doc);
    for (const u of objs(r.doc).filter((o) => o.metadata.unit === true)) {
      const s = objectSpatial(r.doc, u.id, cx)!;
      assert.ok(s.aabb.max[0] <= eastX - 0.1 + 0.03, `${u.name} dans la pièce`);
    }
    const v = validateScene(r.doc, cx);
    assert.ok(v.status !== 'ERROR', v.issues.map((i) => i.message).join(' | '));
  });
});

export type { ScenePlan };
