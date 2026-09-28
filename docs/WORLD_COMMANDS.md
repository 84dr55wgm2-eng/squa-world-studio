# Commandes structurées du monde (API prête pour l'IA)

Le futur générateur (LLM, prompt-to-world) **ne manipulera jamais Three.js**. Il produira une liste de commandes JSON que
`runWorldCommands()` (`src/core/worldCommands.ts`) valide et traduit en **une seule transaction** du cœur :

- un seul « Annuler » retire tout le script ;
- **tout ou rien** : à la première commande invalide, rien n'est appliqué et l'index de la commande fautive est renvoyé ;
- les verrous sont respectés (un objet verrouillé par l'utilisateur ne peut pas être modifié par un script) ;
- chaque commande voit le résultat des précédentes (une relation peut viser un objet créé deux lignes plus haut).

Dans l'éditeur : bouton **Commandes** (console JSON). Les modèles de scène et les prefabs intégrés sont eux-mêmes des
scripts de commandes (`src/core/templates.ts`).

## Références d'objets

Partout où une commande attend un objet (`target`, `parent`, `relation.target`) : un **alias** défini par `"as"` plus haut
dans le script, un **identifiant** d'objet, ou un **nom** unique dans la scène. `CREATE_ROOM` / `CREATE_STREET` avec
`"as": "room"` exposent aussi `room.floor`, `room.wall_north|south|east|west`, `room.door`, `room.window`, `room.light` ;
`street.road`, `street.sidewalk_left|right`.

## Actions

| Action | Champs principaux |
|---|---|
| `ADD_OBJECT` | un de : `assetId` (bibliothèque, ex. `"sheen-chair"`), `element` (forme paramétrique + `size`, `params`, `material`), `primitive` (`box`/`sphere`), `light`, `camera` ; puis `name`, `position`, `rotation`, `scale`, `parent`, `role`, `tags`, `as`, `relation`, `locked` |
| `REMOVE_OBJECT` | `target` (un ou plusieurs) |
| `TRANSFORM_OBJECT` | `target`, `position?`, `rotation?`, `scale?`, `space?: "local" \| "world"` |
| `PLACE` | `target`, `relation` |
| `GROUP_OBJECTS` / `UNGROUP_OBJECTS` | `targets`, `name?`, `as?` / `target` |
| `REPARENT` | `target`, `parent` (ou `null`) — position à l'écran conservée |
| `DUPLICATE_OBJECT` | `target`, `as?`, `relation?` |
| `SET_VISIBILITY` / `SET_LOCK` | `target`, `visible` / `locked` |
| `RENAME` | `target`, `name` |
| `CHANGE_MATERIAL` | `target`, `material: { color?, roughness?, metalness?, opacity? }` ou `null` (matériaux d'origine) |
| `SET_PROPERTIES` | `target`, `role?`, `tags?`, `size?`, `params?` (éléments) |
| `CREATE_ROOM` | `width`, `depth`, `height`, `wallThickness?`, `doors?: [{ wall, offset?, width?, height? }]`, `windows?: [{ wall, offset?, width?, height?, sill? }]`, `light?`, `ceiling?`, `position?`, `rotation?`, `as?` |
| `CREATE_STREET` | `length`, `lanes?`, `roadWidth?`, `sidewalkWidth?`, `buildings?`, `streetLightSpacing?`, `position?`, `rotation?`, `as?` |
| `INSTANTIATE_PREFAB` | `prefabId` (`office-desk`, `cybercafe-workstation`, `living-corner`, `street-corner`, ou un prefab utilisateur), `position?`, `relation?`, `as?` |

## Relations spatiales (moteur de placement)

`relation: { "type": …, "target": … , options }` — calculée à partir des **boîtes réelles** (dimensions des éléments,
boîtes mesurées des fichiers glTF, union des enfants pour un groupe), jamais de coordonnées propres à une scène.

| Type | Effet | Options |
|---|---|---|
| `ON` | posé sur le dessus de la cible, contenu dans sa surface | `x`, `z` (position sur la surface), `yaw` |
| `INSIDE` | au sol de la cible (dessus de son sol s'il existe), à l'intérieur | `x`, `z`, `gap` (marge), `yaw` |
| `CENTERED_IN` | au centre de la cible, au sol | `yaw` |
| `NEXT_TO` | au sol, à côté, sans contact ; `side: "auto"` choisit le premier côté libre | `side` (`front`/`back`/`left`/`right`/`auto`), `gap` (défaut 0,10 m), `offset`, `face` (`target`/`same`/`away`) |
| `AGAINST` | dos plaqué contre la face de la cible la plus proche (ou `side`) | `side`, `offset` (le long de la face), `gap` |
| `FACING` | tourné vers la cible, sans bouger | — |
| `ATTACHED_TO` | devient enfant d'un mur, centré dans son épaisseur, percé dans le mur (portes / fenêtres) | `offset` (le long du mur), `height` (allège) |
| `ALONG` | posé sur la cible, aligné sur son axe long (route, trottoir) | `t` (0 → 1 le long de l'axe), `offset` (latéral), `reverse`, `yaw` |

## Exemple

```json
[
  { "action": "CREATE_ROOM", "as": "room", "width": 6, "depth": 8, "height": 3,
    "doors": [{ "wall": "south", "offset": 1.5 }], "windows": [{ "wall": "east" }] },
  { "action": "ADD_OBJECT", "element": "desk", "as": "desk",
    "relation": { "type": "AGAINST", "target": "room.wall_north" } },
  { "action": "ADD_OBJECT", "element": "monitor", "relation": { "type": "ON", "target": "desk" } },
  { "action": "ADD_OBJECT", "assetId": "sheen-chair",
    "relation": { "type": "NEXT_TO", "target": "desk", "side": "front" } },
  { "action": "INSTANTIATE_PREFAB", "prefabId": "living-corner",
    "relation": { "type": "AGAINST", "target": "room.wall_west" } }
]
```

## Validation

`validatePlacement(doc, id)` → `OK` / `WARNING` / `INVALID` avec raisons (« « Chaise » chevauche « Bureau » à 42 % »,
« flotte à 0.40 m sans appui », « n'est fixé à aucun mur », « passe sous le sol »).
`validateScene(doc)` ajoute : transformations invalides, échelle nulle, asset manquant, modèle non chargé, parent cassé.
Un générateur pourra boucler : produire → valider → corriger, sans jamais toucher au rendu.

## Ce qui n'existe pas encore

Pas de LLM, pas de prompt, pas d'interprétation du langage naturel : seulement les primitives déterministes qu'un générateur
utilisera. La résolution de contraintes est locale (objet par objet) ; il n'y a pas d'optimisation globale d'agencement.
