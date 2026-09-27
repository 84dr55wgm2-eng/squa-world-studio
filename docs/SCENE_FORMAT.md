# Format de scène SQUA World Studio — `.squa.json` (v2)

Ce format est le format interne de SQUA World Studio. Il est conçu pour être :

- **lisible** par un humain et par une IA (JSON indenté, angles en degrés, couleurs hexadécimales) ;
- **stable** : un en-tête `format` + `version` permet des migrations futures (`migrate()` dans `src/core/serialization.ts`) ;
- **validé** au chargement : un fichier incohérent est refusé avec un message clair, jamais chargé à moitié.

## Exemple

```json
{
  "format": "squa-world-studio/scene",
  "version": 2,
  "savedAt": "2026-09-27T20:15:00.000Z",
  "project": { "name": "Cybercafé Lagos", "createdAt": "…", "updatedAt": "…" },
  "settings": { "background": "#1c1e23", "ambientIntensity": 0.5, "sunIntensity": 1.5, "environmentIntensity": 0.6, "shadows": true, "gridVisible": true },
  "rootIds": ["obj_a1b2c3d4e5f6", "obj_k3x9f0q2m7ab"],
  "objects": [
    {
      "id": "obj_a1b2c3d4e5f6",
      "name": "Comptoir",
      "type": "box",
      "parentId": null,
      "children": [],
      "transform": { "position": [-2, 0.5, 0], "rotation": [0, 45, 0], "scale": [3, 1, 1] },
      "visible": true,
      "locked": true,
      "tags": ["mobilier"],
      "metadata": {},
      "material": { "color": "#8a5a3c" }
    },
    {
      "id": "obj_k3x9f0q2m7ab",
      "name": "Caméra",
      "type": "camera",
      "parentId": null,
      "children": [],
      "transform": { "position": [0, 1.6, 7], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
      "visible": true,
      "locked": false,
      "tags": [],
      "metadata": {},
      "camera": { "fov": 35, "near": 0.1, "far": 1000 }
    },
    {
      "id": "obj_7h2k9d0s1a3q",
      "name": "Chaise damassée",
      "type": "model",
      "parentId": null,
      "children": [],
      "transform": { "position": [1, 0, -2], "rotation": [0, 90, 0], "scale": [1, 1, 1] },
      "visible": true,
      "locked": false,
      "tags": [],
      "metadata": {},
      "model": { "assetId": "lib:chair-damask", "pivot": "bottom-center", "orientation": [0, 0, 0], "unitScale": 1, "castShadow": true, "receiveShadow": true }
    }
  ],
  "assets": [
    {
      "id": "lib:chair-damask",
      "name": "Chaise damassée",
      "category": "props.furniture",
      "source": { "kind": "library", "libraryId": "chair-damask", "modelUrl": "assets/library/chair-damask/ChairDamaskPurplegold.glb" },
      "license": { "spdx": "CC-BY-4.0", "author": "Eric Chadwick", "sourceUrl": "https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ChairDamaskPurplegold" }
    }
  ],
  "files": {}
}
```

(`rootIds` liste les trois objets ; l'exemple est abrégé.)

## Conventions

| Élément | Convention |
|---|---|
| Unités | 1 unité = 1 mètre, axe **Y vers le haut** |
| `transform.rotation` | angles d'Euler en **degrés**, ordre **XYZ** |
| `transform.position` | relative au parent (`parentId`), ou au monde si `parentId` est `null` |
| Couleurs | `"#rrggbb"` |
| `id` | unique, stable, jamais réutilisé (`obj_` + 12 caractères) |

## Champs communs à tous les objets

| Champ | Type | Rôle |
|---|---|---|
| `id` | string | identifiant unique |
| `name` | string | nom affiché |
| `type` | `"box"` \| `"sphere"` \| `"light"` \| `"camera"` \| `"model"` | nature de l'objet |
| `parentId` | string \| null | parent dans la hiérarchie |
| `children` | string[] | ordre des enfants |
| `transform` | `{ position, rotation, scale }` | voir conventions |
| `visible` | boolean | affiché ou masqué |
| `locked` | boolean | verrouillé : ni transformation, ni modification, ni suppression (s'applique aussi aux descendants) |
| `tags` | string[] | libre (catégorisation future, IA) |
| `metadata` | object | libre et sérialisable (ex. futur `metadata.ai`) |

## Champs spécifiques

| Type | Champ | Contenu |
|---|---|---|
| `box`, `sphere` | `material` | `{ color }` — cube de 1 m, sphère de 1 m de diamètre, dimensionnés par `scale` |
| `light` | `light` | `{ kind: "point", color, intensity (candela), distance (0 = infinie) }` |
| `camera` | `camera` | `{ fov (degrés, vertical), near, far }` — regarde vers −Z local |
| `model` | `model` | `{ assetId, pivot, orientation, unitScale, castShadow, receiveShadow }` — voir ci-dessous |

## Modèles 3D (depuis la v2)

Un objet `model` est une **instance** : il référence une entrée de la table `assets` par `assetId`.
Plusieurs instances partagent le même asset (chargé une seule fois).

| Champ de `model` | Rôle (non destructif : le fichier d'origine n'est jamais modifié) |
|---|---|
| `pivot` | `bottom-center` (centre bas de la boîte englobante), `center`, ou `original` (celui du fichier) |
| `orientation` | correction en degrés appliquée au fichier, ex. `[-90, 0, 0]` pour un export « Z vers le haut » |
| `unitScale` | conversion vers le mètre : 1 (m), 0.01 (cm), 0.001 (mm), 0.0254 (pouce) |
| `castShadow` / `receiveShadow` | ombres |

Table `assets` — chaque entrée : `id`, `name`, `category` (optionnel), `license` (optionnel), et une `source` :

| `source.kind` | Champs | Rechargement |
|---|---|---|
| `library` | `libraryId`, `modelUrl` (relatif à l'application) | depuis le site |
| `url` | `url` (https, CORS autorisé) | depuis le serveur distant |
| `file` | `mainFile`, `files: [{ name, hash, size }]` | depuis `files` (intégré au fichier) ou le stockage du navigateur |

`files` contient, pour chaque empreinte SHA-256, `{ name, size, data }` (contenu en base64) : une scène avec
des modèles importés reste **autonome** et se rouvre sur n'importe quel appareil. La sauvegarde automatique
du navigateur n'intègre pas ces octets (ils restent dans IndexedDB).

Seuls les assets utilisés par au moins un objet sont écrits. Un objet `model` dont l'asset est absent du
fichier fait refuser le chargement. Un asset présent mais **inaccessible** (fichier supprimé du site,
serveur distant hors ligne) est chargé quand même : l'objet reste sélectionnable, modifiable et supprimable,
et affiche « Impossible de charger cet asset. ».

## Hiérarchie

`rootIds` donne l'ordre des objets racine ; chaque objet liste ses `children`. `objects` est écrit dans l'ordre de parcours
(parent avant enfants). Au chargement, on vérifie que `parentId`, `children` et `rootIds` forment un arbre sans cycle et sans
objet orphelin.

L'interface ne crée pas encore de groupes, mais le cœur (insertion, suppression, duplication, verrouillage hérité) gère déjà
les enfants et c'est testé.

## Règles de chargement

- `format` différent ou JSON invalide → refus.
- `version` supérieure à la version connue → refus (« créé par une version plus récente »).
- `version` 1 → migration automatique vers la v2 (table `assets` vide, nouveaux réglages par défaut).
- Type d'objet inconnu, transform invalide, identifiant dupliqué, hiérarchie incohérente → refus.
- Champs optionnels manquants (`visible`, `locked`, `tags`, `metadata`, `material`…) → valeur par défaut + avertissement.

## Évolutions prévues (non implémentées)

- Type `group` (conteneur), caméras enregistrées / plans (`shots`), timeline d'animation.
- Chaque ajout passera par une nouvelle `version` et une fonction de migration.
