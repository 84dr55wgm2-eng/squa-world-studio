# Prompt → Monde : ScenePlan et World Composer

```
description (texte)
   │  src/ai/aiProvider.ts  (navigateur : aucune clé)
   ▼
/api/world  (fonction serveur Vercel, api/world.ts — clé ANTHROPIC_API_KEY)
   │  le modèle remplit l'outil emit_scene_plan (schéma JSON imposé) — jamais de code
   ▼
ScenePlan brut ──► validateScenePlan()   src/core/scenePlan.ts   (bornes, ids, références, catalogue)
   ▼
World Composer ──► planToCommands()      src/core/composer.ts    (zones, dispositions, relations → commandes)
   ▼
runWorldCommands()                       src/core/worldCommands.ts (tout ou rien, verrous, 1 transaction)
   ▼
autoCorrect() + validateScene()          (flottants, sous le sol, collisions, hors zone)
   ▼
SceneObjects ordinaires ──► React Three Fiber
```

Le modèle de langage ne produit que de l'intention. Tout ce qui touche aux coordonnées est calculé par le
moteur à partir des dimensions réelles (éléments paramétriques, boîtes des fichiers glTF).

## ScenePlan (version 1)

```json
{
  "version": 1,
  "title": "Cybercafé à Lagos, 2002",
  "sceneType": "interior",
  "environment": { "timeOfDay": "evening", "mood": "warm", "light": "dim" },
  "zones": [
    { "id": "cafe", "kind": "room", "width": 8, "depth": 6, "height": 2.8, "worn": true,
      "openings": [ { "kind": "door", "wall": "south", "position": -0.55, "width": 1.0 },
                    { "kind": "window", "wall": "west", "position": 0.3, "sill": 1.2 } ] }
  ],
  "objects": [
    { "id": "workstation", "type": "computer-desk", "name": "Poste", "zone": "cafe", "count": 8,
      "layout": { "kind": "along-wall", "walls": ["north", "east"] },
      "with": [ { "type": "crt-computer", "relation": "ON", "place": "back" },
                { "type": "keyboard", "relation": "ON", "place": "front" },
                { "type": "chair", "relation": "FACING" } ] },
    { "id": "counter", "type": "counter", "name": "Comptoir du gérant", "zone": "cafe",
      "relationships": [ { "type": "AGAINST", "target": "cafe.wall-west", "offset": 1.6 } ] }
  ],
  "lighting": [ { "kind": "ceiling", "zone": "cafe", "count": 2, "intensity": 0.8, "color": "#ffc98a" } ],
  "cameras": [ { "name": "Depuis l'entrée", "zone": "cafe", "viewpoint": "entrance" } ]
}
```

| Champ | Contenu |
|---|---|
| `zones[]` | `room` (width, depth, height, openings, worn, wallColor, floorColor, ceiling) ou `street` (length, lanes, sidewalkWidth, buildingsPerSide, buildingFloors, streetLightSpacing, rotation) |
| `objects[]` | `id`, `type` (catalogue), `name`, `zone`, `count`, `color`, `layout`, `relationships`, `with` |
| `layout` | `along-wall` (walls[]), `grid` (rows, columns, facing), `corner`, `center`, `along-street` (on: sidewalk \| road, side) |
| `relationships[]` | `{ type, target, side?, gap?, offset? }` — types ON, NEXT_TO, AGAINST, FACING, INSIDE, CENTERED_IN, ALONG, ATTACHED_TO |
| `with[]` | objets associés à chaque instance : `{ type, relation: ON \| NEXT_TO \| FACING \| AGAINST, place?, side?, count? }` |
| `lighting[]` | `ceiling` (count, intensity, color) ; `street` (sources sous les lampadaires) |
| `cameras[]` | `entrance`, `corner`, `overview`, `street-level` |

**Cibles** : id d'objet (`desk`, `desk#3` pour la 3ᵉ instance) ou partie de zone : `zone.wall-north|south|east|west`,
`zone.door`, `zone.window`, `zone.floor`, `zone.road`, `zone.sidewalk-left|right`, ou `zone`.

**Conventions** : murs north = fond (−Z), south = avant (+Z, entrée habituelle), east = +X, west = −X. Le long d'un mur
nord/sud, négatif = côté ouest ; le long d'un mur est/ouest, négatif = côté nord (positions d'ouvertures de −1 à 1,
décalages `offset` en mètres). L'avant d'un objet est son côté d'usage (assise d'un bureau, écran d'une TV).

**Catalogue** (`PLAN_CATALOG`) : desk, computer-desk, table, coffee-table, counter, shelf, tv-stand, bed, chair, armchair,
sofa, small-sofa, pouf, crt-computer, monitor, pc-tower, keyboard, tv, fridge, radio, bottle, vase, wall-lamp, box, plant,
tree, car, truck, streetlight, lantern, barrier, building. Contenu = modèle GLB de la bibliothèque quand il existe ;
structure et volumes d'étude = éléments paramétriques. Asset absent → volume de mêmes dimensions, signalé.

## Validation du plan (`validateScenePlan`)

Données non fiables (sortie d'un modèle) : rien n'est corrigé en silence.

- **Erreurs (plan refusé)** : pas un objet JSON, aucune zone, type de zone inconnu, zone d'objet inconnue quand plusieurs zones existent.
- **Corrections signalées** : dimensions bornées (pièce 1,5–60 m, hauteur 2,1–12 m, rue ≤ 400 m), pièce sans porte (porte ajoutée),
  ouverture plus large que son mur (réduite), identifiants dupliqués (renommés), type hors catalogue / relation invalide /
  cible inconnue / relation vers soi-même (ignorés), plafond de 60 par objet et 300 objets au total.

## World Composer (`composeWorld`)

1. Environnement (fond, soleil, ambiance) selon heure / ambiance / niveau de lumière.
2. Zones : `CREATE_ROOM` (sol, 4 murs, portes et fenêtres percées) / `CREATE_STREET` (chaussée, trottoirs, bâtiments en
   parcelles variées et déterministes, lampadaires). Zones sans position disposées côte à côte.
3. Objets, dans l'ordre des dépendances (un objet après ceux qu'il vise ; cycles cassés et signalés) :
   - `along-wall` : emplacements calculés sur la longueur réelle du mur, passages de porte dégagés, fenêtres évitées pour
     les objets plus hauts que l'allège, angles réservés quand deux rangées se rencontrent ; répartition proportionnelle
     à la place ; si tout ne tient pas, le nombre est réduit **et signalé** (aucun objet entassé ailleurs) ;
   - `grid` : rangées dans la pièce, place réservée pour les objets associés (chaise devant le bureau) ;
   - `corner`, `center`, `along-street` (arbres côté chaussée, véhicules dans leur voie et leur sens) ;
   - sinon, les relations du plan, appliquées dans l'ordre (ex. `ON` puis `FACING`) ;
   - `with` : chaque instance reçoit ses objets associés, puis devient un groupe « unité » (`metadata.unit`).
4. Hiérarchie : Zone > Ensemble (« Poste (8) ») > Unité (« Poste 3 ») > objets.
5. Lumières (plafonniers en grille, intensité selon la surface ; lampadaires allumés le soir), caméras (vue d'ensemble
   toujours ajoutée, entrée, niveau de la rue).
6. Exécution : `runWorldCommands` — tout ou rien.
7. Correction sûre (`autoCorrect`) : unités sorties de leur zone ramenées dedans ; flottants / sous le sol reposés ;
   collisions : l'unité mobile la plus légère est décalée vers la place libre la plus proche (spirale, ≤ 3 m, dans sa zone).
   Structure (murs, sol, route) jamais déplacée.
8. `validateScene` final : les problèmes restants sont affichés dans le rapport, jamais masqués.

Le résultat est UNE transaction : un seul « Annuler » retire tout le monde généré.

## Modifications locales

`modifyScene(contexte, consigne)` → commandes : `ADD_OBJECT`, `REMOVE_OBJECT`, `REPLACE_OBJECT`, `MOVE_OBJECT`, `PLACE`,
`CHANGE_MATERIAL`, `CREATE_ROOM`, `MODIFY_ROOM`, `DUPLICATE_OBJECT`, `RENAME`, `SET_VISIBILITY`… Le contexte envoyé :
id, nom, rôle, type, parent, position, dimensions, orientation, couleur, verrou de chaque objet (400 max). Seuls les objets
touchés sont modifiés, puis vérifiés et corrigés ; un seul « Annuler ».

`MODIFY_ROOM` redimensionne la pièce et re-résout les relations encore valides (bureau contre un mur, objet dans la pièce),
en déplaçant les unités entières ; les répartitions suivent la nouvelle taille.
