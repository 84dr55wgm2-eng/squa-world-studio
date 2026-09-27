# Architecture — SQUA World Studio (Phase 1 : noyau · Phase 2 : assets)

## Principe

```
 Interface (React)        Viewport (React Three Fiber)
   │  clic, champ, raccourci     │  clic 3D, gizmo
   ▼                             ▼
 ┌─────────────────────────────────────────────┐
 │  store/editorStore.ts  (Zustand)            │
 │  execute(transaction) · undo · redo · select│
 └───────────────┬─────────────────────────────┘
                 ▼
 ┌─────────────────────────────────────────────┐
 │  core/  (TypeScript pur, aucune dépendance) │
 │  commandes → Transaction (données JSON)     │
 │  locks : vérification du verrouillage       │
 │  operations : application + inverse exact   │
 │  history : undo / redo / fusion             │
 │  serialization : format .squa.json          │
 └─────────────────────────────────────────────┘
```

**Toute modification de la scène est une `Transaction`** : une liste d'opérations JSON (`insert`, `delete`, `update`,
`settings`, `project`). Qu'elle vienne d'un clic, d'un raccourci ou — plus tard — de l'IA, elle suit le même chemin :

1. une commande (`core/commands.ts`) construit la transaction à partir de l'état courant ;
2. `executeTransaction` (`core/locks.ts`) vérifie chaque opération (verrous, existence, type) puis l'applique — tout ou rien ;
3. chaque opération renvoie son **inverse exact**, stocké dans l'historique → undo/redo sans cas particulier ;
4. le store remplace le document ; seuls les composants abonnés aux objets modifiés se re-rendent.

### Pourquoi c'est important pour la suite

- **IA « Prompt to World » / édition par prompt** : l'IA produira une `Transaction` (données contrôlées), pas du code
  Three.js. Une demande locale (« ajoute deux ordinateurs sur le bureau de gauche ») = quelques opérations `insert`/`update`,
  jamais une reconstruction de la scène.
- **Verrouillage** : il est appliqué dans le cœur, donc aucune source (UI, IA, script) ne peut le contourner. Le verrou est
  hérité des parents (`isEffectivelyLocked`) : verrouiller un futur groupe « Architecture » protégera tout son contenu.
- **Undo/redo** : l'historique ne stocke que des différences, pas des copies de la scène.

## Arborescence

```
src/
  core/                 TypeScript pur — testé sans navigateur (npm test)
    types.ts            modèle de données (SceneDocument, SceneObject, Transform…)
    factory.ts          valeurs par défaut, création d'objets, noms uniques
    scene.ts            requêtes (sous-arbre, verrou/visibilité effectifs…)
    operations.ts       opérations atomiques + inverses
    locks.ts            règles de verrouillage + executeTransaction
    history.ts          undo / redo / fusion des modifications continues
    commands.ts         commandes de haut niveau (ajouter, dupliquer, renommer…)
    serialization.ts    sauvegarde / chargement / validation / migrations
    __tests__/          tests unitaires (node:test)
    bounds.ts           boîtes englobantes, pivot, dimensions, pose au sol (calcul pur)
  assets/               pipeline de modèles 3D (voir docs/ASSETS.md)
    manifest.ts         format du manifest de bibliothèque + filtres (pur, testé)
    categories.ts       taxonomie de la bibliothèque
    library.ts          chargement du manifest au démarrage
    libraryEntries.ts   entrées affichées (intégrés, bibliothèque, importés) et ajout
    assetCache.ts       chargement GLTF, cache partagé, compteur de références, libération GPU
    assetStatus.ts      état de chargement par asset (non sauvegardé)
    assetActions.ts     ajout à la scène (placement au sol), import fichier / URL
    fileStore.ts        fichiers importés : mémoire + IndexedDB, empreinte SHA-256, base64
  store/
    editorStore.ts      état global (document, historique, sélection, outil, notifications)
  viewport/
    Viewport.tsx        Canvas R3F, environnement, grille, OrbitControls, repère d'axes
    objects/            rendu d'un objet (ObjectNode), visuel des caméras, instance de modèle (ModelContent)
    TransformGizmo.tsx  gizmo + validation d'un geste = une transaction
    cameraController.ts caméra de travail : vue par défaut, cadrage, vue caméra
    objectRegistry.ts   id → Object3D (sans stocker Three.js dans le store)
    interactionGuard.ts évite les conflits gizmo / clic de sélection
    sharedResources.ts  géométries partagées (une seule instance GPU par forme)
  editor/               interface : barre supérieure, panneaux, champs, raccourcis
  io/                   fichiers .squa.json, sauvegarde automatique locale
  app/App.tsx           mise en page uniquement
```

## Décisions techniques

| Sujet | Choix | Raison |
|---|---|---|
| Rendu | `frameloop="demand"` | aucune image calculée au repos (batterie du MacBook) |
| Re-rendus | un composant par objet, abonné à son seul objet | modifier 1 objet sur 500 ne re-rend qu'un nœud |
| Gizmo | Three.js modifie l'objet pendant le geste, une transaction au relâchement | pas de re-rendu React à chaque mouvement, 1 undo par geste |
| Gizmo vs caméra | OrbitControls `makeDefault` (désactivés par Drei pendant le drag) + garde anti-clic | pas de rotation de vue ni de désélection pendant/après un drag |
| Géométries | partagées (`sharedResources.ts`) | pas de duplication GPU |
| Rotations | degrés dans le document, radians uniquement au rendu | format lisible par l'humain et l'IA |
| Champs numériques | brouillon local, validation à Entrée / sortie du champ | 1 saisie = 1 undo, virgule décimale acceptée |
| Tests du cœur | `node --test` avec suppression native des types | aucune dépendance de test à installer |

## Modèles 3D (Phase 2)

- **Même système d'objets** : un modèle est un `SceneObject` de type `model` qui référence une entrée de la table
  `doc.assets`. Ajout, transformation, duplication, verrou, visibilité, suppression, undo/redo et sauvegarde passent par
  les mêmes transactions que les primitives. Ajouter une première instance enregistre aussi l'asset dans la même
  transaction, donc un seul undo retire les deux.
- **Une donnée, plusieurs instances** : `assetCache` charge chaque asset une fois. Les instances sont des clones qui
  partagent géométries, matériaux et textures. Une duplication ne refait aucune requête réseau.
- **Normalisation non destructive** : pivot, orientation et unité sont des décalages d'affichage calculés par
  `core/bounds.ts` à partir de la boîte englobante du fichier (mesurée au chargement).
- **Pannes isolées** : un asset qui ne charge pas passe à l'état « error ». L'objet reste dans la scène (repère rouge,
  icône d'alerte, message), et le reste de l'éditeur n'est pas affecté.
- **Rendu** : ombres du soleil (une seule lumière avec ombres, carte 2048), sol récepteur d'ombres invisible, et
  éclairage d'environnement neutre généré localement (RoomEnvironment), sans fichier HDR à télécharger.

## Points d'extension préparés (non implémentés)

- **Recherche, favoris, tags, filtres** : `filterAssets()` (manifest.ts) filtre déjà par catégorie, texte et tags ;
  il manque l'interface.
- **Grandes bibliothèques** : plusieurs manifests (ou un manifest distant) peuvent être fusionnés dans `library.ts`.
- **Instancing GPU** (milliers d'arbres, de chaises…) : `ModelContent` est le seul endroit à adapter.
- **Groupes** : le cœur gère déjà `parentId`/`children` ; il manque l'UI (créer un groupe, glisser-déposer dans la hiérarchie)
  et la conversion de transform lors d'un changement de parent.
- **Caméra** : `cameraController.ts` centralise la caméra de travail (FPS, focale, profondeur de champ, trajectoires viendront ici) ;
  les objets `camera` stockent déjà `fov`, `near`, `far`.
- **Multi-sélection** : `selectedId` est unique aujourd'hui ; passer à une liste touchera le store, le gizmo et les panneaux.
