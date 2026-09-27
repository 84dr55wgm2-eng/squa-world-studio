# Déploiement web (Vercel)

SQUA World Studio est une application web **100 % statique** : `npm run build` produit un dossier `dist/`
(HTML + JS + CSS) qu'un hébergement statique sert tel quel. Pas de serveur ni de base de données, et aucune
variable d'environnement requise.

## Méthode la plus simple : GitHub + Vercel (rien à installer sur le Mac)

1. Créez un dépôt GitHub (ex. `squa-world-studio`), puis envoyez-y le contenu du dossier du projet.
   Depuis le site GitHub : « Add file → Upload files », puis glissez tous les fichiers et dossiers
   (sans `node_modules` ni `dist`).
2. Sur <https://vercel.com/new>, connectez-vous avec GitHub et choisissez « Import » sur le dépôt.
3. Vercel lit `vercel.json` : framework Vite, build `npm run build`, sortie `dist`. Ne changez rien et cliquez sur **Deploy**.
4. Au bout d'environ une minute, l'URL publique s'affiche (`https://squa-world-studio-xxxx.vercel.app`).

Ensuite, chaque modification envoyée sur la branche `main` redéploie automatiquement le site, et chaque
autre branche ou pull request reçoit sa propre URL d'aperçu.

## Autre méthode : Vercel CLI (nécessite Node.js)

```bash
npm i -g vercel
vercel          # première fois : lie le dossier à un projet Vercel (déploiement d'aperçu)
vercel --prod   # déploiement de production
```

## Ce que fait `vercel.json`

| Règle | Rôle |
|---|---|
| `framework: vite`, `buildCommand`, `outputDirectory: dist` | build de production reproductible |
| `rewrites` → `/index.html` | toute URL inconnue affiche l'application (prêt pour de futures routes), sauf sous `/_app/` et `/assets/` : un modèle manquant y répond « 404 », ce qui donne un message d'erreur clair dans l'éditeur. |
| `/_app/*` : cache 1 an `immutable` | le code compilé (JS, CSS) a un nom haché : il ne change jamais, il peut être mis en cache définitivement |
| `/assets/*` : cache 1 jour, revalidé | modèles 3D et miniatures de la bibliothèque (noms stables, peuvent être mis à jour) |
| `/assets/library/library.json` : `no-cache` | un nouvel asset ajouté au manifest apparaît dès le déploiement suivant |
| `/` et `/index.html` : `no-cache` | après un déploiement, les visiteurs reçoivent immédiatement la nouvelle version |
| En-têtes de sécurité | `nosniff`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` |

La version de Node utilisée par Vercel est fixée par `"engines": { "node": "22.x" }` dans `package.json`.

## Variables d'environnement

**Aucune n'est nécessaire.** L'application n'appelle aucun serveur et ne contient aucune URL codée en dur.
Quand une variable deviendra utile (ex. une future API d'IA), elle devra être préfixée `VITE_` pour être lisible
côté navigateur. Elle sera alors **publique** : aucune clé secrète ne doit jamais passer par là. Les clés d'IA
passeront par une fonction serveur (Phase 4).

## Vérifier un build localement (optionnel)

```bash
npm install
npm run build     # vérification TypeScript + build dans dist/
npm run preview   # sert dist/ sur http://localhost:4173
```
