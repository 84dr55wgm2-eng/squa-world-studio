# SQUA World Studio

Éditeur web de mondes et de scènes 3D, pensé pour le storytelling visuel.
**Version 0.3 : Phase 1 (noyau de l'éditeur) + Phase 2 (modèles 3D et bibliothèque) + Phase 3 (composition du monde).** Pas encore d'IA générative, de personnages animés ni d'animation.

## Mise en ligne

L'application est prévue pour être hébergée comme site statique sur Vercel, sans aucune variable d'environnement.
Voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md) : import du dépôt GitHub dans Vercel, puis « Deploy ».

## Développement local (optionnel)

Il faut Node.js 22.18 ou plus récent (série 22).

```bash
npm install
npm run dev        # ouvre http://localhost:5173
```

| Commande | Rôle |
|---|---|
| `npm run dev` | serveur de développement Vite |
| `npm run build` | vérification TypeScript complète + build de production (`dist/`) |
| `npm test` | tests unitaires du cœur (modèle, verrous, undo/redo, format JSON) sans navigateur |
| `npm run typecheck:core` | vérification TypeScript du cœur seul |

## Composition du monde (Phase 3)

- **Graphe sémantique** : chaque objet a un rôle (mur, sol, porte, fenêtre, mobilier, véhicule, végétation…), des tags, une provenance.
- **Groupes et hiérarchie** : grouper (⌘/Ctrl G), dégrouper (⇧⌘G), glisser une ligne de la hiérarchie dans une autre ; un groupe déplace, masque, verrouille, duplique et supprime son contenu. Clic répété dans la vue pour entrer dans un groupe.
- **Sélection multiple** : ⇧ / ⌘ / Ctrl + clic ; déplacer, tourner, grouper, dupliquer, masquer, verrouiller, supprimer, changer le matériau ensemble.
- **Aimantation** : grille 0,1 / 0,5 / 1 m, angles 5 / 15 / 45 / 90°, pose automatique sur la surface située dessous (sol, table…) et contre un mur proche.
- **Placement relationnel** : Sur, À côté de, Contre, Dans, Centré dans, Face à, Fixé à (porte / fenêtre dans un mur, qui se perce), Le long de (route) — calculé à partir des dimensions réelles.
- **Validation** : état OK / Attention / Invalide par objet (« « Chaise » chevauche « Bureau » à 42 % ») et validateur de scène (sol, collisions, assets, hiérarchie).
- **Modèles de scène** (Nouveau) : Scène vide, Pièce intérieure, Rue urbaine — composés d'objets ordinaires.
- **Prefabs** : 4 intégrés + « Enregistrer comme prefab » pour vos propres groupes.
- **Commandes structurées** (JSON) : l'API que produira la future IA — voir [docs/WORLD_COMMANDS.md](docs/WORLD_COMMANDS.md).
- **Bibliothèque** : 16 modèles GLB sous licence libre, 16 éléments paramétriques, recherche et tags ; inspecteur d'asset et matériaux (couleur, rugosité, métal, opacité, réinitialisation).

## Modèles 3D (Phase 2)

- Importer un `.glb`, ou un `.gltf` avec ses fichiers annexes (bouton « Importer un modèle 3D » ou glisser le fichier sur la vue). On peut aussi ajouter un modèle depuis une URL.
- Bibliothèque data-driven avec miniatures : `public/assets/library/library.json`. Voir [docs/ASSETS.md](docs/ASSETS.md) pour ajouter un asset.
- Pack de test : 6 modèles Khronos sous licence CC0 ou CC-BY 4.0 (crédits dans `public/assets/library/CREDITS.md`).
- Placement au sol devant la caméra, « Poser au sol », dimensions L × H × P, unité, pivot, correction d'orientation, ombres.
- Un modèle se sélectionne, se transforme, se duplique, se verrouille, se masque, se supprime, s'annule et s'enregistre comme n'importe quel objet. Les modèles importés sont intégrés au fichier `.squa`.

## Ce que fait la Phase 1

- **Scène** : scène vide avec une grille de référence, un fond, une lumière ambiante et un « soleil » réglables.
- **Objets** : cube, sphère, lumière ponctuelle, caméra, ajoutés au centre de la vue.
- **Sélection** : clic dans la vue ou dans la hiérarchie. Un clic dans le vide désélectionne. Un orbit ou un drag de gizmo ne change pas la sélection.
- **Gizmo** : déplacer (W), tourner (E), échelle (R). Un geste complet = une seule étape d'annulation.
- **Propriétés** : nom, visible, verrouillé, position, rotation (°), échelle. Aussi la couleur (primitives), l'intensité et la portée (lumière), le champ de vision (caméra), et les réglages de scène quand rien n'est sélectionné.
- **Actions** : supprimer, dupliquer, renommer (panneau ou double-clic dans la hiérarchie), masquer / afficher, verrouiller.
- **Verrouillage** : un objet verrouillé reste visible et sélectionnable. Il ne peut être ni déplacé, ni modifié, ni supprimé. Cette règle est appliquée dans le cœur, pas seulement dans l'interface.
- **Undo / redo** : toutes les modifications de la scène.
- **Caméras de scène** : « Voir depuis cette caméra » et « Placer sur la vue actuelle ».
- **Caméra de travail** : orbite, pan, zoom, vue par défaut (H), cadrer la sélection (F).
- **Sauvegarde** : « Enregistrer » télécharge un fichier `.squa` et « Ouvrir » le recharge (voir [docs/SCENE_FORMAT.md](docs/SCENE_FORMAT.md)). Une sauvegarde automatique locale restaure aussi la dernière scène après un rechargement de la page.

## Navigation

- Orbite : clic gauche.
- Pan : clic droit, ou ⇧ + clic gauche (pratique au trackpad).
- Zoom : molette ou pincement.

Le bouton « Raccourcis », en bas du viewport, affiche la liste complète.

## Architecture

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). En résumé, toute modification est une transaction de données, vérifiée (verrous) puis appliquée par un cœur TypeScript pur, avec son inverse exact pour l'undo. C'est ce qui permettra plus tard à l'IA de faire des modifications locales et contrôlées.
