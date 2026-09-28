import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { BUILTIN_PREFABS, SCENE_TEMPLATES, createEmptyDocument, runWorldCommands, validateScene, type SceneDocument, type WorldContext } from '../index.ts';
import { libraryAssetRecord, parseLibraryManifest } from '../../assets/manifest.ts';

const defs = parseLibraryManifest(JSON.parse(fs.readFileSync(new URL('../../../public/assets/library/library.json', import.meta.url), 'utf8'))).assets;
const byId = (id: string) => defs.find((d) => d.id === id || `lib:${d.id}` === id);

/** Même contexte que l'application : boîtes et réglages issus du manifest réel. */
const ctx = (doc: SceneDocument): WorldContext => ({
  nativeModelBox: (id) => doc.assets[id]?.bounds ?? byId(id)?.bounds,
  resolveAsset: (id) => {
    const d = byId(id);
    return d ? libraryAssetRecord(d) : undefined;
  },
  assetDefaults: (id) => {
    const d = byId(id);
    return d && { model: { unitScale: d.unitScale, pivot: d.pivot, orientation: d.orientation }, scale: d.defaultScale, rotation: d.defaultRotation };
  },
  resolvePrefab: (id) => BUILTIN_PREFABS.find((p) => p.id === id),
});

describe('modèles et prefabs intégrés (bibliothèque réelle)', () => {
  for (const t of SCENE_TEMPLATES) {
    it(`modèle « ${t.name} » : s'exécute et la scène est valide`, () => {
      const doc = createEmptyDocument();
      const r = runWorldCommands(doc, t.commands, ctx(doc), { source: { kind: 'template', ref: t.id } });
      if (!r.ok) assert.fail(`commande ${r.index} : ${r.error}`);
      const rep = validateScene(r.doc, ctx(r.doc));
      assert.equal(rep.status, 'OK', rep.issues.map((i) => i.message).join('\n'));
      if (t.id !== 'empty') assert.ok(Object.keys(r.doc.objects).length > 10);
    });
  }
  for (const p of BUILTIN_PREFABS) {
    it(`prefab « ${p.name} » : s'instancie sans collision`, () => {
      const doc = createEmptyDocument();
      const r = runWorldCommands(doc, [{ action: 'INSTANTIATE_PREFAB', prefabId: p.id }], ctx(doc));
      if (!r.ok) assert.fail(`${r.error}`);
      const rep = validateScene(r.doc, ctx(r.doc));
      assert.equal(rep.status, 'OK', rep.issues.map((i) => i.message).join('\n'));
    });
  }
});
