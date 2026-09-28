/**
 * World Composer : exécute un ScenePlan validé.
 *
 *   ScenePlan → commandes structurées (worldCommands) → objets de scène → validation → corrections sûres
 *
 * Le composer ne connaît aucune scène particulière : il traduit des zones (pièces, rues), des
 * dispositions (le long d'un mur, en rangées, dans un coin, le long d'une rue) et des relations
 * (ON, NEXT_TO, AGAINST, FACING, INSIDE, CENTERED_IN, ALONG, ATTACHED_TO) en commandes, à partir
 * des dimensions réelles des objets. Tout le résultat est constitué d'objets ordinaires, éditables.
 */
import { boxSize, normalizeModel } from './bounds.ts';
import { SHAPES, elementLocalBox } from './elements.ts';
import { applyTransaction, type Operation, type Transaction } from './operations.ts';
import { dropToSurface } from './placement.ts';
import { compose, decompose, localTransformFor, worldTransform } from './math.ts';
import { getSubtreeIds } from './scene.ts';
import { PLAN_CATALOG, type PlanCamera, type PlanObject, type PlanZone, type RoomZone, type ScenePlan, type StreetZone, type WallSide } from './scenePlan.ts';
import { objectSpatial, type Spatial } from './spatial.ts';
import type { ObjectId, ObjectSource, SceneDocument, Vec3 } from './types.ts';
import { validatePlacement, validateScene, type SceneIssue } from './validation.ts';
import { runWorldCommands, unitOf, type RelationInput, type WorldCommand, type WorldContext } from './worldCommands.ts';

export interface ComposeReport {
  title: string;
  zones: number;
  objects: number;
  /** Commandes générées (inspectables, rejouables). */
  commands: WorldCommand[];
  /** Ce que le composer a dû adapter (plan impossible à la lettre). */
  adjustments: string[];
  /** Corrections automatiques appliquées après validation. */
  corrections: string[];
  /** Problèmes restants après correction (jamais masqués). */
  remaining: SceneIssue[];
  status: 'OK' | 'WARNING' | 'ERROR';
}

export type ComposeResult = { ok: true; tx: Transaction; doc: SceneDocument; report: ComposeReport; rootIds: ObjectId[] } | { ok: false; error: string; report?: Partial<ComposeReport> };

const WALL_THICKNESS = 0.2;
/** Nombre maximal de lumières ponctuelles créées par zone (coût du rendu temps réel). */
const MAX_LIGHTS_PER_ZONE = 12;
const r2 = (v: number) => Math.round(v * 100) / 100;
const yawOfWall: Record<WallSide, number> = { north: 0, south: 180, east: -90, west: 90 };
/** Direction (monde, XZ) vers laquelle regarde l'avant d'un objet tourné de `yaw` degrés. */
const forward = (yaw: number): [number, number] => [Math.sin((yaw * Math.PI) / 180), Math.cos((yaw * Math.PI) / 180)];
const FACING_YAW: Record<WallSide, number> = { north: 180, south: 0, east: 90, west: -90 };

interface ZoneFrame {
  zone: PlanZone;
  /** Centre au sol (monde). */
  center: [number, number];
}

/** Empreinte (largeur X, hauteur, profondeur Z) d'un type du catalogue, avant rotation. */
function footprintOf(type: string, ctx: WorldContext, sizeOverride?: Vec3): Vec3 {
  const impl = PLAN_CATALOG[type].impl;
  if (impl.kind === 'element') return boxSize(elementLocalBox(sizeOverride ?? impl.size ?? SHAPES[impl.shape].defaultSize));
  const record = ctx.resolveAsset?.(impl.assetId);
  const native = record && ctx.nativeModelBox(record.id);
  if (!record || !native) return impl.fallback.size;
  const d = ctx.assetDefaults?.(record.id);
  const nm = normalizeModel(native, { pivot: d?.model?.pivot ?? 'bottom-center', orientation: d?.model?.orientation ?? [0, 0, 0], unitScale: d?.model?.unitScale ?? 1 });
  const s = d?.scale ?? 1;
  return boxSize(nm.localBox).map((v) => v * s) as Vec3;
}

/** Commande d'ajout pour un type du catalogue (asset si disponible, sinon volume de remplacement signalé). */
function addCommand(type: string, extra: Record<string, unknown>, ctx: WorldContext, adjustments: string[], color?: string): WorldCommand {
  const entry = PLAN_CATALOG[type];
  const impl = entry.impl;
  if (impl.kind === 'asset') {
    if (ctx.resolveAsset?.(impl.assetId)) return { action: 'ADD_OBJECT', assetId: impl.assetId, name: entry.label, ...extra } as WorldCommand;
    const msg = `Modèle « ${impl.assetId} » indisponible : « ${entry.label} » remplacé par un volume de mêmes dimensions.`;
    if (!adjustments.includes(msg)) adjustments.push(msg);
    return { action: 'ADD_OBJECT', element: impl.fallback.shape, size: impl.fallback.size, name: entry.label, role: 'prop', ...extra } as WorldCommand;
  }
  const material = color ?? impl.color;
  return {
    action: 'ADD_OBJECT',
    element: impl.shape,
    name: entry.label,
    ...(impl.size ? { size: impl.size } : {}),
    ...(material ? { material: { color: material } } : {}),
    ...(impl.role ? { role: impl.role } : {}),
    ...extra,
  } as WorldCommand;
}

/** Ordre d'exécution : un objet après les objets qu'il vise (les cycles sont cassés et signalés). */
function orderObjects(objects: PlanObject[], adjustments: string[]): PlanObject[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const out: PlanObject[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (o: PlanObject) => {
    if (state.get(o.id) === 'done') return;
    if (state.get(o.id) === 'visiting') {
      adjustments.push(`Relations circulaires autour de « ${o.id} » : ordre forcé.`);
      return;
    }
    state.set(o.id, 'visiting');
    for (const r of o.relationships ?? []) {
      const dep = byId.get(r.target.split('#')[0].split('.')[0]);
      if (dep && dep !== o) visit(dep);
    }
    state.set(o.id, 'done');
    out.push(o);
  };
  objects.forEach(visit);
  return out;
}

/** Positions (le long du mur, repère du mur) disponibles pour `count` objets de largeur `w`. */
function wallSlots(room: RoomZone, wall: WallSide, w: number, h: number, gap: number, margin: number, reserve: [number, number] = [0, 0]): number[] {
  const len = wall === 'north' || wall === 'south' ? room.width : room.depth;
  // Les murs nord/sud débordent de l'épaisseur des murs latéraux : l'intérieur utile est `len`.
  const blocked: [number, number][] = [];
  for (const o of room.openings ?? []) {
    if (o.wall !== wall) continue;
    const ow = o.width ?? (o.kind === 'door' ? 0.9 : 1.2);
    const x = openingOffset(room, o.wall, o.position ?? 0, ow);
    // Porte : dégagement de passage ; fenêtre : bloquante seulement si l'objet monte plus haut que l'allège.
    if (o.kind === 'door') blocked.push([x - ow / 2 - 0.6, x + ow / 2 + 0.6]);
    else if (h > (o.sill ?? 0.9)) blocked.push([x - ow / 2 - 0.05, x + ow / 2 + 0.05]);
  }
  const slots: number[] = [];
  const pitch = w + gap;
  for (let x = -len / 2 + margin + reserve[0] + w / 2; x <= len / 2 - margin - reserve[1] - w / 2 + 1e-6; x += pitch) {
    if (!blocked.some(([a, b]) => x + w / 2 > a && x - w / 2 < b)) slots.push(r2(x));
  }
  return slots;
}

/** Décalage le long du mur (repère du mur) d'une ouverture placée en position -1…1. */
function openingOffset(room: RoomZone, wall: WallSide, position: number, width: number): number {
  const len = wall === 'north' || wall === 'south' ? room.width : room.depth;
  return r2(WALL_SIGN[wall] * position * Math.max(0, len / 2 - width / 2 - 0.3));
}

/**
 * Convention du plan : le long d'un mur nord/sud, négatif = côté ouest, positif = côté est ;
 * le long d'un mur est/ouest, négatif = côté nord, positif = côté sud. Le repère local de chaque
 * mur (X) est orienté différemment : ce signe fait la conversion.
 */
const WALL_SIGN: Record<WallSide, number> = { north: 1, south: -1, east: 1, west: -1 };
/** Mur voisin à chaque extrémité (X local négatif, X local positif) d'un mur. */
const WALL_ENDS: Record<WallSide, [WallSide, WallSide]> = { north: ['west', 'east'], south: ['east', 'west'], east: ['north', 'south'], west: ['south', 'north'] };

/** Choisit `n` éléments répartis régulièrement dans une liste. */
function spread<T>(list: T[], n: number): T[] {
  if (n >= list.length) return list;
  if (n === 1) return [list[Math.floor(list.length / 2)]];
  return Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]);
}

/**
 * Traduit un plan validé en commandes. Pure et déterministe : même plan → mêmes commandes.
 */
export function planToCommands(plan: ScenePlan, ctx: WorldContext): { commands: WorldCommand[]; adjustments: string[]; frames: ZoneFrame[]; aliasZone: Map<string, string> } {
  const commands: WorldCommand[] = [];
  const adjustments: string[] = [];
  const aliasZone = new Map<string, string>();
  const env = plan.environment ?? {};

  // 1. Environnement (lumière globale)
  const night = env.timeOfDay === 'night', evening = env.timeOfDay === 'evening';
  const lightFactor = env.light === 'dim' ? 0.55 : env.light === 'bright' ? 1.35 : 1;
  commands.push({
    action: 'SET_ENVIRONMENT',
    background: night ? '#0d1017' : evening ? '#2a2230' : '#1c1e23',
    sunIntensity: r2((night ? 0.12 : evening ? 0.7 : plan.sceneType === 'interior' ? 1.0 : 1.6) * (plan.sceneType === 'interior' ? lightFactor : 1)),
    ambientIntensity: r2((night ? 0.12 : 0.45) * lightFactor),
    environmentIntensity: r2((night ? 0.15 : evening ? 0.4 : 0.6) * lightFactor),
  });

  // 2. Zones, disposées côte à côte si le plan ne donne pas de position.
  const frames: ZoneFrame[] = [];
  let cursor = 0;
  for (const z of plan.zones) {
    const extent = z.kind === 'room' ? z.width + 2 * WALL_THICKNESS : (z.lanes ?? 2) * 3.5 + 2 * (z.sidewalkWidth ?? 3) + 26;
    const center: [number, number] = z.position ?? [cursor + extent / 2, 0];
    if (!z.position) cursor += extent + 6;
    frames.push({ zone: z, center });
    if (z.kind === 'room') {
      const worn = z.worn;
      commands.push({
        action: 'CREATE_ROOM',
        as: z.id,
        name: z.name ?? 'Pièce',
        width: z.width,
        depth: z.depth,
        height: z.height,
        position: [center[0], 0, center[1]],
        ceiling: z.ceiling,
        light: false,
        wallColor: z.wallColor ?? (worn ? '#b5a88f' : undefined),
        floorColor: z.floorColor ?? (worn ? '#7b7263' : undefined),
        doors: (z.openings ?? []).filter((o) => o.kind === 'door').map((o) => ({ wall: o.wall, offset: openingOffset(z, o.wall, o.position ?? 0, o.width ?? 0.9), width: o.width, height: o.height })),
        windows: (z.openings ?? []).filter((o) => o.kind === 'window').map((o) => ({ wall: o.wall, offset: openingOffset(z, o.wall, o.position ?? 0, o.width ?? 1.2), width: o.width, height: o.height, sill: o.sill })),
      });
      if (worn) commands.push({ action: 'CHANGE_MATERIAL', target: [`${z.id}.wall_north`, `${z.id}.wall_south`, `${z.id}.wall_east`, `${z.id}.wall_west`], material: { roughness: 0.97 } });
    } else {
      commands.push({
        action: 'CREATE_STREET',
        as: z.id,
        name: z.name ?? 'Rue',
        length: z.length,
        lanes: z.lanes,
        sidewalkWidth: z.sidewalkWidth,
        buildings: (z.buildingsPerSide ?? 0) > 0,
        buildingsPerSide: z.buildingsPerSide,
        floors: z.buildingFloors,
        streetLightSpacing: z.streetLightSpacing,
        position: [center[0], 0, center[1]],
        rotation: z.rotation,
      });
    }
  }
  const frameOf = (id: string) => frames.find((f) => f.zone.id === id)!;

  // 3. Objets
  const instanceAlias = (id: string, k: number) => `${id}__${k}`;
  const counts = new Map(plan.objects.map((o) => [o.id, o.count ?? 1]));
  /** Référence de cible du plan → alias de commande. */
  const resolveTarget = (target: string): string => {
    const [base, part] = target.split('.');
    const [id, k] = base.split('#');
    if (counts.has(id)) return instanceAlias(id, Math.min(Number(k) || 1, counts.get(id)!));
    if (!part) return id; // la zone elle-même
    const p = part.replace(/-/g, '_');
    const alias: Record<string, string> = { road: 'road', sidewalk_left: 'sidewalk_left', sidewalk_right: 'sidewalk_right', floor: 'floor', door: 'door', entrance: 'door', window: 'window' };
    if (/^wall_(north|south|east|west)$/.test(p)) return `${id}.${p}`;
    if (/^(north|south|east|west)_wall$/.test(p)) return `${id}.wall_${p.split('_')[0]}`;
    return `${id}.${alias[p] ?? p}`;
  };

  /** Relation du plan → relation de commande (décalage le long d'un mur converti dans le repère du mur). */
  const relationInput = (r: NonNullable<PlanObject['relationships']>[number]): RelationInput => {
    const target = resolveTarget(r.target);
    const wall = /\.wall_(north|south|east|west)$/.exec(target)?.[1] as WallSide | undefined;
    const offset = r.offset !== undefined ? (wall ? r.offset * WALL_SIGN[wall] : r.offset) : undefined;
    return { type: r.type, target, ...(r.side ? { side: r.side } : {}), ...(r.gap !== undefined ? { gap: r.gap } : {}), ...(offset !== undefined ? { offset } : {}) };
  };

  const emitted = new Set<string>();
  for (const o of orderObjects(plan.objects, adjustments)) {
    // Une relation vers un objet pas encore créé (cycle) est abandonnée et signalée.
    const pending = (o.relationships ?? []).filter((r) => {
      const id = r.target.split('#')[0].split('.')[0];
      return counts.has(id) && !emitted.has(id);
    });
    if (pending.length) {
      adjustments.push(`« ${o.name ?? o.id} » : relation vers un objet pas encore placé (${pending.map((r) => r.target).join(', ')}) ignorée.`);
      o.relationships = (o.relationships ?? []).filter((r) => !pending.includes(r));
    }
    emitted.add(o.id);
    const frame = frameOf(o.zone);
    const zone = frame.zone;
    const entry = PLAN_CATALOG[o.type];
    const count = o.count ?? 1;
    const label = o.name ?? entry.label;
    const fp = footprintOf(o.type, ctx);
    const units: string[] = [];
    // Positions de chaque instance selon la disposition.
    const placements: (RelationInput | null)[] = [];
    const layout = o.layout;
    if (layout?.kind === 'along-wall' && zone.kind === 'room') {
      const gap = layout.gap ?? (o.with?.some((c) => c.relation !== 'ON' && (c.side === 'left' || c.side === 'right')) ? 0.8 : 0.25);
      const all: { wall: WallSide; x: number }[] = [];
      // Aux angles où deux rangées se rencontrent, la seconde laisse la place de la première (objet + chaise).
      const rowDepth = fp[2] + (o.with?.some((c) => c.relation !== 'ON') ? 0.9 : 0.1);
      layout.walls.forEach((wall, wi) => {
        const [a, b] = WALL_ENDS[wall];
        const earlier = layout.walls.slice(0, wi);
        const reserve: [number, number] = [earlier.includes(a) ? rowDepth : 0, earlier.includes(b) ? rowDepth : 0];
        for (const x of wallSlots(zone, wall, fp[0], fp[1], gap, layout.margin ?? 0.3, reserve)) all.push({ wall, x });
      });
      // Répartition entre les murs proportionnelle à la place disponible sur chacun.
      const perWall = new Map(layout.walls.map((w) => [w, all.filter((s) => s.wall === w)]));
      const capacity = all.length;
      const want = Math.min(count, capacity);
      const quota = new Map(layout.walls.map((w) => [w, Math.floor((want * perWall.get(w)!.length) / Math.max(1, capacity))]));
      let left = want - [...quota.values()].reduce((a, b) => a + b, 0);
      for (const w of [...layout.walls].sort((a, b) => perWall.get(b)!.length - quota.get(b)! - (perWall.get(a)!.length - quota.get(a)!))) {
        if (left <= 0) break;
        if (quota.get(w)! < perWall.get(w)!.length) {
          quota.set(w, quota.get(w)! + 1);
          left--;
        }
      }
      const chosen: { wall: WallSide; x: number }[] = layout.walls.flatMap((w) => spread(perWall.get(w)!, quota.get(w)!));
      if (chosen.length < count) adjustments.push(`${count} × « ${label} » demandés le long du mur ${layout.walls.join(' / ')}, ${chosen.length} tiennent (dimensions réelles, passages de porte dégagés).`);
      for (const s of chosen) placements.push({ type: 'AGAINST', target: `${zone.id}.wall_${s.wall}`, offset: s.x, gap: 0.02 });
    } else if (layout?.kind === 'grid' && zone.kind === 'room') {
      const facing = layout.facing ?? 'north';
      const yaw = FACING_YAW[facing];
      const rotated = facing === 'east' || facing === 'west';
      const [fx, fz] = rotated ? [fp[2], fp[0]] : [fp[0], fp[2]];
      // Chaque cellule réserve la place de l'objet + de ses objets associés devant lui (chaise…).
      const extraFront = o.with?.some((c) => c.relation !== 'ON') ? 0.9 : 0.3;
      const cellX = rotated ? fx + extraFront : fx + 0.5, cellZ = rotated ? fz + 0.5 : fz + extraFront;
      const innerW = zone.width - 1.2, innerD = zone.depth - 1.2;
      let cols = layout.columns, rows = layout.rows;
      while (cols > 1 && cols * cellX > innerW) cols--;
      while (rows > 1 && rows * cellZ > innerD) rows--;
      if (cols !== layout.columns || rows !== layout.rows) adjustments.push(`Grille ${layout.rows} × ${layout.columns} de « ${label} » trop grande pour la zone : ${rows} × ${cols}.`);
      const px = Math.min(cellX + 0.4, innerW / cols), pz = Math.min(cellZ + 0.4, innerD / rows);
      const cells: [number, number][] = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([r2((c - (cols - 1) / 2) * px), r2((r - (rows - 1) / 2) * pz)]);
      if (cells.length < count) adjustments.push(`${count} × « ${label} » demandés en rangées, ${cells.length} places.`);
      for (const [x, z] of cells.slice(0, count)) placements.push({ type: 'INSIDE', target: zone.id, x, z, yaw });
    } else if (layout?.kind === 'corner' && zone.kind === 'room') {
      const [ns, ew] = layout.corner.split('-') as [string, string];
      for (let k = 0; k < count; k++) {
        const x = (ew === 'east' ? 1 : -1) * (zone.width / 2 - fp[0] / 2 - 0.15 - k * (fp[0] + 0.2));
        const z = (ns === 'south' ? 1 : -1) * (zone.depth / 2 - fp[2] / 2 - 0.15);
        // Dans un coin : l'avant de l'objet regarde vers l'intérieur de la pièce.
        placements.push({ type: 'INSIDE', target: zone.id, x: r2(x), z: r2(z), yaw: ns === 'south' ? 180 : 0 });
      }
    } else if (layout?.kind === 'center') {
      for (let k = 0; k < count; k++) placements.push(k === 0 ? { type: 'CENTERED_IN', target: zone.id } : null);
    } else if (layout?.kind === 'along-street' && zone.kind === 'street') {
      const sides: ('left' | 'right')[] = layout.side === 'both' || !layout.side ? ['left', 'right'] : [layout.side];
      const lanes = zone.lanes ?? 2;
      const laneW = 3.5;
      for (let k = 0; k < count; k++) {
        const side = sides[k % sides.length];
        const idx = Math.floor(k / sides.length);
        const perSide = Math.ceil(count / sides.length);
        // Répartition décalée entre les côtés (pas d'alignement mécanique en vis-à-vis).
        const t = r2(Math.min(0.95, Math.max(0.05, (idx + (side === 'left' ? 0.35 : 0.65)) / perSide)));
        if (layout.on === 'road') {
          // Circulation à droite : voie de droite dans le sens de la marche, sens inverse sur l'autre côté.
          const laneOffset = lanes > 1 ? laneW / 2 : 0;
          placements.push({ type: 'ALONG', target: `${zone.id}.road`, t, offset: laneOffset, reverse: side === 'left' });
        } else {
          const sw = zone.sidewalkWidth ?? 3;
          // Arbres et plantes côté chaussée (dans l'alignement des lampadaires), mobilier côté façades.
          const towardRoad = o.type === 'tree' || o.type === 'plant' || o.type === 'streetlight';
          const inset = Math.min(sw / 2 - 0.2, towardRoad ? Math.max(0, sw / 2 - fp[0] / 2 - 0.15) : sw / 2 - fp[2] / 2 - 0.3);
          const offset = (side === 'left' ? 1 : -1) * (towardRoad ? inset : -inset);
          placements.push({ type: 'ALONG', target: `${zone.id}.sidewalk_${side}`, t, offset: r2(offset) });
        }
      }
    }
    const firstRel = o.relationships?.[0];
    // Une disposition qui ne peut pas tout accueillir limite le nombre d'objets (déjà signalé) :
    // on ne crée pas d'objets en trop entassés ailleurs.
    const placedCount = layout && ['along-wall', 'grid'].includes(layout.kind) && placements.length < count ? placements.length : count;
    for (let k = 1; k <= placedCount; k++) {
      const alias = instanceAlias(o.id, k);
      aliasZone.set(alias, zone.id);
      let relation: RelationInput | undefined = placements[k - 1] ?? undefined;
      if (!relation && firstRel) {
        relation = relationInput(firstRel);
        // Plusieurs instances « à côté de » la même cible : côtés automatiques.
        if (count > 1 && relation.type === 'NEXT_TO' && !firstRel.side) relation.side = 'auto';
      }
      if (!relation) {
        relation = zone.kind === 'room' ? { type: 'INSIDE', target: zone.id } : { type: 'ALONG', target: `${zone.id}.sidewalk_right`, t: r2(k / (count + 1)) };
        if (k === 1) adjustments.push(`« ${label} » sans position ni relation : placé dans « ${zone.name ?? zone.id} », puis décalé si nécessaire.`);
      }
      // Avec des objets associés, le nom du plan va au groupe (« Poste 3 ») et l'objet garde son type (« Bureau informatique 3 »).
      const own = o.with?.length ? entry.label : label;
      commands.push(addCommand(o.type, { as: alias, name: count > 1 ? `${own} ${k}` : own, position: [frame.center[0], 0, frame.center[1]], relation }, ctx, adjustments, o.color));
      if (o.color && entry.impl.kind === 'asset') commands.push({ action: 'CHANGE_MATERIAL', target: alias, material: { color: o.color } });
      // Relations supplémentaires (ex. FACING après AGAINST), appliquées dans l'ordre.
      for (const r of (placements[k - 1] ? o.relationships ?? [] : (o.relationships ?? []).slice(1))) {
        commands.push({ action: 'PLACE', target: alias, relation: relationInput(r) });
      }
      // Objets associés à chaque instance (ordinateur SUR le bureau, chaise DEVANT…).
      const members = [alias];
      (o.with ?? []).forEach((c, j) => {
        const n = c.count ?? 1;
        for (let m = 1; m <= n; m++) {
          const ca = `${alias}.c${j + 1}_${m}`;
          const spreadX = n > 1 ? r2((m - (n + 1) / 2) * (fp[0] / n)) : undefined;
          let rel: RelationInput;
          if (c.relation === 'ON') {
            // Position sur le plateau, dans le repère de l'objet porteur (fond = côté mur, avant = côté utilisateur).
            const cf = footprintOf(c.type, ctx);
            const dz = Math.max(0, fp[2] / 2 - cf[2] / 2 - 0.03), dx = Math.max(0, fp[0] / 2 - cf[0] / 2 - 0.05);
            const z = c.place === 'back' ? -dz : c.place === 'front' ? dz : 0;
            const x = spreadX ?? (c.place === 'left' ? -dx : c.place === 'right' ? dx : 0);
            rel = { type: 'ON', target: alias, x: r2(x), z: r2(z) };
          }
          else if (c.relation === 'AGAINST') rel = { type: 'AGAINST', target: alias };
          else rel = { type: 'NEXT_TO', target: alias, side: c.side ?? 'front', gap: c.gap ?? (c.relation === 'FACING' ? 0.05 : 0.15), face: c.relation === 'FACING' || c.side === 'front' || !c.side ? 'target' : 'same', ...(spreadX !== undefined ? { offset: spreadX } : {}) };
          commands.push(addCommand(c.type, { as: ca, name: c.name ?? PLAN_CATALOG[c.type].label, position: [frame.center[0], 0, frame.center[1]], relation: rel }, ctx, adjustments, c.color));
          aliasZone.set(ca, zone.id);
          members.push(ca);
        }
      });
      if (members.length > 1) {
        commands.push({ action: 'GROUP_OBJECTS', targets: members, name: count > 1 ? `${label} ${k}` : label, as: `${alias}__unit`, metadata: { unit: true, planId: o.id } });
        units.push(`${alias}__unit`);
        aliasZone.set(`${alias}__unit`, zone.id);
      } else units.push(alias);
    }
    // Hiérarchie sémantique : Zone > Ensemble > Unité > objets.
    if (units.length > 1) commands.push({ action: 'GROUP_OBJECTS', targets: units, name: `${o.name ?? entry.label} (${units.length})`, as: `${o.id}__set`, metadata: { planId: o.id }, parent: zone.id });
    else if (units.length === 1) commands.push({ action: 'REPARENT', target: units[0], parent: zone.id });
  }

  // 4. Lumières
  const lightColor = env.mood === 'warm' ? '#ffcf96' : env.mood === 'cool' ? '#dbe6ff' : '#fff1dc';
  for (const f of frames) {
    const z = f.zone;
    const planned = (plan.lighting ?? []).filter((l) => l.zone === z.id);
    if (z.kind === 'room') {
      const ceiling = planned.find((l) => l.kind === 'ceiling') ?? { kind: 'ceiling' as const, zone: z.id, count: Math.min(MAX_LIGHTS_PER_ZONE, Math.max(1, Math.round((z.width * z.depth) / 16))), intensity: 1 };
      // Chaque lumière ponctuelle coûte cher au rendu temps réel : 12 au plus par pièce.
      const asked = ceiling.count ?? 1;
      const n = Math.min(asked, MAX_LIGHTS_PER_ZONE);
      if (asked > n) adjustments.push(`Éclairage de « ${z.name ?? z.id} » limité à ${n} sources (${asked} demandées), intensité répartie.`);
      const cols = Math.max(1, Math.round(Math.sqrt((n * z.width) / z.depth)));
      const rows = Math.max(1, Math.ceil(n / cols));
      const each = ((z.width * z.depth * 1.6) / n) * (ceiling.intensity ?? 1) * lightFactor;
      let placed = 0;
      for (let r = 0; r < rows && placed < n; r++)
        for (let c = 0; c < cols && placed < n; c++, placed++) {
          commands.push({
            action: 'ADD_OBJECT',
            light: { color: ceiling.color ?? lightColor, intensity: r2(each), distance: 0 },
            name: n > 1 ? `Plafonnier ${placed + 1}` : 'Plafonnier',
            parent: z.id,
            position: [r2(((c + 0.5) / cols - 0.5) * z.width), r2(z.height - 0.25), r2(((r + 0.5) / rows - 0.5) * z.depth)],
          });
        }
    } else if (night || evening || planned.some((l) => l.kind === 'street')) {
      // Rue le soir / la nuit : une vraie source de lumière sous chaque tête de lampadaire.
      const spacing = z.streetLightSpacing ?? 15;
      if (spacing > 0) {
        const n = Math.min(Math.max(1, Math.floor(z.length / spacing)), MAX_LIGHTS_PER_ZONE / 2);
        if (Math.floor(z.length / spacing) > n) adjustments.push(`Rue « ${z.name ?? z.id} » : seuls ${n * 2} lampadaires émettent de la lumière (limite de rendu).`);
        const intensity = r2(90 * (planned.find((l) => l.kind === 'street')?.intensity ?? 1));
        for (const side of ['left', 'right'])
          for (let i = 1; i <= n; i++)
            commands.push({ action: 'ADD_OBJECT', light: { color: '#ffd9a0', intensity, distance: 25 }, name: 'Éclairage public', parent: `${z.id}.lamp_${side}_${i}`, position: [0, 5.7, 0.55] });
      }
    }
  }

  // 5. Caméras
  // Toujours une vue d'ensemble par zone (première caméra), plus celles demandées par le plan.
  const cams: PlanCamera[] = [
    ...frames.filter((f) => !(plan.cameras ?? []).some((c) => c.zone === f.zone.id && c.viewpoint === 'overview')).map((f) => ({ zone: f.zone.id, viewpoint: 'overview' as const, name: 'Vue d\u2019ensemble' })),
    ...(plan.cameras?.length ? plan.cameras : frames.map((f) => ({ zone: f.zone.id, viewpoint: f.zone.kind === 'room' ? ('entrance' as const) : ('street-level' as const) }))),
  ].sort((a, b) => (a.viewpoint === 'overview' ? 0 : 1) - (b.viewpoint === 'overview' ? 0 : 1));
  cams.forEach((c, i) => {
    const f = frameOf(c.zone);
    const cam = cameraFor(f, c.viewpoint);
    if (cam) commands.push({ action: 'ADD_OBJECT', camera: { fov: c.viewpoint === 'overview' && f.zone.kind === 'room' ? 70 : 50 }, name: c.name ?? `Caméra ${i + 1}`, position: cam.position, rotation: cam.rotation, parent: f.zone.id } as WorldCommand);
  });
  return { commands, adjustments, frames, aliasZone };
}

/** Point de vue de caméra (position et rotation LOCALES à la zone). */
function cameraFor(f: ZoneFrame, viewpoint: string): { position: Vec3; rotation: Vec3 } | null {
  const z = f.zone;
  const look = (from: Vec3, to: Vec3): { position: Vec3; rotation: Vec3 } => {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    // Lacet puis tangage (ordre caméra), converti vers l'ordre XYZ des transforms de la scène.
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // R = Ry(yaw) · Rx(pitch), en colonnes (column-major).
    const m = [cy, 0, -sy, 0, sy * sp, cp, cy * sp, 0, sy * cp, -sp, cy * cp, 0, 0, 0, 0, 1];
    const rot = decompose(m).rotation;
    return { position: from.map(r2) as Vec3, rotation: rot.map(r2) as Vec3 };
  };
  if (z.kind === 'room') {
    if (viewpoint === 'entrance') {
      const door = (z.openings ?? []).find((o) => o.kind === 'door') ?? { wall: 'south' as WallSide, position: 0, width: 0.9 };
      const x = openingOffset(z, door.wall, door.position ?? 0, door.width ?? 0.9);
      // Point juste à l'intérieur de la porte, dans le repère de la pièce.
      const [fx, fz] = forward(yawOfWall[door.wall]);
      const along: [number, number] = [Math.cos((yawOfWall[door.wall] * Math.PI) / 180), -Math.sin((yawOfWall[door.wall] * Math.PI) / 180)];
      const half = door.wall === 'north' || door.wall === 'south' ? z.depth / 2 : z.width / 2;
      const px = -fx * (half - 0.7) + along[0] * x, pz = -fz * (half - 0.7) + along[1] * x;
      return look([px, 1.65, pz], [0, 0.9, 0]);
    }
    // Vue d'ensemble : depuis l'angle le plus éloigné de la porte, en hauteur, pour voir toute la pièce.
    const door = (z.openings ?? []).find((o) => o.kind === 'door');
    const doorSide = door ? { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[door.wall] : [0, 1];
    const sx = doorSide[0] !== 0 ? -doorSide[0] : 1, sz = doorSide[1] !== 0 ? -doorSide[1] : 1;
    const corner: Vec3 =
      viewpoint === 'overview' ? [sx * (z.width / 2 - 0.3), z.height - 0.15, sz * (z.depth / 2 - 0.3)] : [-sx * (z.width / 2 - 0.4), Math.min(2.2, z.height - 0.3), -sz * (z.depth / 2 - 0.4)];
    return look(corner, [0, 0.4, 0]);
  }
  const s = z as StreetZone;
  const sideX = ((s.lanes ?? 2) * 3.5) / 2 + (s.sidewalkWidth ?? 3) / 2;
  if (viewpoint === 'overview') return look([0, 7, s.length / 2 + 6], [0, 0, -s.length / 6]);
  // Au niveau de la rue : côté façades du trottoir (hors de l'alignement des arbres et lampadaires).
  const facadeX = sideX + (s.sidewalkWidth ?? 3) / 2 - 0.6;
  return look([facadeX, 1.7, s.length / 2 - 2], [-1, 2.2, -s.length / 4]);
}

/* ------------------------------------------------------------------ Composition + correction */

const MOVABLE_ROLES = new Set(['furniture', 'prop', 'electronics', 'vegetation', 'vehicle', 'barrier', 'character']);

/** Rectangle (monde, XZ) de la zone dans lequel ses objets doivent rester. */
function zoneRect(f: ZoneFrame): Rect {
  const z = f.zone;
  if (z.kind === 'room') return { minX: f.center[0] - z.width / 2, maxX: f.center[0] + z.width / 2, minZ: f.center[1] - z.depth / 2, maxZ: f.center[1] + z.depth / 2 };
  const half = ((z.lanes ?? 2) * 3.5) / 2 + (z.sidewalkWidth ?? 3);
  const rot = ((z.rotation ?? 0) % 180 + 180) % 180;
  const [hx, hz] = Math.abs(rot - 90) < 1 ? [z.length / 2, half] : [half, z.length / 2];
  return { minX: f.center[0] - hx, maxX: f.center[0] + hx, minZ: f.center[1] - hz, maxZ: f.center[1] + hz };
}

const insideRect = (s: Spatial, r: Rect, tol = 0.02) =>
  s.aabb.min[0] >= r.minX - tol && s.aabb.max[0] <= r.maxX + tol && s.aabb.min[2] >= r.minZ - tol && s.aabb.max[2] <= r.maxZ + tol;

/**
 * Compose un monde : plan → commandes → exécution (tout ou rien) → validation → corrections sûres.
 * Le document d'entrée n'est jamais modifié ; le résultat est UNE transaction (un seul undo).
 */
export function composeWorld(doc: SceneDocument, plan: ScenePlan, ctx: WorldContext, source: ObjectSource = { kind: 'composer' }): ComposeResult {
  const { commands, adjustments, frames, aliasZone } = planToCommands(plan, ctx);
  const run = runWorldCommands(doc, commands, ctx, { label: `Générer « ${plan.title} »`, source });
  if (!run.ok) return { ok: false, error: `Composition impossible (commande ${run.index + 1}, ${describeCommand(commands[run.index])}) : ${run.error}`, report: { commands, adjustments } };
  let current = run.doc;
  const ops: Operation[] = [...run.tx.ops];
  const corrections: string[] = [];
  const apply = (extra: Operation[]) => {
    current = applyTransaction(current, { label: '', ops: extra }).doc;
    ops.push(...extra);
  };

  // Zone de chaque objet généré (par unité).
  const zoneOfUnit = new Map<ObjectId, ZoneFrame>();
  for (const [alias, zoneId] of aliasZone) {
    const id = run.aliases[alias];
    if (!id || !current.objects[id]) continue;
    zoneOfUnit.set(unitOf(current, id), frames.find((f) => f.zone.id === zoneId)!);
  }
  const generated = new Set(Object.keys(current.objects).filter((id) => !doc.objects[id]));
  const name = (id: ObjectId) => current.objects[id]?.name ?? id;
  const moveUnit = (unit: ObjectId, dx: number, dz: number): Operation[] => worldMoveOps(current, unit, dx, dz);

  // a. Objets hors de leur zone : ramenés à l'intérieur.
  for (const [unit, f] of zoneOfUnit) {
    const s = objectSpatial(current, unit, ctx);
    if (!s || insideRect(s, zoneRect(f))) continue;
    const r = zoneRect(f);
    const dx = Math.max(0, r.minX - s.aabb.min[0]) - Math.max(0, s.aabb.max[0] - r.maxX);
    const dz = Math.max(0, r.minZ - s.aabb.min[2]) - Math.max(0, s.aabb.max[2] - r.maxZ);
    apply(moveUnit(unit, dx, dz));
    corrections.push(`« ${name(unit)} » dépassait de « ${f.zone.name ?? f.zone.id} » : ramené à l'intérieur (${r2(Math.hypot(dx, dz))} m).`);
  }

  // b + c. Flottants, sous le sol, collisions : corrections sûres.
  const fix = autoCorrect(current, generated, ctx, (unit) => {
    const f = zoneOfUnit.get(unit);
    return f ? zoneRect(f) : null;
  });
  if (fix.ops.length) apply(fix.ops);
  corrections.push(...fix.corrections);

  const final = validateScene(current, ctx);
  const remaining = final.issues.filter((i) => !i.objectId || generated.has(i.objectId));
  const status = remaining.some((i) => i.severity === 'ERROR') ? 'ERROR' : remaining.length ? 'WARNING' : 'OK';
  const rootIds = current.rootIds.filter((id) => !doc.objects[id]);
  return {
    ok: true,
    tx: { label: `Générer « ${plan.title} »`, ops },
    doc: current,
    rootIds,
    report: { title: plan.title, zones: plan.zones.length, objects: generated.size, commands, adjustments, corrections, remaining, status },
  };
}

/** Déplacement horizontal EN MONDE d'un objet, quel que soit l'orientation de ses parents. */
function worldMoveOps(doc: SceneDocument, id: ObjectId, dx: number, dz: number): Operation[] {
  const w = worldTransform(doc, id);
  const local = localTransformFor(doc, doc.objects[id].parentId, compose({ ...w, position: [w.position[0] + dx, w.position[1], w.position[2] + dz] }));
  return [{ type: 'update', id, changes: { transform: local } }];
}


export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

/**
 * Corrections sûres après une génération ou une modification : objets flottants ou sous le sol
 * reposés sur leur support ; collisions résolues en décalant l'unité mobile la plus légère vers la
 * place libre la plus proche (dans sa zone). Seuls les objets de `scope` sont touchés.
 */
export function autoCorrect(doc: SceneDocument, scope: Set<ObjectId>, ctx: WorldContext, rectOf: (unit: ObjectId) => Rect | null = () => null): { ops: Operation[]; doc: SceneDocument; corrections: string[] } {
  let current = doc;
  const ops: Operation[] = [];
  const corrections: string[] = [];
  const apply = (extra: Operation[]) => {
    current = applyTransaction(current, { label: '', ops: extra }).doc;
    ops.push(...extra);
  };
  const generated = scope;
  const name = (id: ObjectId) => current.objects[id]?.name ?? id;
  const moveUnit = (unit: ObjectId, dx: number, dz: number): Operation[] => worldMoveOps(current, unit, dx, dz);
  // Flottants / sous le sol : reposés sur leur support.
  for (const issue of validateScene(current, ctx).issues) {
    if (!issue.objectId || !generated.has(issue.objectId)) continue;
    if (issue.code !== 'floating' && issue.code !== 'under-ground') continue;
    const drop = dropToSurface(current, issue.objectId, ctx);
    if (!drop) continue;
    apply([{ type: 'update', id: issue.objectId, changes: { transform: drop.transform } }]);
    corrections.push(`« ${name(issue.objectId)} » ${issue.code === 'floating' ? 'flottait' : 'passait sous le sol'} : reposé sur sa surface.`);
  }

  // c. Collisions : l'unité mobile la plus légère est décalée vers la place libre la plus proche de sa zone.
  for (let pass = 0; pass < 2; pass++) {
    const issues = validateScene(current, ctx).issues.filter((i) => i.code === 'overlap' && i.objectId && generated.has(i.objectId));
    if (!issues.length) break;
    const handled = new Set<ObjectId>();
    for (const issue of issues) {
      const m = /« (.+?) » (?:chevauche|et) « (.+?) »/.exec(issue.message);
      const a = issue.objectId!;
      const b = Object.keys(current.objects).find((id) => id !== a && current.objects[id].name === m?.[2]);
      const candidates = [a, b].filter((x): x is ObjectId => !!x && MOVABLE_ROLES.has(current.objects[x]?.semanticRole) && generated.has(x)).map((x) => unitOf(current, x));
      const unit = candidates.sort((x, y) => (volume(current, x, ctx) ?? 0) - (volume(current, y, ctx) ?? 0))[0];
      if (!unit || handled.has(unit)) continue;
      handled.add(unit);
      const spot = findFreeSpot(current, unit, ctx, rectOf(unit));
      if (spot) {
        apply(moveUnit(unit, spot[0], spot[1]));
        corrections.push(`« ${name(unit)} » chevauchait un autre objet : décalé de ${r2(Math.hypot(spot[0], spot[1]))} m.`);
      }
    }
  }

  return { ops, doc: current, corrections };
}

function volume(doc: SceneDocument, id: ObjectId, ctx: WorldContext): number | null {
  const s = objectSpatial(doc, id, ctx);
  return s ? s.width * s.height * s.depth : null;
}

/** Plus petit décalage horizontal (spirale, pas de 0,25 m, jusqu'à 3 m) qui rend l'unité valide et dans sa zone. */
function findFreeSpot(doc: SceneDocument, unit: ObjectId, ctx: WorldContext, rect: Rect | null): [number, number] | null {
  const ids = getSubtreeIds(doc, unit);
  for (let ring = 1; ring <= 12; ring++) {
    const r = ring * 0.25;
    const steps = 8 + ring * 2;
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const dx = r2(Math.cos(a) * r), dz = r2(Math.sin(a) * r);
      const probe = applyTransaction(doc, { label: '', ops: worldMoveOps(doc, unit, dx, dz) }).doc;
      const s = objectSpatial(probe, unit, ctx);
      if (rect && s && !insideRect(s, rect)) continue;
      const bad = ids.some((id) => {
        const rep = validatePlacement(probe, id, ctx);
        return rep.issues.some((i) => i.code === 'overlap');
      });
      if (!bad) return [dx, dz];
    }
  }
  return null;
}

function describeCommand(c: WorldCommand | undefined): string {
  if (!c) return '?';
  const alias = 'as' in c && c.as ? ` ${c.as}` : '';
  return `${c.action}${alias}`;
}
