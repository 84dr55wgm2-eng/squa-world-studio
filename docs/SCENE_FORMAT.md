# Format de scène SQUA World Studio — `.squa` (schéma v3)

Un fichier `.squa` est un document **JSON UTF-8**. Il est conçu pour être :

- **lisible** par un humain et par une IA (JSON indenté, angles en degrés, couleurs hexadécimales, rôles sémantiques explicites) ;
- **stable et migrable** : `format` + `schemaVersion` ; `migrate()` (`src/core/serialization.ts`) convertit les anciennes versions ;
- **validé** au chargement : un fichier incohérent est refusé avec un message clair, jamais chargé à moitié.

Les fichiers `.squa.json` des versions précédentes (v1, v2) s'ouvrent toujours et sont convertis automatiquement.

## Structure

```json
{
  "format": "squa-world-studio/scene",
  "schemaVersion": 3,
  "savedAt": "2026-09-28T09:00:00.000Z",
  "project": { "name": "Pièce intérieure", "createdAt": "…", "updatedAt": "…" },
  "environment": { "background": "#1c1e23", "ambientIntensity": 0.5, "sunIntensity": 1.5, "environmentIntensity": 0.6, "shadows": true, "gridVisible": true },
  "rootIds": ["obj_room…", "obj_desk…"],
  "objects": [ … ],
  "assets": [ … ],
  "groups": ["obj_room…", "obj_desk…"],
  "cameras": ["obj_cam…"],
  "metadata": { "template": "interior-room" },
  "files": { }
}
```

| Clé | Contenu |
|---|---|
| `project` | nom, dates de création / modification |
| `environment` | fond, lumière ambiante, soleil, reflets, ombres, grille (s'appelait `settings` en v1/v2) |
| `rootIds` | ordre des objets racine |
| `objects` | tous les objets, dans l'ordre de parcours (parent avant enfants) — le **graphe de scène** |
| `assets` | table des assets utilisés (séparée des objets : une instance référence un asset par `assetId`) |
| `groups`, `cameras` | index de lecture (identifiants des groupes et des caméras), recalculés à chaque enregistrement |
| `metadata` | libre (ex. modèle d'origine, futur prompt d'une génération IA) |
| `files` | contenu base64 des modèles importés depuis l'ordinateur (scène autonome) |

## Conventions

| Élément | Convention |
|---|---|
| Unités | 1 unité = 1 mètre, axe **Y vers le haut** |
| `transform.rotation` | angles d'Euler en **degrés**, ordre **XYZ** |
| `transform.position` | relative au parent (`parentId`), ou au monde si `parentId` est `null` |
| Face avant d'un objet | **+Z local** (un objet « tourné vers » X a le lacet qui amène +Z vers X) |
| Couleurs | `"#rrggbb"` |
| `id` | unique, stable, jamais réutilisé (`obj_` + 12 caractères) |

## Objet (nœud du graphe sémantique)

| Champ | Type | Rôle |
|---|---|---|
| `id`, `name` | string | identifiant, nom affiché |
| `type` | `box` \| `sphere` \| `light` \| `camera` \| `model` \| `element` \| `group` | nature technique |
| `semanticRole` | voir ci-dessous | **ce que l'objet est dans le monde** (utilisé par le placement et la validation) |
| `category` | string (optionnel) | catégorie de bibliothèque, ex. `props.furniture` |
| `tags` | string[] | libres |
| `parentId`, `children` | hiérarchie | un parent déplace / masque / verrouille / duplique / supprime ses enfants |
| `transform` | `{ position, rotation, scale }` | local au parent |
| `visible`, `locked` | boolean | hérités par les descendants |
| `placement` | `{ support?, allowFloating?, allowOverlapWith? }` (optionnel) | surcharge des règles du rôle |
| `relation` | `{ type, targetId, params? }` (optionnel) | dernière relation spatiale appliquée (ex. `ATTACHED_TO` un mur) |
| `source` | `{ kind: user\|template\|prefab\|composer\|import\|ai, ref? }` (optionnel) | provenance |
| `metadata` | object | libre |

Rôles (`semanticRole`) : `building`, `wall`, `floor`, `ceiling`, `door`, `window`, `stairs`, `road`, `sidewalk`, `barrier`,
`furniture`, `vehicle`, `vegetation`, `prop`, `electronics`, `light`, `camera`, `character`, `room`, `group`.
Chaque rôle a des règles par défaut (`src/core/semantics.ts`) : appui attendu (sol, surface, mur, aucun), droit de flotter,
rôles avec lesquels un chevauchement est normal (une porte dans un mur, une voiture sur une route…).

## Champs spécifiques

| Type | Champ | Contenu |
|---|---|---|
| `box`, `sphere` | `material` | `{ color, roughness, metalness, opacity }` — cube de 1 m / sphère de 1 m de diamètre, dimensionnés par `scale` |
| `element` | `element` | `{ shape, size: [largeur, hauteur, profondeur] (m), params, material }` — élément paramétrique, pivot au centre de la base |
| `group` | — | conteneur (sa boîte = union de ses enfants) |
| `light` | `light` | `{ kind: "point", color, intensity (candela), distance (0 = infinie) }` |
| `camera` | `camera` | `{ fov (degrés, vertical), near, far }` — regarde vers −Z local |
| `model` | `model` | `{ assetId, pivot, orientation, unitScale, castShadow, receiveShadow, materialOverride? }` |

Formes d'éléments (`element.shape`) : `slab`, `wall`, `door`, `window`, `stairs`, `road`, `sidewalk`, `building`, `table`,
`desk`, `shelf`, `box`, `monitor`, `computer`, `streetlight`, `barrier` (paramètres : `src/core/elements.ts`).
Une porte ou une fenêtre **enfant** d'un mur perce ce mur (ouverture calculée à l'affichage).

`model.materialOverride` : `{ color?, roughness?, metalness?, opacity? }` appliqué à cette instance uniquement ;
absent = matériaux d'origine du fichier glTF, conservés tels quels.

## Table `assets`

`id`, `name`, `category?`, `license?` (`spdx`, `author`, `sourceUrl?`), `bounds?` (boîte du fichier, unités du fichier),
`semanticRole?`, et une `source` :

| `source.kind` | Champs | Rechargement |
|---|---|---|
| `library` | `libraryId`, `modelUrl` (relatif à l'application) | depuis le site |
| `url` | `url` (https, CORS autorisé) | depuis le serveur distant |
| `file` | `mainFile`, `files: [{ name, hash, size }]` | depuis `files` (intégré au fichier) ou le stockage du navigateur |

Seuls les assets utilisés sont écrits. Un objet `model` dont l'asset est absent du fichier fait refuser le chargement.
Un asset présent mais inaccessible est chargé quand même : l'objet reste sélectionnable et affiche l'erreur.

## Règles de chargement

- `format` différent ou JSON invalide → refus.
- `schemaVersion` supérieure à la version connue → refus (« créé par une version plus récente »).
- v1 → v2 (table `assets`), v2 → v3 (`settings` → `environment`, `metadata`, rôles par défaut) : automatique, un seul avertissement.
- Type ou rôle inconnu, transform invalide, identifiant dupliqué, hiérarchie incohérente (cycle, orphelin) → refus.
- Champs optionnels manquants → valeur par défaut.

## Évolutions prévues (non implémentées)

Plans et séquences de caméra, timeline d'animation, personnages : chacun passera par un nouveau `schemaVersion` et une migration.
