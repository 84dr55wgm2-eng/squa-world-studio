# Assets 3D : pipeline et bibliothèque

## Ajouter un asset à la bibliothèque (sans toucher au code)

1. Créez un dossier dans `public/assets/library/`, par exemple `public/assets/library/wooden-table/`.
2. Déposez-y le modèle (`table.glb`) et, si possible, une miniature (`thumb.jpg`, 320 × 240, format 4:3).
3. Ajoutez une entrée dans `public/assets/library/library.json` :

```json
{
  "id": "wooden-table",
  "name": "Table en bois",
  "category": "props.furniture",
  "modelUrl": "wooden-table/table.glb",
  "thumbnailUrl": "wooden-table/thumb.jpg",
  "tags": ["table", "mobilier", "intérieur"],
  "defaultScale": 1,
  "pivot": "bottom-center",
  "defaultRotation": [0, 0, 0],
  "semanticRole": "furniture",
  "bounds": { "min": [-0.8, 0, -0.45], "max": [0.8, 0.75, 0.45] },
  "stats": { "meshes": 3, "triangles": 12000, "materials": 2, "textures": 4, "fileSize": 850000 },
  "license": { "spdx": "CC0-1.0", "author": "Nom de l'auteur", "sourceUrl": "https://…" },
  "metadata": {}
}
```

`bounds` et `stats` se calculent sans navigateur : `python3 scripts/measure-glb.py public/assets/library/wooden-table/table.glb`.
Avec `bounds`, le moteur de placement connaît la taille du modèle **avant** de le télécharger (modèles de scène, commandes).
Pour alléger un fichier lourd sans toucher à la géométrie : `python3 scripts/optimize-glb.py entree.glb sortie.glb --max 1024`
(textures réduites et ré-encodées).

4. Déployez (ou rechargez la page). La carte apparaît dans la bonne catégorie. Une catégorie vide reste masquée.

| Champ | Obligatoire | Rôle |
|---|---|---|
| `id` | oui | identifiant stable et unique. Les scènes enregistrées le référencent (`lib:<id>`) : ne le changez plus. |
| `name` | oui | nom affiché |
| `category` | oui | une des catégories ci-dessous |
| `modelUrl` | oui | `.glb` ou `.gltf`, relatif au manifest, ou URL `https://` complète (le serveur doit autoriser le CORS). Variante `.glb.b64.txt` (même fichier encodé en base64) pour les hébergements qui ne servent pas les `.glb`. |
| `thumbnailUrl` | non | sans miniature, une carte neutre est affichée |
| `tags` | non | pour la future recherche et les filtres (`filterAssets`) |
| `defaultScale` | non (1) | échelle appliquée à l'insertion |
| `pivot` | non (`bottom-center`) | `bottom-center`, `center` ou `original` |
| `unitScale` | non (1) | 0.01 si le fichier est en centimètres, etc. |
| `orientation` | non (`[0,0,0]`) | correction en degrés, ex. `[-90, 0, 0]` pour un modèle « Z vers le haut » |
| `defaultRotation` | non (`[0,0,0]`) | rotation (degrés) à l'insertion |
| `semanticRole` | recommandé | rôle des instances (`furniture`, `vehicle`, `vegetation`…) : placement et validation |
| `bounds` | recommandé | boîte du fichier (unités du fichier) — voir `scripts/measure-glb.py` |
| `stats` | non | maillages, triangles, matériaux, textures, taille — affichés dans l'inspecteur avant chargement |
| `license` | recommandé | `spdx`, `author`, `sourceUrl`. Sans licence, un avertissement apparaît dans la console. |

**Catégories** : `primitives`, `architecture.buildings|floors|walls|doors|windows|stairs`,
`urban.roads|sidewalks|lighting|barriers`, `props.furniture|electronics|objects`, `nature.trees|plants`, `vehicles`,
`characters`, `lights`, `prefabs`, `cameras` (liste dans `src/assets/categories.ts`).

## Contenu actuel

- **16 modèles GLB** (Khronos glTF-Sample-Assets, CC0 / CC-BY 4.0 — détail et auteurs dans
  `public/assets/library/CREDITS.md`) : 3 chaises / sièges, 2 canapés, pouf, réfrigérateur vitré, radio, gourde,
  applique, lanterne sur potence, plante en pot, vase de fleurs, fenêtre à vitre brisée, voiture concept, camion, personnage.
- **16 éléments paramétriques** générés par l'éditeur (dimensions réelles modifiables) : dalle de sol, mur, porte,
  fenêtre, escalier, route, trottoir, volume de bâtiment, table, bureau, étagère, carton, écran, unité centrale,
  lampadaire, glissière béton. Ce sont des volumes d'étude propres, pas des modèles détaillés.
- **4 prefabs intégrés** : Poste de bureau, Poste de cybercafé, Coin salon, Coin de rue ; plus les prefabs de l'utilisateur.
- **Manque connu** : aucun arbre réaliste sous licence libre trouvé dans les sources accessibles ; pas de lit.

Une entrée invalide (id dupliqué, extension inconnue…) est ignorée avec un avertissement : elle ne bloque
jamais le reste de la bibliothèque.

**Recommandations** : modèles en mètres, axe Y vers le haut, moins de 10 Mo, textures ≤ 2048 px.
N'intégrez que des modèles dont la licence est vérifiée (CC0 ou CC-BY de préférence).

## Les trois sources d'un modèle

| Source | Exemple | Où sont les octets | Dans le `.squa` |
|---|---|---|---|
| `library` | carte de la bibliothèque | `public/assets/library/…` (servi par le site) | l'id et le chemin (`modelUrl`) |
| `url` | « Depuis une URL » | le serveur distant | l'URL |
| `file` | « Importer un modèle 3D », glisser un fichier sur la vue | navigateur (IndexedDB) | **le fichier lui-même**, en base64 dans `files`, pour que la scène se rouvre partout |

## Fonctionnement interne

- **`src/assets/assetCache.ts`** : chargement GLTFLoader (+ Meshopt). Un asset est chargé une seule fois.
  Chaque instance est un clone qui partage géométries, matériaux et textures. Un compteur de références
  libère les ressources GPU 60 s après la disparition de la dernière instance.
- **`src/core/bounds.ts`** : calcul pur des boîtes englobantes, du pivot, des dimensions et de la pose au sol.
- **`src/viewport/objects/ModelContent.tsx`** : l'affichage (pivot → orientation + unité → clone).
- Les lumières et caméras contenues dans un fichier sont ignorées, pour qu'elles n'éclairent pas la scène à l'insu de l'utilisateur.
- Les matériaux du fichier sont conservés tels quels (couleur, normal, rugosité, métal, émissif, et extensions
  PBR comme sheen ou transmission). Un éclairage d'environnement neutre, généré localement, leur donne des reflets.

## Import robuste

- **Draco** (`KHR_draco_mesh_compression`) : décodeur Google (Apache-2.0) servi depuis `public/decoders/draco/`,
  chargé seulement quand un fichier en a besoin.
- **Meshopt** : pris en charge.
- **Texture manquante** (un .gltf importé sans ses images) : le modèle s'affiche quand même, l'inspecteur indique
  « Chargé (incomplet) » et le nom des fichiers manquants.
- **Fichier trop lourd** : refus au-delà de 200 Mo (vérifié avant téléchargement quand le serveur donne la taille).
- **Chargement annulé** : si l'objet est supprimé (ou l'ajout annulé) pendant le téléchargement, la requête est interrompue.
- **Réseau / CORS / 404 / fichier corrompu** : état « error » avec un message clair ; l'objet reste sélectionnable.
- **Non pris en charge** : textures KTX2/Basis (message clair) ; formats FBX, OBJ, USDZ (convertir en GLB).
