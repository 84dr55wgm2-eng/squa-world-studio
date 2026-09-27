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
  "license": { "spdx": "CC0-1.0", "author": "Nom de l'auteur", "sourceUrl": "https://…" },
  "metadata": {}
}
```

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
| `license` | recommandé | `spdx`, `author`, `sourceUrl`. Sans licence, un avertissement apparaît dans la console. |

**Catégories** : `primitives`, `architecture.buildings`, `architecture.walls`, `architecture.doors`,
`architecture.windows`, `props.furniture`, `props.electronics`, `props.objects`, `nature.trees`,
`nature.plants`, `vehicles`, `characters`, `lights`, `cameras` (liste dans `src/assets/categories.ts`).

Une entrée invalide (id dupliqué, extension inconnue…) est ignorée avec un avertissement : elle ne bloque
jamais le reste de la bibliothèque.

**Recommandations** : modèles en mètres, axe Y vers le haut, moins de 10 Mo, textures ≤ 2048 px.
N'intégrez que des modèles dont la licence est vérifiée (CC0 ou CC-BY de préférence).

## Les trois sources d'un modèle

| Source | Exemple | Où sont les octets | Dans le `.squa.json` |
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

## Formats non pris en charge (message clair à l'import)

- Compression Draco (`KHR_draco_mesh_compression`) et textures KTX2/Basis : il faudrait héberger les
  décodeurs. Ce sera ajouté quand la bibliothèque en aura besoin.
- Les autres formats (FBX, OBJ, USDZ) : il faut d'abord les convertir en GLB (Blender, par exemple).
