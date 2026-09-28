# Crédits des modèles 3D

Les 16 modèles GLB de la bibliothèque proviennent tous du dépôt officiel **Khronos glTF-Sample-Assets**
(<https://github.com/KhronosGroup/glTF-Sample-Assets>). Leurs licences autorisent la réutilisation,
y compris commerciale. Pour CC-BY 4.0, l'auteur doit être crédité (ce fichier et la fiche de l'asset dans l'éditeur).

| Asset (id) | Fichier d'origine | Licence | Auteur(s) | Modifié |
|---|---|---|---|---|
| `chair-damask` | ChairDamaskPurplegold.glb | CC-BY-4.0 | Eric Chadwick | non |
| `velvet-sofa` | GlamVelvetSofa.glb | CC-BY-4.0 | Eric Chadwick | non |
| `vase-flowers` | GlassVaseFlowers.glb | CC0-1.0 | Eric Chadwick, Rico Cilliers | non |
| `broken-window` | GlassBrokenWindow.glb | CC-BY-4.0 | Eric Chadwick | non |
| `milk-truck` | CesiumMilkTruck.glb | CC-BY-4.0 (logo Cesium : marque) | Cesium | non |
| `cesium-man` | CesiumMan.glb | CC-BY-4.0 (logo Cesium : marque) | Cesium | non |
| `sheen-chair` | SheenChair.glb | CC0-1.0 | Eric Chadwick | textures réduites |
| `leather-sofa` | SheenWoodLeatherSofa.glb | CC-BY-4.0 (maillage d'origine CC0, Fran Calvente) | Eric Chadwick | non (textures WebP déjà compressées) |
| `silk-pouf` | SpecularSilkPouf.glb | CC-BY-4.0 | Eric Chadwick | textures réduites |
| `refrigerator` | CommercialRefrigerator.glb | CC-BY-4.0 | Eric Chadwick, Sean Thomas | textures réduites |
| `boombox` | BoomBox.glb | CC0-1.0 | Microsoft | textures réduites |
| `water-bottle` | WaterBottle.glb | CC0-1.0 | Microsoft | textures réduites |
| `barn-lamp` | AnisotropyBarnLamp.glb | CC-BY-4.0 | Eric Chadwick | textures réduites |
| `lantern` | Lantern.glb | CC0-1.0 | sbtron, Frank Galligan | textures réduites |
| `plant` | DiffuseTransmissionPlant.glb | CC-BY-4.0 (maillage d'origine CC0, Rico Cilliers) | Eric Chadwick | textures réduites |
| `car-concept` | CarConcept.glb | CC-BY-4.0 (logo Khronos : marque) | Eric Chadwick | textures réduites |

« Textures réduites » : `scripts/optimize-glb.py` ramène les images au plus à 1024 px et ré-encode en JPEG
(qualité 85) celles sans transparence. Géométrie, matériaux et hiérarchie sont inchangés.

Échelle : `boombox` (fichier en unités ≈ 1/25 m) et `lantern` (≈ 10 unités par mètre) ont une conversion
d'unités dans `library.json` (`unitScale`), le fichier n'est pas modifié.

Boîtes englobantes et statistiques (`bounds`, `stats` dans `library.json`) : mesurées par
`scripts/measure-glb.py` à partir des accesseurs glTF (même calcul que three.js).

Les miniatures `thumb.jpg` sont des rendus de ces modèles réalisés dans SQUA World Studio.

Page de chaque modèle : `https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/<Fichier d'origine sans .glb>`.

## Éléments paramétriques (non fichiers)

Murs, sols, portes, fenêtres, escaliers, routes, trottoirs, volumes de bâtiments, table, bureau, étagère,
carton, écran, unité centrale, lampadaire, glissière : géométrie générée par SQUA World Studio à partir
de dimensions réelles (code du projet, pas de licence tierce). Ce sont des volumes d'étude propres, pas
des modèles détaillés.
