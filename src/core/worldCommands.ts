/**
 * API de commandes structurées du monde (JSON).
 *
 * C'est l'interface que produira plus tard un LLM : il n'écrit jamais de Three.js, il émet
 * une liste de commandes JSON que ce module valide, résout (alias, noms, assets, relations)
 * puis traduit en UNE transaction du cœur (un seul undo, verrous respectés, tout ou rien).
 *
 *   { "action": "ADD_OBJECT", "assetId": "chair-01", "as": "chair",
 *     "relation": { "type": "NEXT_TO", "target": "desk" } }
 *   { "action": "CREATE_ROOM", "width": 6, "depth": 8, "height": 3 }
 *
 * Les références d'objets acceptent : un alias défini par « as » plus tôt dans le script,
 * un identifiant d'objet, ou un nom d'objet unique dans la scène.
 */
import { createObject, uniqueName } from './factory.ts';
import { SHAPES, clampSize } from './elements.ts';
import { createId } from './ids.ts';
import { compose, localTransformFor } from './math.ts';
import { executeTransaction } from './locks.ts';
import type { Operation, Transaction } from './operations.ts';
import { changeMaterialTx, deleteManyTx, duplicateManyTx, groupObjectsTx, placeTx, reparentTx, setManyTx, ungroupTx } from './hierarchy.ts';
import type { RelationSpec, Side } from './placement.ts';
import { getSubtreeIds, SceneError } from './scene.ts';
import { isSemanticRole } from './semantics.ts';
import type { BoundsContext } from './spatial.ts';
import type {
  AssetRecord,
  ElementShape,
  MaterialOverride,
  ModelProps,
  ObjectId,
  ObjectSource,
  RelationType,
  SceneDocument,
  SceneObject,
  SemanticRole,
  Transform,
  Vec3,
} from './types.ts';

/* ------------------------------------------------------------------ Types */

export interface ObjectSpecCommon {
  name?: string;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  /** Parent (référence) ; défaut : racine. */
  parent?: string;
  role?: SemanticRole;
  tags?: string[];
  /** Alias utilisable par les commandes suivantes. */
  as?: string;
  relation?: RelationInput;
  locked?: boolean;
}

export interface RelationInput extends Omit<RelationSpec, 'target' | 'type'> {
  type: RelationType;
  target: string;
}

export type WorldCommand =
  | ({ action: 'ADD_OBJECT'; assetId: string } & ObjectSpecCommon)
  | ({ action: 'ADD_OBJECT'; element: ElementShape; size?: Vec3; params?: Record<string, number>; material?: MaterialOverride } & ObjectSpecCommon)
  | ({ action: 'ADD_OBJECT'; primitive: 'box' | 'sphere'; material?: MaterialOverride } & ObjectSpecCommon)
  | ({ action: 'ADD_OBJECT'; light: { color?: string; intensity?: number; distance?: number } } & ObjectSpecCommon)
  | ({ action: 'ADD_OBJECT'; camera: { fov?: number } } & ObjectSpecCommon)
  | { action: 'REMOVE_OBJECT'; target: string | string[] }
  | { action: 'TRANSFORM_OBJECT'; target: string; position?: Vec3; rotation?: Vec3; scale?: Vec3; space?: 'local' | 'world' }
  | { action: 'PLACE'; target: string; relation: RelationInput }
  | { action: 'GROUP_OBJECTS'; targets: string[]; name?: string; as?: string }
  | { action: 'UNGROUP_OBJECTS'; target: string }
  | { action: 'REPARENT'; target: string | string[]; parent: string | null }
  | { action: 'DUPLICATE_OBJECT'; target: string | string[]; as?: string; relation?: RelationInput }
  | { action: 'SET_VISIBILITY'; target: string | string[]; visible: boolean }
  | { action: 'SET_LOCK'; target: string | string[]; locked: boolean }
  | { action: 'RENAME'; target: string; name: string }
  | { action: 'CHANGE_MATERIAL'; target: string | string[]; material: MaterialOverride | null }
  | { action: 'SET_PROPERTIES'; target: string; role?: SemanticRole; tags?: string[]; size?: Vec3; params?: Record<string, number> }
  | ({ action: 'CREATE_ROOM' } & RoomSpec)
  | ({ action: 'CREATE_STREET' } & StreetSpec)
  | ({ action: 'INSTANTIATE_PREFAB'; prefabId: string } & ObjectSpecCommon);

export type Wall = 'north' | 'south' | 'east' | 'west';

export interface RoomSpec {
  width: number;
  depth: number;
  height: number;
  wallThickness?: number;
  name?: string;
  position?: Vec3;
  rotation?: number;
  as?: string;
  /** Portes : mur et décalage le long du mur (m, depuis son centre). */
  doors?: { wall: Wall; offset?: number; width?: number; height?: number }[];
  windows?: { wall: Wall; offset?: number; width?: number; height?: number; sill?: number }[];
  /** Plafonnier (point) : défaut vrai. */
  light?: boolean;
  ceiling?: boolean;
  floorColor?: string;
  wallColor?: string;
}

export interface StreetSpec {
  length: number;
  roadWidth?: number;
  lanes?: number;
  sidewalkWidth?: number;
  name?: string;
  position?: Vec3;
  rotation?: number;
  as?: string;
  /** Volumes de bâtiments de chaque côté. */
  buildings?: boolean;
  /** Espacement des lampadaires (m) ; 0 = aucun. */
  streetLightSpacing?: number;
}

/** Définition d'un prefab : un script de commandes (intégré) ou un instantané d'objets (utilisateur). */
export type PrefabDefinition = {
  id: string;
  name: string;
  category: string;
  tags: string[];
  description?: string;
} & ({ kind: 'commands'; commands: WorldCommand[] } | { kind: 'snapshot'; objects: SceneObject[]; assets: AssetRecord[] });

export interface WorldContext extends BoundsContext {
  /** Asset connu de la bibliothèque (pour ajouter un modèle absent de la scène). */
  resolveAsset?(assetId: string): AssetRecord | undefined;
  resolvePrefab?(prefabId: string): PrefabDefinition | undefined;
  /** Réglages d'insertion d'un asset (conversion d'unités, orientation, échelle par défaut). */
  assetDefaults?(assetId: string): { model?: Partial<Omit<ModelProps, 'assetId'>>; scale?: number; rotation?: Vec3 } | undefined;
}

export interface RunResult {
  ok: true;
  tx: Transaction;
  doc: SceneDocument;
  aliases: Record<string, ObjectId>;
  /** Objets créés (racines), dans l'ordre. */
  created: ObjectId[];
  notes: string[];
}
export interface RunError {
  ok: false;
  /** Index de la commande fautive. */
  index: number;
  error: string;
}

/* ------------------------------------------------------------------ Session */

/**
 * Session de composition : applique les commandes une à une sur un document de travail
 * (chaque relation voit les objets créés avant elle) en accumulant les opérations.
 */
class Session {
  doc: SceneDocument;
  ops: Operation[] = [];
  aliases: Record<string, ObjectId> = {};
  created: ObjectId[] = [];
  notes: string[] = [];
  readonly ctx: WorldContext;
  readonly source: ObjectSource;
  private depth: number;
  constructor(doc: SceneDocument, ctx: WorldContext, source: ObjectSource, depth = 0) {
    this.doc = doc;
    this.ctx = ctx;
    this.source = source;
    this.depth = depth;
  }

  apply(tx: Transaction) {
    if (!tx.ops.length) return;
    const r = executeTransaction(this.doc, tx);
    if (!r.ok) throw new SceneError(r.error);
    this.doc = r.doc;
    this.ops.push(...tx.ops);
  }

  ref(ref: string): ObjectId {
    if (typeof ref !== 'string' || !ref) throw new SceneError('Référence d\'objet manquante.');
    const key = ref.startsWith('$') ? ref.slice(1) : ref;
    if (this.aliases[key] && this.doc.objects[this.aliases[key]]) return this.aliases[key];
    if (this.doc.objects[ref]) return ref;
    const byName = Object.values(this.doc.objects).filter((o) => o.name === ref);
    if (byName.length === 1) return byName[0].id;
    if (byName.length > 1) throw new SceneError(`Nom ambigu « ${ref} » (${byName.length} objets) : utiliser un identifiant.`);
    throw new SceneError(`Objet introuvable : « ${ref} ».`);
  }
  refs(r: string | string[]): ObjectId[] {
    return (Array.isArray(r) ? r : [r]).map((x) => this.ref(x));
  }
  alias(name: string | undefined, id: ObjectId) {
    if (!name) return;
    if (!/^[\w.-]+$/.test(name)) throw new SceneError(`Alias invalide « ${name} » (lettres, chiffres, _ . -).`);
    this.aliases[name] = id;
  }

  relation(rel: RelationInput): RelationSpec {
    const types: RelationType[] = ['ON', 'INSIDE', 'NEXT_TO', 'AGAINST', 'CENTERED_IN', 'FACING', 'ATTACHED_TO', 'ALONG'];
    if (!rel || !types.includes(rel.type)) throw new SceneError(`Relation inconnue : ${rel?.type} (attendu : ${types.join(', ')}).`);
    const sides: (Side | 'auto')[] = ['front', 'back', 'left', 'right', 'auto'];
    if (rel.side !== undefined && !sides.includes(rel.side)) throw new SceneError(`Côté inconnu : ${rel.side}.`);
    for (const k of ['gap', 'offset', 't', 'height', 'x', 'z', 'yaw'] as const) {
      if (rel[k] !== undefined && !Number.isFinite(rel[k])) throw new SceneError(`Paramètre de relation invalide : ${k}.`);
    }
    return { ...rel, target: this.ref(rel.target) };
  }

  place(id: ObjectId, rel: RelationInput | undefined) {
    if (!rel) return;
    const { tx, notes } = placeTx(this.doc, id, this.relation(rel), this.ctx);
    this.apply(tx);
    this.notes.push(...notes);
  }

  /** Insère un objet créé et gère parent / alias / relation / verrou. */
  insert(obj: SceneObject, spec: ObjectSpecCommon, extraOps: Operation[] = []) {
    const parentId = spec.parent ? this.ref(spec.parent) : null;
    obj.name = uniqueName(this.doc, obj.name);
    this.apply({ label: '', ops: [...extraOps, { type: 'insert', objects: [obj], parentId, index: -1 }] });
    this.created.push(obj.id);
    this.alias(spec.as, obj.id);
    this.place(obj.id, spec.relation);
    if (spec.locked) this.apply({ label: '', ops: [{ type: 'update', id: obj.id, changes: { locked: true } }] });
    return obj.id;
  }

  base(spec: ObjectSpecCommon) {
    for (const k of ['position', 'rotation', 'scale'] as const) {
      const v = spec[k];
      if (v !== undefined && (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite))) throw new SceneError(`${k} doit être [x, y, z].`);
    }
    if (spec.scale?.some((v) => v === 0)) throw new SceneError('Échelle nulle interdite.');
    if (spec.role !== undefined && !isSemanticRole(spec.role)) throw new SceneError(`Rôle sémantique inconnu : ${spec.role}.`);
    return {
      name: spec.name,
      position: spec.position,
      rotation: spec.rotation,
      scale: spec.scale,
      semanticRole: spec.role,
      tags: spec.tags,
      source: this.source,
    };
  }

  run(cmd: WorldCommand) {
    if (!cmd || typeof cmd !== 'object' || typeof (cmd as { action?: unknown }).action !== 'string') throw new SceneError('Commande invalide : champ « action » manquant.');
    switch (cmd.action) {
      case 'ADD_OBJECT':
        return this.add(cmd);
      case 'REMOVE_OBJECT':
        return this.apply(deleteManyTx(this.doc, this.refs(cmd.target)));
      case 'TRANSFORM_OBJECT': {
        const id = this.ref(cmd.target);
        const obj = this.doc.objects[id];
        const next: Transform = {
          position: cmd.position ?? obj.transform.position,
          rotation: cmd.rotation ?? obj.transform.rotation,
          scale: cmd.scale ?? obj.transform.scale,
        };
        this.base(next);
        const local = cmd.space === 'world' ? localTransformFor(this.doc, obj.parentId, compose(next)) : next;
        return this.apply({ label: '', ops: [{ type: 'update', id, changes: { transform: local } }] });
      }
      case 'PLACE':
        return this.place(this.ref(cmd.target), cmd.relation);
      case 'GROUP_OBJECTS': {
        const { tx, id } = groupObjectsTx(this.doc, this.refs(cmd.targets), this.ctx, cmd.name);
        this.apply(tx);
        this.alias(cmd.as, id);
        this.created.push(id);
        return;
      }
      case 'UNGROUP_OBJECTS':
        return this.apply(ungroupTx(this.doc, this.ref(cmd.target)).tx);
      case 'REPARENT':
        return this.apply(reparentTx(this.doc, this.refs(cmd.target), cmd.parent === null ? null : this.ref(cmd.parent)));
      case 'DUPLICATE_OBJECT': {
        const { tx, ids } = duplicateManyTx(this.doc, this.refs(cmd.target));
        this.apply(tx);
        this.created.push(...ids);
        if (ids.length === 1) {
          this.alias(cmd.as, ids[0]);
          this.place(ids[0], cmd.relation);
        }
        return;
      }
      case 'SET_VISIBILITY':
        return this.apply(setManyTx(this.doc, this.refs(cmd.target), 'visible', !!cmd.visible));
      case 'SET_LOCK':
        return this.apply(setManyTx(this.doc, this.refs(cmd.target), 'locked', !!cmd.locked));
      case 'RENAME': {
        const id = this.ref(cmd.target);
        const name = String(cmd.name ?? '').trim();
        if (!name) throw new SceneError('Nom vide.');
        return this.apply({ label: '', ops: [{ type: 'update', id, changes: { name } }] });
      }
      case 'CHANGE_MATERIAL':
        return this.apply(changeMaterialTx(this.doc, this.refs(cmd.target), validMaterial(cmd.material)));
      case 'SET_PROPERTIES': {
        const id = this.ref(cmd.target);
        const obj = this.doc.objects[id];
        const changes: Record<string, unknown> = {};
        if (cmd.role !== undefined) {
          if (!isSemanticRole(cmd.role)) throw new SceneError(`Rôle sémantique inconnu : ${cmd.role}.`);
          changes.semanticRole = cmd.role;
        }
        if (cmd.tags) changes.tags = cmd.tags.map(String);
        if (cmd.size || cmd.params) {
          if (obj.type !== 'element') throw new SceneError(`« ${obj.name} » n'a pas de dimensions paramétriques.`);
          changes.element = {
            ...obj.element,
            size: cmd.size ? clampSize(obj.element.shape, cmd.size) : obj.element.size,
            params: { ...obj.element.params, ...cmd.params },
          };
        }
        return this.apply({ label: '', ops: [{ type: 'update', id, changes }] });
      }
      case 'CREATE_ROOM':
        return this.room(cmd);
      case 'CREATE_STREET':
        return this.street(cmd);
      case 'INSTANTIATE_PREFAB':
        return this.prefab(cmd);
      default:
        throw new SceneError(`Action inconnue : ${(cmd as { action: string }).action}.`);
    }
  }

  add(cmd: Extract<WorldCommand, { action: 'ADD_OBJECT' }>) {
    const base = this.base(cmd);
    if ('assetId' in cmd) {
      const asset = this.doc.assets[cmd.assetId] ?? this.ctx.resolveAsset?.(cmd.assetId);
      if (!asset) throw new SceneError(`Asset inconnu : « ${cmd.assetId} ».`);
      const extra: Operation[] = this.doc.assets[asset.id] ? [] : [{ type: 'asset', id: asset.id, record: structuredClone(asset) }];
      const defaults = this.ctx.assetDefaults?.(asset.id) ?? this.ctx.assetDefaults?.(cmd.assetId);
      const s = defaults?.scale;
      const obj = createObject('model', {
        ...base,
        rotation: base.rotation ?? defaults?.rotation,
        scale: base.scale ?? (s && s !== 1 ? [s, s, s] : undefined),
        name: base.name ?? asset.name,
        semanticRole: base.semanticRole ?? asset.semanticRole,
        category: asset.category,
        model: { ...defaults?.model, assetId: asset.id },
      });
      return this.insert(obj, cmd, extra);
    }
    if ('element' in cmd) {
      if (!(cmd.element in SHAPES)) throw new SceneError(`Élément inconnu : « ${cmd.element} » (${Object.keys(SHAPES).join(', ')}).`);
      const m = validMaterial(cmd.material ?? null) ?? {};
      const obj = createObject('element', {
        ...base,
        element: { shape: cmd.element, size: cmd.size, params: cmd.params, material: { ...SHAPES[cmd.element].material, ...m } },
      });
      return this.insert(obj, cmd);
    }
    if ('primitive' in cmd) {
      if (cmd.primitive !== 'box' && cmd.primitive !== 'sphere') throw new SceneError(`Primitive inconnue : ${cmd.primitive}.`);
      const obj = createObject(cmd.primitive, base);
      const m = validMaterial(cmd.material ?? null);
      if (m && (obj.type === 'box' || obj.type === 'sphere')) obj.material = { ...obj.material, ...m };
      return this.insert(obj, cmd);
    }
    if ('light' in cmd) {
      const obj = createObject('light', base);
      if (obj.type === 'light') obj.light = { ...obj.light, ...pickNumbers(cmd.light, ['intensity', 'distance']), ...(cmd.light?.color ? { color: cmd.light.color } : {}) };
      return this.insert(obj, cmd);
    }
    if ('camera' in cmd) {
      const obj = createObject('camera', base);
      if (obj.type === 'camera' && Number.isFinite(cmd.camera?.fov)) obj.camera.fov = Math.min(120, Math.max(10, cmd.camera.fov!));
      return this.insert(obj, cmd);
    }
    throw new SceneError('ADD_OBJECT : préciser assetId, element, primitive, light ou camera.');
  }

  /** Pièce : groupe contenant sol, 4 murs (face intérieure vers le centre), portes, fenêtres, plafonnier. */
  room(spec: RoomSpec) {
    const { width, depth, height } = spec;
    for (const [k, v] of Object.entries({ width, depth, height })) if (!Number.isFinite(v) || v <= 0 || v > 500) throw new SceneError(`CREATE_ROOM : ${k} invalide.`);
    const t = spec.wallThickness ?? 0.2;
    const src = this.source;
    const group = createObject('group', { name: spec.name ?? 'Pièce', semanticRole: 'room', position: spec.position ?? [0, 0, 0], rotation: [0, spec.rotation ?? 0, 0], source: src, tags: ['pièce', 'intérieur'] });
    const gid = this.insert(group, { as: spec.as });
    const sub = (key: string) => (spec.as ? `${spec.as}.${key}` : undefined);
    const floorMat = spec.floorColor ? { ...SHAPES.slab.material, color: spec.floorColor } : undefined;
    const floor = createObject('element', { name: 'Sol', position: [0, -0.1, 0], element: { shape: 'slab', size: [width + 2 * t, 0.1, depth + 2 * t], ...(floorMat ? { material: floorMat } : {}) }, source: src });
    this.insert(floor, { parent: gid, as: sub('floor') });
    const wallMat = spec.wallColor ? { ...SHAPES.wall.material, color: spec.wallColor } : undefined;
    const walls: Record<Wall, { pos: Vec3; rot: number; len: number; label: string }> = {
      north: { pos: [0, 0, -depth / 2 - t / 2], rot: 0, len: width + 2 * t, label: 'Mur nord' },
      south: { pos: [0, 0, depth / 2 + t / 2], rot: 180, len: width + 2 * t, label: 'Mur sud' },
      east: { pos: [width / 2 + t / 2, 0, 0], rot: -90, len: depth, label: 'Mur est' },
      west: { pos: [-width / 2 - t / 2, 0, 0], rot: 90, len: depth, label: 'Mur ouest' },
    };
    const wallIds = {} as Record<Wall, ObjectId>;
    for (const [key, w] of Object.entries(walls) as [Wall, (typeof walls)[Wall]][]) {
      const wall = createObject('element', { name: w.label, position: w.pos, rotation: [0, w.rot, 0], element: { shape: 'wall', size: [w.len, height, t], ...(wallMat ? { material: wallMat } : {}) }, source: src });
      wallIds[key] = this.insert(wall, { parent: gid, as: sub(`wall_${key}`) });
    }
    const checkWall = (w: Wall) => {
      if (!wallIds[w]) throw new SceneError(`Mur inconnu : ${w} (north, south, east, west).`);
      return wallIds[w];
    };
    (spec.doors ?? []).forEach((d, i) => {
      const door = createObject('element', { name: 'Porte', element: { shape: 'door', size: [d.width ?? 0.9, Math.min(d.height ?? 2.1, height - 0.05), 0.12] }, source: src });
      this.insert(door, { as: sub(`door${i || ''}`), relation: { type: 'ATTACHED_TO', target: checkWall(d.wall), offset: d.offset ?? 0 } });
    });
    (spec.windows ?? []).forEach((w, i) => {
      const win = createObject('element', { name: 'Fenêtre', element: { shape: 'window', size: [w.width ?? 1.2, w.height ?? 1.2, 0.12], params: { sill: w.sill ?? 0.9 } }, source: src });
      this.insert(win, { as: sub(`window${i || ''}`), relation: { type: 'ATTACHED_TO', target: checkWall(w.wall), offset: w.offset ?? 0 } });
    });
    if (spec.ceiling) {
      const ceil = createObject('element', { name: 'Plafond', semanticRole: 'ceiling', position: [0, height, 0], element: { shape: 'slab', size: [width + 2 * t, 0.1, depth + 2 * t] }, source: src });
      this.insert(ceil, { parent: gid, as: sub('ceiling') });
    }
    if (spec.light !== false) {
      const light = createObject('light', { name: 'Plafonnier', position: [0, height - 0.3, 0], source: src });
      if (light.type === 'light') light.light = { ...light.light, intensity: Math.round(width * depth * 1.2 * 10) / 10 };
      this.insert(light, { parent: gid, as: sub('light') });
    }
    return gid;
  }

  /** Rue : chaussée, deux trottoirs, volumes de bâtiments, lampadaires. Axe de la rue = Z local. */
  street(spec: StreetSpec) {
    const L = spec.length;
    if (!Number.isFinite(L) || L < 4 || L > 2000) throw new SceneError('CREATE_STREET : length invalide (4 à 2000 m).');
    const lanes = Math.max(1, Math.min(6, Math.round(spec.lanes ?? 2)));
    const rw = spec.roadWidth ?? lanes * 3.5;
    const sw = spec.sidewalkWidth ?? 2.5;
    const src = this.source;
    const sub = (key: string) => (spec.as ? `${spec.as}.${key}` : undefined);
    const group = createObject('group', { name: spec.name ?? 'Rue', position: spec.position ?? [0, 0, 0], rotation: [0, spec.rotation ?? 0, 0], source: src, tags: ['rue', 'extérieur'] });
    const gid = this.insert(group, { as: spec.as });
    this.insert(createObject('element', { name: 'Chaussée', element: { shape: 'road', size: [rw, 0.05, L], params: { lanes } }, source: src }), { parent: gid, as: sub('road') });
    const sides: ['left' | 'right', number][] = [['left', -1], ['right', 1]];
    for (const [side, s] of sides) {
      const swId = this.insert(
        createObject('element', { name: `Trottoir ${side === 'left' ? 'gauche' : 'droit'}`, position: [s * (rw / 2 + sw / 2), 0, 0], element: { shape: 'sidewalk', size: [sw, 0.15, L] }, source: src }),
        { parent: gid, as: sub(`sidewalk_${side}`) },
      );
      const spacing = spec.streetLightSpacing ?? 15;
      if (spacing > 0) {
        const n = Math.max(1, Math.floor(L / spacing));
        for (let i = 0; i < n; i++) {
          // Lampadaire au bord de la chaussée, crosse tournée vers la route.
          const lamp = createObject('element', { name: 'Lampadaire', element: { shape: 'streetlight' }, source: src });
          this.insert(lamp, { parent: gid, relation: { type: 'ALONG', target: swId, t: (i + 0.5) / n, offset: -s * (sw / 2 - 0.4), yaw: s > 0 ? -90 : 90 } });
        }
      }
      if (spec.buildings !== false) {
        // Volumes réguliers et déterministes (pas d'aléatoire) : largeurs et hauteurs alternées.
        const widths = [12, 9, 14, 10, 11];
        const floors = [4, 6, 3, 5, 7];
        let z = -L / 2;
        let k = side === 'left' ? 0 : 2;
        while (z < L / 2 - 4) {
          const w = Math.min(widths[k % widths.length], L / 2 - z);
          const f = floors[k % floors.length];
          const d = 12;
          const b = createObject('element', {
            name: 'Bâtiment',
            position: [s * (rw / 2 + sw + d / 2), 0, z + w / 2],
            rotation: [0, s > 0 ? -90 : 90, 0],
            element: { shape: 'building', size: [w, f * 3, d], params: { floors: f } },
            source: src,
          });
          this.insert(b, { parent: gid });
          z += w;
          k++;
        }
      }
    }
    return gid;
  }

  prefab(cmd: Extract<WorldCommand, { action: 'INSTANTIATE_PREFAB' }>) {
    const def = this.ctx.resolvePrefab?.(cmd.prefabId);
    if (!def) throw new SceneError(`Prefab inconnu : « ${cmd.prefabId} ».`);
    if (this.depth > 4) throw new SceneError('Prefabs imbriqués trop profondément.');
    const base = this.base(cmd);
    const group = createObject('group', { ...base, name: base.name ?? def.name, source: { kind: 'prefab', ref: def.id }, tags: base.tags ?? def.tags });
    const gid = this.insert(group, { ...cmd, relation: undefined });
    if (def.kind === 'commands') {
      const inner = new Session(this.doc, this.ctx, { kind: 'prefab', ref: def.id }, this.depth + 1);
      inner.aliases = { prefab: gid };
      for (const [i, c] of def.commands.entries()) {
        try {
          // Les objets sans parent explicite vont dans le groupe du prefab.
          const scoped = 'parent' in c || c.action !== 'ADD_OBJECT' ? c : { ...c, parent: 'prefab' };
          inner.run(scoped as WorldCommand);
        } catch (e) {
          throw new SceneError(`Prefab « ${def.name} », commande ${i + 1} : ${(e as Error).message}`);
        }
      }
      this.doc = inner.doc;
      this.ops.push(...inner.ops);
      this.notes.push(...inner.notes);
    } else {
      const ops: Operation[] = [];
      for (const a of def.assets) if (!this.doc.assets[a.id]) ops.push({ type: 'asset', id: a.id, record: structuredClone(a) });
      const idMap = new Map(def.objects.map((o) => [o.id, createId()]));
      const copies = def.objects.map((o) => {
        const c = structuredClone(o);
        return { ...c, id: idMap.get(o.id)!, parentId: o.parentId === null ? gid : idMap.get(o.parentId)!, children: c.children.map((x) => idMap.get(x)!), locked: false, source: { kind: 'prefab' as const, ref: def.id } };
      });
      // Chaque racine de l'instantané est insérée dans le groupe avec son sous-arbre.
      for (const r of copies.filter((c) => c.parentId === gid)) {
        ops.push({ type: 'insert', objects: [r, ...copies.filter((c) => isDescendant(copies, c, r.id))], parentId: gid, index: -1 });
      }
      this.apply({ label: '', ops });
    }
    this.place(gid, cmd.relation);
    return gid;
  }
}

function isDescendant(all: SceneObject[], obj: SceneObject, ancestor: ObjectId): boolean {
  let p = obj.parentId;
  const byId = new Map(all.map((o) => [o.id, o]));
  while (p) {
    if (p === ancestor) return true;
    p = byId.get(p)?.parentId ?? null;
  }
  return false;
}

function pickNumbers<T extends object>(o: T | undefined, keys: string[]) {
  const out: Record<string, number> = {};
  for (const k of keys) {
    const v = (o as Record<string, unknown> | undefined)?.[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

function validMaterial(m: MaterialOverride | null | undefined): MaterialOverride | null {
  if (m === null || m === undefined) return null;
  const out: MaterialOverride = {};
  if (m.color !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(m.color)) throw new SceneError(`Couleur invalide : ${m.color} (format #rrggbb).`);
    out.color = m.color.toLowerCase();
  }
  for (const k of ['roughness', 'metalness', 'opacity'] as const) {
    if (m[k] !== undefined) {
      if (!Number.isFinite(m[k])) throw new SceneError(`${k} invalide.`);
      out[k] = Math.min(1, Math.max(0, m[k]!));
    }
  }
  return out;
}

/**
 * Exécute un script de commandes. Tout ou rien : à la première erreur, rien n'est appliqué
 * et l'index de la commande fautive est renvoyé.
 */
export function runWorldCommands(
  doc: SceneDocument,
  commands: WorldCommand[],
  ctx: WorldContext,
  opts: { label?: string; source?: ObjectSource } = {},
): RunResult | RunError {
  if (!Array.isArray(commands)) return { ok: false, index: -1, error: 'Le script doit être une liste de commandes.' };
  const session = new Session(doc, ctx, opts.source ?? { kind: 'composer' });
  for (const [index, cmd] of commands.entries()) {
    try {
      session.run(cmd);
    } catch (e) {
      if (e instanceof SceneError) return { ok: false, index, error: e.message };
      throw e;
    }
  }
  const label = opts.label ?? (commands.length === 1 ? describe(commands[0]) : `${commands.length} commandes`);
  return { ok: true, tx: { label, ops: session.ops }, doc: session.doc, aliases: session.aliases, created: session.created, notes: session.notes };
}

function describe(c: WorldCommand): string {
  switch (c.action) {
    case 'CREATE_ROOM':
      return `Créer une pièce ${c.width} × ${c.depth} m`;
    case 'CREATE_STREET':
      return `Créer une rue de ${c.length} m`;
    default:
      return c.action;
  }
}

/** Parse un texte JSON (objet unique ou liste) en commandes. */
export function parseWorldCommands(text: string): WorldCommand[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new SceneError(`JSON invalide : ${(e as Error).message}`);
  }
  const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { commands?: unknown }).commands) ? (data as { commands: unknown[] }).commands : [data];
  return list as WorldCommand[];
}

/** Instantané d'un sous-arbre pour « Enregistrer comme prefab » : le pivot du groupe devient l'origine. */
export function snapshotPrefab(doc: SceneDocument, rootId: ObjectId, meta: { id: string; name: string; category?: string; tags?: string[] }): PrefabDefinition {
  const root = doc.objects[rootId];
  if (!root) throw new SceneError('Objet introuvable.');
  const all = getSubtreeIds(doc, rootId).map((id) => structuredClone(doc.objects[id]));
  let objects: SceneObject[];
  if (root.type === 'group') {
    // Contenu du groupe : les transforms des enfants sont déjà relatifs au groupe.
    objects = all.slice(1).map((o) => (o.parentId === rootId ? { ...o, parentId: null } : o));
  } else {
    // Objet seul : il devient le contenu, recentré horizontalement sur l'origine du prefab.
    const [r, ...rest] = all;
    const p = r.transform.position;
    objects = [{ ...r, parentId: null, transform: { ...r.transform, position: [0, p[1], 0] } }, ...rest];
  }
  objects = objects.map((o) => ({ ...o, locked: false }));
  const assetIds = new Set(objects.flatMap((o) => (o.type === 'model' ? [o.model.assetId] : [])));
  return {
    id: meta.id,
    name: meta.name,
    category: meta.category ?? 'prefabs.user',
    tags: meta.tags ?? [],
    kind: 'snapshot',
    objects,
    assets: [...assetIds].map((id) => doc.assets[id]).filter(Boolean),
  };
}
