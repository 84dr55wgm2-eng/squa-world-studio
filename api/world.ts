/**
 * Fonction serveur Vercel : /api/world
 *
 * Seul endroit qui parle à un modèle de langage. La clé d'API reste ici (variable d'environnement
 * serveur ANTHROPIC_API_KEY), jamais dans le navigateur.
 *
 *   GET  /api/world                         → { configured, model }
 *   POST /api/world { mode: "plan", prompt } → { plan }        (ScenePlan brut, validé ensuite par le client)
 *   POST /api/world { mode: "edit", instruction, scene } → { commands, explanation }
 *
 * Le modèle ne produit jamais de code : il remplit un outil dont le schéma est un ScenePlan
 * (ou une liste de commandes structurées). Le client valide TOUJOURS la sortie avant exécution.
 * Ce fichier n'importe rien du reste du projet (déployé seul par Vercel).
 */

export const config = { maxDuration: 60 };

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5';
const MAX_PROMPT = 4000;
const MAX_SCENE_JSON = 250_000;

/** Types d'objets autorisés (doit rester identique à PLAN_CATALOG dans src/core/scenePlan.ts — vérifié par les tests). */
export const CATALOG_FOR_MODEL: Record<string, string> = {
  desk: 'bureau 1,2 × 0,65 m',
  'computer-desk': 'bureau informatique 1,0 × 0,7 m',
  table: 'table 1,6 × 0,9 m',
  'coffee-table': 'table basse 1,1 × 0,6 m',
  counter: 'comptoir / caisse 2,0 × 0,6 × 1,05 m (avant = côté client)',
  shelf: 'étagère 0,9 × 0,35 × 1,9 m',
  'tv-stand': 'meuble TV bas 1,6 × 0,45 m',
  bed: 'lit double 1,6 × 2,1 m',
  chair: 'chaise / siège',
  armchair: 'fauteuil',
  sofa: 'grand canapé 2,7 m',
  'small-sofa': 'canapé 2,2 m',
  pouf: 'pouf',
  'crt-computer': 'ordinateur à écran cathodique (années 1990-2000)',
  monitor: 'écran plat',
  'pc-tower': 'unité centrale',
  keyboard: 'clavier',
  tv: 'téléviseur',
  fridge: 'réfrigérateur vitré à boissons',
  radio: 'radio-cassette',
  bottle: 'bouteille / gourde',
  vase: 'vase de fleurs',
  'wall-lamp': 'applique murale',
  box: 'carton',
  plant: 'plante en pot',
  tree: 'arbre (rue, parc)',
  car: 'voiture',
  truck: 'camion de livraison',
  streetlight: 'lampadaire',
  lantern: 'lanterne sur potence',
  barrier: 'glissière béton',
  building: 'volume de bâtiment',
};

export const PLAN_SYSTEM_PROMPT = `Tu es le planificateur spatial de SQUA World Studio, un éditeur de mondes 3D.
Tu reçois la description d'un lieu. Tu produis UNIQUEMENT un ScenePlan via l'outil emit_scene_plan : une description d'INTENTION
(zones, objets, dispositions, relations), jamais de coordonnées libres ni de code. Un moteur déterministe place ensuite les objets
à partir de leurs dimensions réelles.

Repère : mètres, Y vers le haut. Une pièce a 4 murs : north (fond), south (avant, entrée habituelle), east, west.
Position le long d'un mur (position des ouvertures, "offset" des relations contre un mur) : murs north/south, négatif = côté west,
positif = côté east ; murs east/west, négatif = côté north, positif = côté south. Pour les ouvertures, position va de -1 à 1.
L'AVANT d'un objet est le côté utilisé (côté assise d'un bureau, écran d'une TV, côté client d'un comptoir).

Zones :
- room : width (X), depth (Z), height (sous plafond), openings [{kind: door|window, wall, position, width, height, sill}], worn (murs usés),
  wallColor, floorColor ("#rrggbb"). Toujours au moins une porte. Dimensions réalistes (chambre 3×3,5 ; salon 5×4 à 7×5 ; boutique 6×5 à 10×8).
- street : length, lanes, sidewalkWidth, buildingsPerSide (bâtiments de CHAQUE côté), buildingFloors [min,max], streetLightSpacing (m, 0 = aucun).

Objets : { id unique, type (catalogue ci-dessous UNIQUEMENT), name (français), zone, count, color?, layout?, relationships?, with? }
- layout (dispositions répétées) :
  {kind:"along-wall", walls:[...]} objets alignés dos au mur (bureaux, étagères) — les portes restent dégagées ;
  {kind:"grid", rows, columns, facing: north|south|east|west} rangées au milieu de la pièce (facing = direction de l'avant) ;
  {kind:"corner", corner:"north-east"|...} ; {kind:"center"} ;
  {kind:"along-street", on:"sidewalk"|"road", side:"left"|"right"|"both"} (arbres sur trottoir, véhicules sur la chaussée).
- relationships (objets uniques) : [{type, target, side?, gap?, offset?}] appliquées dans l'ordre. type parmi
  ON (posé sur), NEXT_TO (à côté ; side front|back|left|right|auto), AGAINST (dos contre ; mur : "zoneId.wall-north"), FACING (tourné vers),
  INSIDE (dans la zone), CENTERED_IN, ALONG (le long de "zoneId.road" ou "zoneId.sidewalk-left"), ATTACHED_TO (fixé à un mur).
  target = id d'un autre objet (instance k : "id#k") ou partie de zone : "zoneId.wall-east", "zoneId.door", "zoneId.road", "zoneId.sidewalk-right", ou "zoneId".
  Ex. télévision : [{ON "tv-stand"}, {FACING "sofa"}] ; table basse : [{NEXT_TO "sofa", side:"front", gap:0.45}].
- with : objets associés à CHAQUE instance : [{type, relation: ON|NEXT_TO|FACING|AGAINST, place?: back|front|left|right|center (pour ON), side?, count?}]
  Ex. poste informatique = computer-desk avec with [{crt-computer ON place back}, {keyboard ON place front}, {chair FACING}].
N'invente jamais un type hors catalogue : choisis le plus proche. Préfère peu d'objets bien placés à beaucoup d'objets entassés ;
vérifie que les quantités tiennent dans la pièce (un bureau + chaise ≈ 1,2 m de mur).

Catalogue : ${Object.entries(CATALOG_FOR_MODEL)
  .map(([k, v]) => `${k} (${v})`)
  .join(' ; ')}.

environment : timeOfDay day|evening|night, mood warm|neutral|cool, light dim|normal|bright.
lighting : [{kind:"ceiling", zone, count, intensity 0..2, color?}] pour les pièces ; [{kind:"street", zone}] pour éclairer une rue le soir.
cameras : [{name, zone, viewpoint: entrance|corner|overview|street-level}].
Réponds en français pour les noms. Ne décris pas ce que tu fais : appelle l'outil.`;

const PLAN_TOOL = {
  name: 'emit_scene_plan',
  description: 'Émet le ScenePlan du lieu décrit.',
  input_schema: {
    type: 'object',
    required: ['version', 'title', 'sceneType', 'zones', 'objects'],
    properties: {
      version: { type: 'integer', enum: [1] },
      title: { type: 'string' },
      sceneType: { type: 'string', enum: ['interior', 'street', 'exterior'] },
      summary: { type: 'string' },
      environment: {
        type: 'object',
        properties: {
          timeOfDay: { type: 'string', enum: ['day', 'evening', 'night'] },
          mood: { type: 'string', enum: ['warm', 'neutral', 'cool'] },
          light: { type: 'string', enum: ['dim', 'normal', 'bright'] },
        },
      },
      zones: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'kind'],
          properties: {
            id: { type: 'string' },
            kind: { type: 'string', enum: ['room', 'street'] },
            name: { type: 'string' },
            width: { type: 'number' },
            depth: { type: 'number' },
            height: { type: 'number' },
            worn: { type: 'boolean' },
            wallColor: { type: 'string' },
            floorColor: { type: 'string' },
            openings: {
              type: 'array',
              items: {
                type: 'object',
                required: ['kind', 'wall'],
                properties: {
                  kind: { type: 'string', enum: ['door', 'window'] },
                  wall: { type: 'string', enum: ['north', 'south', 'east', 'west'] },
                  position: { type: 'number' },
                  width: { type: 'number' },
                  height: { type: 'number' },
                  sill: { type: 'number' },
                },
              },
            },
            length: { type: 'number' },
            lanes: { type: 'integer' },
            sidewalkWidth: { type: 'number' },
            buildingsPerSide: { type: 'integer' },
            buildingFloors: { type: 'array', items: { type: 'integer' } },
            streetLightSpacing: { type: 'number' },
          },
        },
      },
      objects: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'type', 'zone'],
          properties: {
            id: { type: 'string' },
            type: { type: 'string', enum: Object.keys(CATALOG_FOR_MODEL) },
            name: { type: 'string' },
            zone: { type: 'string' },
            count: { type: 'integer' },
            color: { type: 'string' },
            layout: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['along-wall', 'grid', 'corner', 'center', 'along-street'] },
                walls: { type: 'array', items: { type: 'string', enum: ['north', 'south', 'east', 'west'] } },
                rows: { type: 'integer' },
                columns: { type: 'integer' },
                facing: { type: 'string', enum: ['north', 'south', 'east', 'west'] },
                corner: { type: 'string', enum: ['north-east', 'north-west', 'south-east', 'south-west'] },
                on: { type: 'string', enum: ['sidewalk', 'road'] },
                side: { type: 'string', enum: ['left', 'right', 'both'] },
              },
            },
            relationships: {
              type: 'array',
              items: {
                type: 'object',
                required: ['type', 'target'],
                properties: {
                  type: { type: 'string', enum: ['ON', 'NEXT_TO', 'AGAINST', 'FACING', 'INSIDE', 'CENTERED_IN', 'ALONG', 'ATTACHED_TO'] },
                  target: { type: 'string' },
                  side: { type: 'string', enum: ['front', 'back', 'left', 'right', 'auto'] },
                  gap: { type: 'number' },
                  offset: { type: 'number' },
                },
              },
            },
            with: {
              type: 'array',
              items: {
                type: 'object',
                required: ['type', 'relation'],
                properties: {
                  type: { type: 'string', enum: Object.keys(CATALOG_FOR_MODEL) },
                  name: { type: 'string' },
                  relation: { type: 'string', enum: ['ON', 'NEXT_TO', 'FACING', 'AGAINST'] },
                  place: { type: 'string', enum: ['back', 'front', 'left', 'right', 'center'] },
                  side: { type: 'string', enum: ['front', 'back', 'left', 'right'] },
                  count: { type: 'integer' },
                  color: { type: 'string' },
                },
              },
            },
          },
        },
      },
      lighting: {
        type: 'array',
        items: { type: 'object', required: ['kind', 'zone'], properties: { kind: { type: 'string', enum: ['ceiling', 'street'] }, zone: { type: 'string' }, count: { type: 'integer' }, intensity: { type: 'number' }, color: { type: 'string' } } },
      },
      cameras: {
        type: 'array',
        items: { type: 'object', required: ['zone', 'viewpoint'], properties: { name: { type: 'string' }, zone: { type: 'string' }, viewpoint: { type: 'string', enum: ['entrance', 'corner', 'overview', 'street-level'] } } },
      },
    },
  },
};

export const EDIT_SYSTEM_PROMPT = `Tu modifies LOCALEMENT une scène existante de SQUA World Studio. Tu reçois la liste des objets (id, nom, rôle, type,
parent, position monde, dimensions) et une consigne. Tu réponds UNIQUEMENT avec l'outil emit_commands : une liste courte de commandes
qui ne touche QUE ce que la consigne demande (jamais de reconstruction). Références d'objets : leur "id" exact.
Commandes :
- {"action":"ADD_OBJECT","element":"<forme>"|"assetId":"<asset>", "name", "relation":{"type","target","side?","gap?","offset?"}} ;
  formes : desk, table, counter, shelf, crt, monitor, computer, box, tree, bed, streetlight, barrier, window, door ;
  assets : sheen-chair, chair-damask, leather-sofa, velvet-sofa, silk-pouf, plant, refrigerator, boombox, water-bottle, vase-flowers, car-concept, milk-truck, lantern.
  Une fenêtre ou une porte : element window|door avec relation {"type":"ATTACHED_TO","target":"<id du mur>","offset":<m le long du mur>}.
- {"action":"REMOVE_OBJECT","target":"<id>"|[ids]}
- {"action":"REPLACE_OBJECT","target":"<id>"|[ids],"assetId"|"element","material?":{"color"}}
- {"action":"MOVE_OBJECT","target","by":[dx,dy,dz]|"to":[x,y,z],"yawBy?":degrés}
- {"action":"PLACE","target","relation":{...}} (relations ON, NEXT_TO, AGAINST, FACING, INSIDE, CENTERED_IN, ALONG, ATTACHED_TO)
- {"action":"CHANGE_MATERIAL","target","material":{"color":"#rrggbb","roughness":0..1,"metalness":0..1,"opacity":0..1}}
- {"action":"MODIFY_ROOM","target":"<id de la pièce>","width?","depth?","height?"}
- {"action":"DUPLICATE_OBJECT","target","relation?"}, {"action":"RENAME","target","name"}, {"action":"SET_VISIBILITY","target","visible"}
Les objets verrouillés ne peuvent pas être modifiés. Si la consigne est impossible, renvoie une liste vide et explique pourquoi.`;

const EDIT_TOOL = {
  name: 'emit_commands',
  description: 'Émet les commandes de modification locale.',
  input_schema: {
    type: 'object',
    required: ['commands', 'explanation'],
    properties: {
      explanation: { type: 'string', description: 'Une phrase, en français, décrivant la modification.' },
      commands: { type: 'array', items: { type: 'object' } },
    },
  },
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const env = (name: string): string | undefined => (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];

export function GET(): Response {
  const key = env('ANTHROPIC_API_KEY');
  return json(200, { configured: !!key, provider: 'anthropic', model: env('SQUA_AI_MODEL') || DEFAULT_MODEL });
}

interface ToolCallResult {
  input: unknown;
  model: string;
  usage?: unknown;
}

/** Appel du modèle avec un outil imposé ; `fetchImpl` est injectable pour les tests. */
export async function callModel(system: string, user: string, tool: typeof PLAN_TOOL | typeof EDIT_TOOL, fetchImpl: typeof fetch = fetch): Promise<ToolCallResult> {
  const key = env('ANTHROPIC_API_KEY');
  if (!key) throw new HttpError(503, 'AI_NOT_CONFIGURED', "Aucun modèle d'IA n'est connecté : la variable d'environnement serveur ANTHROPIC_API_KEY n'est pas définie sur Vercel.");
  const model = env('SQUA_AI_MODEL') || DEFAULT_MODEL;
  const res = await fetchImpl(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 8000, system, tools: [tool], tool_choice: { type: 'tool', name: tool.name }, messages: [{ role: 'user', content: user }] }),
  });
  const text = await res.text();
  let data: { content?: { type: string; name?: string; input?: unknown }[]; error?: { message?: string }; usage?: unknown; stop_reason?: string } = {};
  try {
    data = JSON.parse(text);
  } catch {
    /* réponse non JSON : traitée ci-dessous */
  }
  if (!res.ok) throw new HttpError(502, 'AI_UPSTREAM', `Le modèle a refusé la requête (HTTP ${res.status}) : ${data.error?.message ?? text.slice(0, 200)}`);
  const call = data.content?.find((c) => c.type === 'tool_use' && c.name === tool.name);
  if (!call) throw new HttpError(502, 'AI_NO_OUTPUT', `Le modèle n'a pas produit de résultat structuré${data.stop_reason === 'max_tokens' ? ' (réponse tronquée : description trop longue ?)' : ''}.`);
  return { input: call.input, model, usage: data.usage };
}

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function handle(request: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  let body: { mode?: string; prompt?: unknown; instruction?: unknown; scene?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: 'BAD_REQUEST', message: 'Corps JSON invalide.' });
  }
  try {
    if (body.mode === 'plan') {
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      if (prompt.length < 3) return json(400, { error: 'BAD_REQUEST', message: 'Description vide.' });
      if (prompt.length > MAX_PROMPT) return json(400, { error: 'BAD_REQUEST', message: `Description trop longue (${MAX_PROMPT} caractères maximum).` });
      const r = await callModel(PLAN_SYSTEM_PROMPT, prompt, PLAN_TOOL, fetchImpl);
      return json(200, { plan: r.input, model: r.model, usage: r.usage });
    }
    if (body.mode === 'edit') {
      const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
      if (instruction.length < 2 || instruction.length > MAX_PROMPT) return json(400, { error: 'BAD_REQUEST', message: 'Consigne vide ou trop longue.' });
      const scene = JSON.stringify(body.scene ?? {});
      if (scene.length > MAX_SCENE_JSON) return json(400, { error: 'BAD_REQUEST', message: 'Scène trop volumineuse pour une modification par IA.' });
      const r = await callModel(EDIT_SYSTEM_PROMPT, `Scène :\n${scene}\n\nConsigne : ${instruction}`, EDIT_TOOL, fetchImpl);
      const out = (r.input ?? {}) as { commands?: unknown; explanation?: unknown };
      return json(200, { commands: Array.isArray(out.commands) ? out.commands : [], explanation: typeof out.explanation === 'string' ? out.explanation : '', model: r.model });
    }
    return json(400, { error: 'BAD_REQUEST', message: 'mode doit valoir "plan" ou "edit".' });
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message });
    return json(502, { error: 'AI_UPSTREAM', message: `Appel du modèle impossible : ${(e as Error).message}` });
  }
}

export function POST(request: Request): Promise<Response> {
  return handle(request);
}
