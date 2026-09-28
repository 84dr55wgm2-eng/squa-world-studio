# Architecture — SQUA World Studio (Phase 1 : noyau · Phase 2 : assets · Phase 3 : composition du monde)

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
 │  serialization : format .squa (schéma v3)   │
 │  spatial · placement · validation           │
 │  worldCommands : API JSON (future IA)       │
 └─────────────────────────────────────────────┘
```

**Toute modification de la scène est une `Transaction`** : une liste d'opérations JSON (`insert`, `delete`, `update`,
`move` (changement de parent), `settings`, `project`, `asset`, `docMetadata`). Qu'elle vienne d'un clic, d'un raccourci ou — plus tard — de l'IA, elle suit le même chemin :

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
    math.ts             matrices 4×4, transforms monde ↔ local à travers la hiérarchie
    semantics.ts        rôles sémantiques et leurs règles de placement
    elements.ts         éléments paramétriques (murs, sols, portes, fenêtres, routes…) : dimensions, paramètres
    spatial.ts          boîtes locales/monde de tout objet (groupes compris), empreintes, chevauchements
    placement.ts        moteur de relations (ON, INSIDE, NEXT_TO, AGAINST, CENTERED_IN, FACING, ATTACHED_TO, ALONG), aimantation
    validation.ts       validatePlacement (OK / WARNING / INVALID) et validateScene
    hierarchy.ts        grouper, dégrouper, reparenter, actions sur plusieurs objets, matériaux, placement
    worldCommands.ts    API de commandes JSON → une transaction (docs/WORLD_COMMANDS.md)
    templates.ts        modèles de scène et prefabs intégrés (scripts de commandes)
  assets/               pipeline de modèles 3D (voir docs/ASSETS.md)
    manifest.ts         format du manifest de bibliothèque + filtres (pur, testé)
    categories.ts       taxonomie de la bibliothèque
    library.ts          chargement du manifest au démarrage
    libraryEntries.ts   entrées affichées (intégrés, bibliothèque, importés) et ajout
    assetCache.ts       chargement GLTF, cache partagé, compteur de références, libération GPU
    assetStatus.ts      état de chargement par asset (non sauvegardé)
    assetActions.ts     ajout à la scène (placement au sol), import fichier / URL
    fileStore.ts        fichiers importés : mémoire + IndexedDB, empreinte SHA-256, base64
  world/                lien entre le cœur et l'application
    worldContext.ts     boîtes mesurées, bibliothèque, prefabs → contexte du moteur de placement
    worldActions.ts     commandes, modèles, prefabs, aimantation aux surfaces, matériaux
    prefabStore.ts      prefabs de l'utilisateur (navigateur)
  store/
    editorStore.ts      état global (document, historique, sélection multiple, aimantation, notifications)
  viewport/
    Viewport.tsx        Canvas R3F, environnement, grille, OrbitControls, repère d'axes
    objects/            rendu d'un objet (ObjectNode), caméras, modèles (ModelContent), éléments (ElementContent,
                        elementGeometry : géométries fusionnées et partagées, murs percés par leurs ouvertures)
    TransformGizmo.tsx  gizmo (un ou plusieurs objets, grille, angles, aimantation) — un geste = une transaction
    cameraController.ts caméra de travail : vue par défaut, cadrage, vue caméra
    objectRegistry.ts   id → Object3D (sans stocker Three.js dans le store)
    interactionGuard.ts évite les conflits gizmo / clic de sélection
    sharedResources.ts  géométries partagées (une seule instance GPU par forme)
  editor/               interface : barre supérieure, panneaux, champs, raccourcis
  io/                   fichiers .squa, sauvegarde automatique locale
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

## Composition du monde (Phase 3)

- **Graphe sémantique** : chaque objet porte un `semanticRole` (mur, porte, mobilier, véhicule…), une catégorie, des tags,
  une provenance et, s'il a été placé par relation, la relation elle-même. Les règles de chaque rôle (appui attendu,
  chevauchements normaux) sont dans `core/semantics.ts`, pas dans l'interface.
- **Groupes** : type `group`. Changer de parent conserve la position à l'écran (`reparentOps` recalcule le transform local
  via les matrices monde). Verrou et visibilité sont hérités. Clic dans la vue : le groupe d'abord, puis un niveau plus
  profond à chaque clic.
- **Boîtes fiables** : `core/spatial.ts` calcule la boîte de n'importe quel objet (élément : dimensions ; modèle : boîte
  du fichier, mesurée hors ligne dans le manifest puis au chargement ; groupe : union des enfants) en monde, orientée
  (lacet) et alignée. Largeur / hauteur / profondeur / centre / base / sommet en découlent. Aucune constante arbitraire.
- **Placement** : `core/placement.ts` résout 8 relations à partir de ces boîtes (projections exactes des boîtes
  orientées). `NEXT_TO` en mode automatique essaie les quatre côtés et garde le premier sans collision.
- **Validation** : chevauchement mesuré en volume (empreintes orientées découpées par Sutherland–Hodgman × intervalle
  vertical) ; < 5 % ignoré (contact), 5–50 % WARNING, > 50 % ou imbrication INVALID ; exceptions par rôle.
- **Commandes** : `core/worldCommands.ts` (voir docs/WORLD_COMMANDS.md). Les modèles de scène et prefabs intégrés sont des
  scripts de commandes, exécutés par le même moteur : aucune scène n'est codée en dur.
- **Éléments paramétriques** : géométrie générée (boîtes et cylindres fusionnés en une géométrie par matériau),
  partagée entre éléments identiques, libérée quand plus personne ne l'utilise.
- **Sélection multiple** : `selectedIds` + sélection principale ; le gizmo agit sur un pivot au centre et applique la même
  transformation monde à chaque objet ; un seul undo.

## Points d'extension préparés (non implémentés)

- **Prompt-to-World** : un générateur produira des `WorldCommand[]`, exécutera `runWorldCommands`, lira `validateScene`
  et corrigera ; rien à changer dans le rendu.
- **Grandes bibliothèques** : plusieurs manifests (ou un manifest distant) peuvent être fusionnés dans `library.ts`.
- **Instancing GPU** (milliers d'arbres, de chaises…) : `ModelContent` / `ElementContent` sont les seuls endroits à adapter.
- **Caméra** : `cameraController.ts` centralise la caméra de travail (FPS, focale, trajectoires viendront ici).
