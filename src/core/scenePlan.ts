/**
 * ScenePlan : représentation intermédiaire stricte entre une description (texte) et le monde.
 *
 *   prompt → ScenePlan (intention, JSON) → validation / normalisation → World Composer → SceneObjects
 *
 * Un ScenePlan décrit l'INTENTION (« 8 bureaux alignés contre le mur est, un ordinateur sur chacun,
 * une chaise devant ») et jamais l'implémentation (coordonnées, géométrie, Three.js). Il est produit par
 * un modèle de langage (voir src/ai/) ou écrit à la main, et toujours validé ici avant exécution.
 */
import type { ElementShape, RelationType, SemanticRole, Vec3 } from './types.ts';

export const SCENE_PLAN_VERSION = 1;

export type WallSide = 'north' | 'south' | 'east' | 'west';
export type Corner = 'north-east' | 'north-west' | 'south-east' | 'south-west';

export interface PlanOpening {
  kind: 'door' | 'window';
  wall: WallSide;
  /** Position le long du mur, de -1 (début) à 1 (fin) ; 0 = centre. */
  position?: number;
  width?: number;
  height?: number;
  /** Fenêtre : hauteur de l'allège (m). */
  sill?: number;
}

export interface RoomZone {
  id: string;
  kind: 'room';
  name?: string;
  /** Dimensions intérieures (m) : X, Z, hauteur sous plafond. */
  width: number;
  depth: number;
  height: number;
  /** Position du centre de la pièce au sol [x, z] (optionnelle : sinon disposée automatiquement). */
  position?: [number, number];
  wallColor?: string;
  floorColor?: string;
  /** Murs usés / défraîchis. */
  worn?: boolean;
  ceiling?: boolean;
  openings?: PlanOpening[];
}

export interface StreetZone {
  id: string;
  kind: 'street';
  name?: string;
  length: number;
  lanes?: number;
  sidewalkWidth?: number;
  /** Bâtiments de chaque côté (0 = aucun). */
  buildingsPerSide?: number;
  buildingFloors?: [number, number];
  /** Espacement des lampadaires (m), 0 = aucun. */
  streetLightSpacing?: number;
  position?: [number, number];
  /** Orientation de l'axe de la rue (degrés). */
  rotation?: number;
}

export type PlanZone = RoomZone | StreetZone;

export type PlanLayout =
  /** Objets alignés dos au(x) mur(s), répartis sur la longueur disponible (portes évitées). */
  | { kind: 'along-wall'; walls: WallSide[]; margin?: number; gap?: number }
  /** Rangées dans la pièce ; `facing` = direction vers laquelle pointe l'avant des objets. */
  | { kind: 'grid'; rows: number; columns: number; facing?: WallSide }
  /** Dans un coin de la pièce. */
  | { kind: 'corner'; corner: Corner }
  /** Au centre de la zone. */
  | { kind: 'center' }
  /** Le long d'une rue : sur les trottoirs ou sur la chaussée (véhicules). */
  | { kind: 'along-street'; on: 'sidewalk' | 'road'; side?: 'left' | 'right' | 'both' };

export interface PlanRelation {
  type: RelationType;
  /** Id d'un objet du plan (ou `id#2` pour la 2e instance), ou partie de zone : `zone.wall-north`, `zone.door`, `zone.road`, `zone.sidewalk-left`, `zone`. */
  target: string;
  side?: 'front' | 'back' | 'left' | 'right' | 'auto';
  gap?: number;
  offset?: number;
}

/** Objet qui accompagne CHAQUE instance d'un objet (ex. un ordinateur sur chaque bureau). */
export interface PlanChild {
  type: string;
  name?: string;
  relation: 'ON' | 'NEXT_TO' | 'FACING' | 'AGAINST';
  side?: 'front' | 'back' | 'left' | 'right';
  /** Pour ON : zone du plateau (fond, avant, gauche, droite, centre). */
  place?: 'back' | 'front' | 'left' | 'right' | 'center';
  gap?: number;
  count?: number;
  color?: string;
}

export interface PlanObject {
  id: string;
  /** Type du catalogue (voir PLAN_CATALOG). */
  type: string;
  name?: string;
  zone: string;
  count?: number;
  color?: string;
  layout?: PlanLayout;
  relationships?: PlanRelation[];
  with?: PlanChild[];
}

export interface PlanLight {
  kind: 'ceiling' | 'street';
  zone: string;
  count?: number;
  /** 0 (éteint) à 2 (très lumineux), 1 = normal. */
  intensity?: number;
  color?: string;
}

export interface PlanCamera {
  name?: string;
  zone: string;
  viewpoint: 'entrance' | 'corner' | 'overview' | 'street-level';
}

export interface ScenePlan {
  version: 1;
  title: string;
  sceneType: 'interior' | 'street' | 'exterior';
  summary?: string;
  environment?: { timeOfDay?: 'day' | 'evening' | 'night'; mood?: 'warm' | 'neutral' | 'cool'; light?: 'dim' | 'normal' | 'bright' };
  zones: PlanZone[];
  objects: PlanObject[];
  lighting?: PlanLight[];
  cameras?: PlanCamera[];
}

/* ------------------------------------------------------------------ Catalogue */

export type CatalogImpl =
  | { kind: 'asset'; assetId: string; fallback: { shape: ElementShape; size: Vec3 } }
  | { kind: 'element'; shape: ElementShape; size?: Vec3; color?: string; role?: SemanticRole };

export interface CatalogEntry {
  label: string;
  impl: CatalogImpl;
  /** Types de zone où l'objet a du sens. */
  zones: ('room' | 'street')[];
}

const el = (shape: ElementShape, size?: Vec3, color?: string, role?: SemanticRole): CatalogImpl => ({ kind: 'element', shape, size, color, role });
const asset = (assetId: string, shape: ElementShape, size: Vec3): CatalogImpl => ({ kind: 'asset', assetId, fallback: { shape, size } });

/**
 * Catalogue des types d'objets qu'un ScenePlan peut demander. Structure (murs, sols, routes…) et
 * volumes d'étude : éléments paramétriques. Contenu : modèles 3D de la bibliothèque quand il en existe un.
 */
export const PLAN_CATALOG: Record<string, CatalogEntry> = {
  desk: { label: 'Bureau', impl: el('desk', [1.2, 0.75, 0.65]), zones: ['room'] },
  'computer-desk': { label: 'Bureau informatique', impl: el('desk', [1.0, 0.75, 0.7]), zones: ['room'] },
  table: { label: 'Table', impl: el('table'), zones: ['room'] },
  'coffee-table': { label: 'Table basse', impl: el('table', [1.1, 0.42, 0.6]), zones: ['room'] },
  counter: { label: 'Comptoir', impl: el('counter'), zones: ['room'] },
  shelf: { label: 'Étagère', impl: el('shelf'), zones: ['room'] },
  'tv-stand': { label: 'Meuble TV', impl: el('counter', [1.6, 0.5, 0.45], '#3b3631'), zones: ['room'] },
  bed: { label: 'Lit', impl: el('bed'), zones: ['room'] },
  chair: { label: 'Chaise', impl: asset('sheen-chair', 'box', [0.5, 0.85, 0.5]), zones: ['room', 'street'] },
  armchair: { label: 'Fauteuil', impl: asset('chair-damask', 'box', [0.8, 0.7, 0.6]), zones: ['room'] },
  sofa: { label: 'Canapé', impl: asset('leather-sofa', 'box', [2.7, 1.1, 0.9]), zones: ['room'] },
  'small-sofa': { label: 'Canapé', impl: asset('velvet-sofa', 'box', [2.2, 0.8, 1.0]), zones: ['room'] },
  pouf: { label: 'Pouf', impl: asset('silk-pouf', 'box', [0.6, 0.2, 0.6]), zones: ['room'] },
  'crt-computer': { label: 'Ordinateur CRT', impl: el('crt'), zones: ['room'] },
  monitor: { label: 'Écran', impl: el('monitor'), zones: ['room'] },
  'pc-tower': { label: 'Unité centrale', impl: el('computer'), zones: ['room'] },
  keyboard: { label: 'Clavier', impl: el('box', [0.45, 0.03, 0.15], '#cfc8b4', 'electronics'), zones: ['room'] },
  tv: { label: 'Téléviseur', impl: el('monitor', [1.2, 0.8, 0.22], '#15171b'), zones: ['room'] },
  fridge: { label: 'Réfrigérateur', impl: asset('refrigerator', 'box', [0.9, 2.2, 1.0]), zones: ['room'] },
  radio: { label: 'Radio', impl: asset('boombox', 'box', [0.5, 0.5, 0.25]), zones: ['room'] },
  bottle: { label: 'Bouteille', impl: asset('water-bottle', 'box', [0.11, 0.26, 0.11]), zones: ['room'] },
  vase: { label: 'Vase de fleurs', impl: asset('vase-flowers', 'box', [0.22, 0.2, 0.15]), zones: ['room'] },
  'wall-lamp': { label: 'Applique', impl: asset('barn-lamp', 'box', [0.2, 0.25, 0.23]), zones: ['room'] },
  box: { label: 'Carton', impl: el('box'), zones: ['room', 'street'] },
  plant: { label: 'Plante en pot', impl: asset('plant', 'box', [0.7, 0.85, 0.66]), zones: ['room', 'street'] },
  tree: { label: 'Arbre', impl: el('tree'), zones: ['street'] },
  car: { label: 'Voiture', impl: asset('car-concept', 'box', [2.7, 1.3, 4.4]), zones: ['street'] },
  truck: { label: 'Camion', impl: asset('milk-truck', 'box', [2.8, 2.7, 4.9]), zones: ['street'] },
  streetlight: { label: 'Lampadaire', impl: el('streetlight'), zones: ['street'] },
  lantern: { label: 'Lanterne', impl: asset('lantern', 'box', [1.6, 2.6, 0.5]), zones: ['street'] },
  barrier: { label: 'Glissière', impl: el('barrier'), zones: ['street'] },
  building: { label: 'Bâtiment', impl: el('building'), zones: ['street'] },
};

export const CATALOG_TYPES = Object.keys(PLAN_CATALOG);

/* ------------------------------------------------------------------ Validation / normalisation */

export interface PlanIssue {
  level: 'error' | 'warning';
  path: string;
  message: string;
}

export interface PlanValidation {
  ok: boolean;
  plan: ScenePlan | null;
  issues: PlanIssue[];
}

const WALLS: WallSide[] = ['north', 'south', 'east', 'west'];
const CORNERS: Corner[] = ['north-east', 'north-west', 'south-east', 'south-west'];
const RELATIONS: RelationType[] = ['ON', 'INSIDE', 'NEXT_TO', 'AGAINST', 'CENTERED_IN', 'FACING', 'ATTACHED_TO', 'ALONG'];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const color = (v: unknown) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : undefined);
const slug = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'obj';

/** Limites : un plan ne peut pas demander un monde démesuré. */
export const PLAN_LIMITS = { roomMin: 1.5, roomMax: 60, heightMin: 2.1, heightMax: 12, streetMax: 400, countMax: 60, instancesMax: 300, zonesMax: 8 };

/**
 * Valide et normalise un ScenePlan (données non fiables : sortie d'un modèle de langage).
 * - erreurs bloquantes : structure absente, aucune zone, zone inconnue, type d'objet inconnu non remplaçable ;
 * - corrections signalées : valeurs bornées, identifiants dupliqués renommés, références inconnues retirées.
 * Rien n'est corrigé en silence : chaque correction produit un avertissement.
 */
export function validateScenePlan(input: unknown): PlanValidation {
  const issues: PlanIssue[] = [];
  const err = (path: string, message: string) => issues.push({ level: 'error', path, message });
  const warn = (path: string, message: string) => issues.push({ level: 'warning', path, message });
  const clamp = (path: string, v: unknown, lo: number, hi: number, def: number): number => {
    if (!num(v)) {
      if (v !== undefined) warn(path, `valeur invalide, remplacée par ${def}`);
      return def;
    }
    if (v < lo || v > hi) {
      const c = Math.min(hi, Math.max(lo, v));
      warn(path, `${v} hors limites, ramené à ${c}`);
      return c;
    }
    return v;
  };

  if (!isObj(input)) {
    err('', 'Le plan doit être un objet JSON.');
    return { ok: false, plan: null, issues };
  }
  if (input.version !== undefined && input.version !== SCENE_PLAN_VERSION) warn('version', `version ${String(input.version)} lue comme ${SCENE_PLAN_VERSION}`);
  const sceneType = ['interior', 'street', 'exterior'].includes(input.sceneType as string) ? (input.sceneType as ScenePlan['sceneType']) : 'interior';
  if (input.sceneType !== sceneType) warn('sceneType', `type de scène « ${String(input.sceneType)} » inconnu, « ${sceneType} » utilisé`);

  // Zones
  const zones: PlanZone[] = [];
  const zoneIds = new Set<string>();
  const rawZones = Array.isArray(input.zones) ? input.zones : [];
  if (!rawZones.length) err('zones', 'Le plan ne contient aucune zone (pièce ou rue).');
  rawZones.slice(0, PLAN_LIMITS.zonesMax).forEach((z, i) => {
    const p = `zones[${i}]`;
    if (!isObj(z)) return err(p, 'zone invalide');
    let id = str(z.id) ? slug(z.id) : `zone-${i + 1}`;
    if (zoneIds.has(id)) {
      warn(`${p}.id`, `identifiant de zone dupliqué « ${id} », renommé`);
      id = `${id}-${i + 1}`;
    }
    const position = Array.isArray(z.position) && z.position.length === 2 && z.position.every(num) ? ([z.position[0], z.position[1]] as [number, number]) : undefined;
    if (z.kind === 'room') {
      const openings: PlanOpening[] = [];
      (Array.isArray(z.openings) ? z.openings : []).forEach((o, k) => {
        const q = `${p}.openings[${k}]`;
        if (!isObj(o) || (o.kind !== 'door' && o.kind !== 'window')) return warn(q, 'ouverture ignorée (kind doit être door ou window)');
        if (!WALLS.includes(o.wall as WallSide)) return warn(q, `mur « ${String(o.wall)} » inconnu, ouverture ignorée`);
        openings.push({
          kind: o.kind,
          wall: o.wall as WallSide,
          position: clamp(`${q}.position`, o.position, -1, 1, 0),
          ...(o.width !== undefined ? { width: clamp(`${q}.width`, o.width, 0.5, o.kind === 'door' ? 3 : 6, o.kind === 'door' ? 0.9 : 1.2) } : {}),
          ...(o.height !== undefined ? { height: clamp(`${q}.height`, o.height, 0.4, 3, o.kind === 'door' ? 2.1 : 1.2) } : {}),
          ...(o.sill !== undefined ? { sill: clamp(`${q}.sill`, o.sill, 0, 2, 0.9) } : {}),
        });
      });
      if (!openings.some((o) => o.kind === 'door')) {
        warn(`${p}.openings`, 'pièce sans porte : une porte est ajoutée au mur sud');
        openings.push({ kind: 'door', wall: 'south', position: 0.5 });
      }
      const width = clamp(`${p}.width`, z.width, PLAN_LIMITS.roomMin, PLAN_LIMITS.roomMax, 5);
      const depth = clamp(`${p}.depth`, z.depth, PLAN_LIMITS.roomMin, PLAN_LIMITS.roomMax, 5);
      const height = clamp(`${p}.height`, z.height, PLAN_LIMITS.heightMin, PLAN_LIMITS.heightMax, 2.8);
      // Une ouverture plus large que son mur est réduite.
      for (const o of openings) {
        const len = o.wall === 'north' || o.wall === 'south' ? width : depth;
        const w = o.width ?? (o.kind === 'door' ? 0.9 : 1.2);
        if (w > len - 0.4) {
          o.width = Math.max(0.5, len - 0.4);
          warn(`${p}.openings`, `${o.kind === 'door' ? 'porte' : 'fenêtre'} plus large que le mur ${o.wall}, réduite à ${o.width.toFixed(2)} m`);
        }
        if (o.kind === 'door' && (o.height ?? 2.1) > height - 0.1) o.height = height - 0.1;
      }
      zones.push({
        id,
        kind: 'room',
        name: str(z.name) ? z.name : undefined,
        width,
        depth,
        height,
        position,
        wallColor: color(z.wallColor),
        floorColor: color(z.floorColor),
        worn: z.worn === true,
        ceiling: z.ceiling === true,
        openings,
      });
    } else if (z.kind === 'street') {
      const bf = Array.isArray(z.buildingFloors) && z.buildingFloors.length === 2 && z.buildingFloors.every(num) ? (z.buildingFloors as [number, number]) : [2, 5];
      zones.push({
        id,
        kind: 'street',
        name: str(z.name) ? z.name : undefined,
        length: clamp(`${p}.length`, z.length, 10, PLAN_LIMITS.streetMax, 60),
        lanes: Math.round(clamp(`${p}.lanes`, z.lanes, 1, 6, 2)),
        sidewalkWidth: clamp(`${p}.sidewalkWidth`, z.sidewalkWidth, 1.2, 8, 3),
        buildingsPerSide: Math.round(clamp(`${p}.buildingsPerSide`, z.buildingsPerSide, 0, 20, 3)),
        buildingFloors: [Math.round(Math.max(1, Math.min(bf[0], bf[1], 40))), Math.round(Math.max(1, Math.min(Math.max(bf[0], bf[1]), 40)))],
        streetLightSpacing: clamp(`${p}.streetLightSpacing`, z.streetLightSpacing, 0, 100, 15),
        position,
        rotation: num(z.rotation) ? z.rotation : 0,
      });
    } else {
      return err(p, `type de zone « ${String(z.kind)} » inconnu (room ou street)`);
    }
    zoneIds.add(id);
  });
  if (rawZones.length > PLAN_LIMITS.zonesMax) warn('zones', `plus de ${PLAN_LIMITS.zonesMax} zones : les suivantes sont ignorées`);
  const zoneKind = new Map(zones.map((z) => [z.id, z.kind]));

  // Objets
  const objects: PlanObject[] = [];
  const objectIds = new Set<string>();
  let instances = 0;
  const rawObjects = Array.isArray(input.objects) ? input.objects : [];
  rawObjects.forEach((o, i) => {
    const p = `objects[${i}]`;
    if (!isObj(o)) return err(p, 'objet invalide');
    if (!str(o.type) || !PLAN_CATALOG[o.type]) return warn(p, `type « ${String(o.type)} » absent du catalogue : objet ignoré`);
    let zone = str(o.zone) ? slug(o.zone) : '';
    if (!zoneKind.has(zone)) {
      if (zones.length === 1) {
        if (o.zone !== undefined) warn(`${p}.zone`, `zone « ${String(o.zone)} » inconnue : « ${zones[0].id} » utilisée`);
        zone = zones[0].id;
      } else return err(`${p}.zone`, `zone « ${String(o.zone)} » inconnue`);
    }
    const entry = PLAN_CATALOG[o.type];
    if (!entry.zones.includes(zoneKind.get(zone)!)) warn(p, `« ${entry.label} » dans une zone de type ${zoneKind.get(zone)} : conservé`);
    let id = str(o.id) ? slug(o.id) : `${o.type}-${i + 1}`;
    if (objectIds.has(id) || zoneIds.has(id)) {
      const renamed = `${id}-${i + 1}`;
      warn(`${p}.id`, `identifiant dupliqué « ${id} », renommé « ${renamed} »`);
      id = renamed;
    }
    objectIds.add(id);
    let count = Math.round(clamp(`${p}.count`, o.count, 1, PLAN_LIMITS.countMax, 1));
    const children = (Array.isArray(o.with) ? o.with : []).filter((c, k): c is Record<string, unknown> => {
      if (!isObj(c) || !str(c.type) || !PLAN_CATALOG[c.type]) {
        warn(`${p}.with[${k}]`, `type « ${String(isObj(c) ? c.type : c)} » absent du catalogue : ignoré`);
        return false;
      }
      if (!['ON', 'NEXT_TO', 'FACING', 'AGAINST'].includes(c.relation as string)) {
        warn(`${p}.with[${k}]`, `relation « ${String(c.relation)} » non prise en charge pour un objet associé : NEXT_TO utilisé`);
        c.relation = 'NEXT_TO';
      }
      return true;
    });
    const perInstance = 1 + children.reduce((n, c) => n + (num(c.count) ? Math.max(1, Math.min(4, Math.round(c.count))) : 1), 0);
    if (instances + count * perInstance > PLAN_LIMITS.instancesMax) {
      const fit = Math.max(0, Math.floor((PLAN_LIMITS.instancesMax - instances) / perInstance));
      warn(`${p}.count`, `trop d'objets dans le plan : ${count} → ${fit}`);
      count = fit;
      if (!count) return;
    }
    instances += count * perInstance;
    const out: PlanObject = { id, type: o.type, zone, count };
    if (str(o.name)) out.name = o.name.slice(0, 60);
    if (color(o.color)) out.color = color(o.color);
    const layout = readLayout(o.layout, `${p}.layout`, warn);
    if (layout) out.layout = layout;
    const rels = (Array.isArray(o.relationships) ? o.relationships : []).filter((r, k): r is Record<string, unknown> => {
      if (!isObj(r) || !RELATIONS.includes(r.type as RelationType) || !str(r.target)) {
        warn(`${p}.relationships[${k}]`, 'relation invalide ignorée');
        return false;
      }
      return true;
    });
    if (rels.length) {
      out.relationships = rels.map((r) => ({
        type: r.type as RelationType,
        target: String(r.target).trim(),
        ...(['front', 'back', 'left', 'right', 'auto'].includes(r.side as string) ? { side: r.side as PlanRelation['side'] } : {}),
        ...(num(r.gap) ? { gap: Math.min(5, Math.max(0, r.gap)) } : {}),
        ...(num(r.offset) ? { offset: Math.min(50, Math.max(-50, r.offset)) } : {}),
      }));
    }
    if (children.length) {
      out.with = children.map((c) => ({
        type: String(c.type),
        relation: c.relation as PlanChild['relation'],
        ...(str(c.name) ? { name: String(c.name).slice(0, 60) } : {}),
        ...(['front', 'back', 'left', 'right'].includes(c.side as string) ? { side: c.side as PlanChild['side'] } : {}),
        ...(['front', 'back', 'left', 'right', 'center'].includes(c.place as string) ? { place: c.place as PlanChild['place'] } : {}),
        ...(num(c.gap) ? { gap: Math.min(2, Math.max(0, c.gap)) } : {}),
        ...(num(c.count) ? { count: Math.max(1, Math.min(4, Math.round(c.count))) } : {}),
        ...(color(c.color) ? { color: color(c.color) } : {}),
      }));
    }
    objects.push(out);
  });

  // Références des relations : objets du plan ou parties de zones.
  const known = new Set([...objectIds, ...zoneIds]);
  for (const o of objects) {
    o.relationships = o.relationships?.filter((r) => {
      const base = r.target.split('#')[0].split('.')[0];
      if (!known.has(slug(base)) && !known.has(base)) {
        warn(`objects[${o.id}]`, `cible « ${r.target} » inconnue : relation ignorée`);
        return false;
      }
      if (slug(base) === o.id) {
        warn(`objects[${o.id}]`, 'relation vers soi-même ignorée');
        return false;
      }
      return true;
    });
    if (o.relationships && !o.relationships.length) delete o.relationships;
  }

  const lighting: PlanLight[] = (Array.isArray(input.lighting) ? input.lighting : []).flatMap((l, i) => {
    if (!isObj(l) || (l.kind !== 'ceiling' && l.kind !== 'street')) {
      warn(`lighting[${i}]`, 'éclairage ignoré (kind : ceiling ou street)');
      return [];
    }
    const zone = str(l.zone) && zoneKind.has(slug(l.zone)) ? slug(l.zone) : zones[0]?.id;
    if (!zone) return [];
    return [{ kind: l.kind, zone, count: Math.round(clamp(`lighting[${i}].count`, l.count, 1, 24, 1)), intensity: clamp(`lighting[${i}].intensity`, l.intensity, 0, 2, 1), ...(color(l.color) ? { color: color(l.color) } : {}) }];
  });
  const cameras: PlanCamera[] = (Array.isArray(input.cameras) ? input.cameras : []).slice(0, 6).flatMap((c, i) => {
    if (!isObj(c) || !['entrance', 'corner', 'overview', 'street-level'].includes(c.viewpoint as string)) {
      warn(`cameras[${i}]`, 'caméra ignorée (viewpoint inconnu)');
      return [];
    }
    const zone = str(c.zone) && zoneKind.has(slug(c.zone)) ? slug(c.zone) : zones[0]?.id;
    return zone ? [{ zone, viewpoint: c.viewpoint as PlanCamera['viewpoint'], ...(str(c.name) ? { name: String(c.name).slice(0, 60) } : {}) }] : [];
  });

  const env = isObj(input.environment) ? input.environment : {};
  const plan: ScenePlan = {
    version: 1,
    title: str(input.title) ? String(input.title).slice(0, 80) : 'Monde généré',
    sceneType,
    ...(str(input.summary) ? { summary: String(input.summary).slice(0, 400) } : {}),
    environment: {
      timeOfDay: ['day', 'evening', 'night'].includes(env.timeOfDay as string) ? (env.timeOfDay as 'day') : 'day',
      mood: ['warm', 'neutral', 'cool'].includes(env.mood as string) ? (env.mood as 'warm') : 'neutral',
      light: ['dim', 'normal', 'bright'].includes(env.light as string) ? (env.light as 'dim') : 'normal',
    },
    zones,
    objects,
    lighting,
    cameras,
  };
  const ok = !issues.some((i) => i.level === 'error') && zones.length > 0;
  return { ok, plan: ok ? plan : null, issues };
}

function readLayout(v: unknown, path: string, warn: (p: string, m: string) => void): PlanLayout | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) {
    warn(path, 'disposition ignorée');
    return undefined;
  }
  switch (v.kind) {
    case 'along-wall': {
      const walls = (Array.isArray(v.walls) ? v.walls : [v.wall]).filter((w): w is WallSide => WALLS.includes(w as WallSide));
      if (!walls.length) {
        warn(path, 'along-wall sans mur valide : disposition ignorée');
        return undefined;
      }
      return { kind: 'along-wall', walls: [...new Set(walls)], ...(num(v.margin) ? { margin: Math.max(0, Math.min(3, v.margin)) } : {}), ...(num(v.gap) ? { gap: Math.max(0, Math.min(3, v.gap)) } : {}) };
    }
    case 'grid':
      return {
        kind: 'grid',
        rows: num(v.rows) ? Math.max(1, Math.min(12, Math.round(v.rows))) : 1,
        columns: num(v.columns) ? Math.max(1, Math.min(12, Math.round(v.columns))) : 1,
        ...(WALLS.includes(v.facing as WallSide) ? { facing: v.facing as WallSide } : {}),
      };
    case 'corner':
      return CORNERS.includes(v.corner as Corner) ? { kind: 'corner', corner: v.corner as Corner } : (warn(path, 'coin inconnu : disposition ignorée'), undefined);
    case 'center':
      return { kind: 'center' };
    case 'along-street':
      return {
        kind: 'along-street',
        on: v.on === 'road' ? 'road' : 'sidewalk',
        side: v.side === 'left' || v.side === 'right' ? v.side : 'both',
      };
    default:
      warn(path, `disposition « ${String(v.kind)} » inconnue : ignorée`);
      return undefined;
  }
}
