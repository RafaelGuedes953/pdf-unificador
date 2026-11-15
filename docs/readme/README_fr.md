[English](../../README.md) · [Português (Brasil)](README_pt-BR.md) · [Español](README_es.md) · **Français**

> Ceci est une traduction du [README en anglais](../../README.md), qui est la version de référence. En cas de différence, l'anglais fait foi.

# PDF Unificador

**[Voyez comment ça marche](https://rafaelguedes953.github.io/pdf-unificador/)** (il s'exécute dans votre navigateur, rien n'est envoyé)

Une application web qui fusionne des **images et des PDF en un seul PDF**. Vous envoyez les fichiers, vous voyez une miniature de chaque page, vous réorganisez, faites pivoter, supprimez ce que vous ne voulez pas, puis vous téléchargez le résultat. Elle est conçue pour tourner dans un conteneur sur un serveur domestique (Raspberry Pi avec CasaOS) et s'utiliser depuis le navigateur du téléphone ou de l'ordinateur portable, à l'intérieur du réseau local.

## À quoi ça sert

- Regrouper dans un seul PDF des photos de documents prises avec le téléphone.
- Combiner des PDF existants (un contrat et ses annexes, par exemple) dans le bon ordre.
- Mélanger les deux : PDF et images dans le même résultat.
- Tout faire sur votre propre machine, sans envoyer de documents à des services tiers.

## Ce que fait la version actuelle

- Accepte **PDF, JPG, PNG et WebP** (plusieurs fichiers à la fois ; sur ordinateur, on peut aussi glisser-déposer).
- Affiche une miniature par page, y compris pour chaque page d'un PDF.
- **Réorganise** les pages (en faisant glisser la carte, ou avec les boutons précédent/suivant, utiles sur téléphone).
- **Fait pivoter** chaque page par pas de 90 degrés.
- **Supprime** les pages indésirables avant la génération.
- Corrige l'orientation des photos de téléphone (EXIF), si bien que la photo apparaît dans le PDF comme à l'écran.
- Ajuste chaque image dans une page A4 (portrait ou paysage), sans rogner ni déformer.
- Fonctionne hors ligne : les bibliothèques du navigateur sont servies par le serveur lui-même.

L'interface web n'est pour l'instant disponible qu'en portugais du Brésil.

Les projets pour les prochaines versions se trouvent dans la [Feuille de route](#feuille-de-route).

## Comment ça marche

1. Le navigateur lit les fichiers et génère les miniatures localement (pdf.js pour les PDF).
2. Quand vous cliquez sur **Gerar PDF** (« Générer le PDF »), le navigateur envoie les fichiers d'origine et un petit plan JSON indiquant quelle page va à quelle position et avec quelle rotation.
3. Le serveur (Node.js, Fastify, pdf-lib et sharp) assemble le PDF en suivant le plan et renvoie le fichier.

Le serveur **n'écrit rien sur le disque** : les fichiers sont traités en mémoire et supprimés à la fin de la requête. Le conteneur s'exécute avec un système de fichiers en lecture seule.

## Prérequis

- Pour exécuter : Docker avec Compose (ou CasaOS). L'image est publiée pour `linux/amd64` et `linux/arm64`, elle convient donc aux PC et aux Raspberry Pi 64 bits.
- Pour développer : Node.js 22 ou supérieur.

## Installation

### Option 1 : Docker Compose, en construisant sur le serveur lui-même

```bash
git clone https://github.com/RafaelGuedes953/pdf-unificador.git
cd pdf-unificador
cp .env.example .env        # facultatif : ajustez le port et les limites
docker compose up -d --build
```

Ouvrez `http://IP-DU-SERVEUR:8085`.

### Option 2 : image prête à l'emploi, publiée par la CI

La CI publie une image prête à l'emploi, pour `amd64` et `arm64`, sur le GitHub Container Registry à chaque modification de `main` (voir [CI/CD](#cicd)) : il n'y a donc rien à construire sur le serveur.

```bash
# dans .env, définissez l'image :
# IMAGE=ghcr.io/rafaelguedes953/pdf-unificador:latest
docker compose pull
docker compose up -d
```

Si le paquet sur GitHub est privé, exécutez `docker login ghcr.io` sur le serveur avec un jeton disposant de la permission `read:packages`. Si vous préférez ne pas vous connecter, rendez le paquet public dans ses paramètres sur GitHub.

### Option 3 : CasaOS

1. Dans CasaOS, ouvrez la boutique d'applications et choisissez d'installer une application personnalisée, avec l'option d'**importer** un fichier compose. Collez le contenu de `casaos/docker-compose.yml`. Le chemin exact des menus peut varier selon la version de CasaOS.
2. Sur l'écran d'installation, le **port de l'hôte** (8085 par défaut) est un champ modifiable : changez-le s'il est déjà utilisé. Le port interne du conteneur est toujours 3000.
3. Installez, puis ouvrez l'application avec le bouton du tableau de bord.

Le fichier contient un bloc `x-casaos` avec le titre, la description et la catégorie, pour que l'application s'affiche bien sur le tableau de bord.

## Configuration

Tout est facultatif. Avec Compose, les variables viennent du fichier `.env` ; sur CasaOS, modifiez-les sur l'écran d'installation.

| Variable | Valeur par défaut | À quoi elle sert |
| --- | --- | --- |
| `HOST_PORT` | `8085` | Port publié sur l'hôte (Compose générique uniquement). |
| `IMAGE` | `pdf-unificador:local` | Image utilisée par Compose. |
| `MAX_FILES` | `20` | Nombre maximal de fichiers par fusion. |
| `MAX_FILE_MB` | `25` | Taille maximale de chaque fichier, en Mo. |
| `MAX_TOTAL_MB` | `100` | Taille maximale cumulée des fichiers, en Mo. |
| `MAX_PAGES` | `300` | Nombre maximal de pages du PDF final. |
| `MAX_IMAGE_MEGAPIXELS` | `100` | Mégapixels maximaux d'une image. |
| `MAX_CONCURRENT_JOBS` | `2` | Fusions simultanées ; au-delà, le serveur demande de réessayer. |
| `SHARP_CONCURRENCY` | `2` | Threads utilisés pour le traitement des images. |
| `MEM_LIMIT` | `1g` | Limite de mémoire du conteneur. |

La consommation de mémoire augmente avec la taille des fichiers traités, car tout se fait en mémoire. Sur un Raspberry Pi avec peu de RAM, réduisez `MAX_TOTAL_MB` et `MAX_CONCURRENT_JOBS`. Les valeurs par défaut sont des points de départ raisonnables et n'ont pas été calibrées pour un modèle précis de Raspberry Pi.

## Utilisation

1. Appuyez sur **Adicionar arquivos** (« Ajouter des fichiers »), ou faites glisser des fichiers sur la page, sur ordinateur.
2. Ajustez la liste : faites glisser les cartes (sur téléphone, maintenez un instant avant de glisser) ou utilisez les boutons `‹` et `›` ; faites pivoter avec `↻` ; supprimez avec `✕`.
3. Appuyez sur **Gerar PDF** (« Générer le PDF »). Le téléchargement démarre tout seul et le message d'état contient un lien pour ouvrir le fichier.

### API

L'interface utilise une API simple, qui convient aussi à l'automatisation (n8n, scripts) :

```bash
curl -o fusionne.pdf \
  -F "files=@contrat.pdf" \
  -F "files=@photo.jpg" \
  -F 'plan={"items":[{"file":1,"page":null,"rotation":0},{"file":0,"page":0,"rotation":90}]}' \
  http://IP-DU-SERVEUR:8085/api/merge
```

- `files` : les fichiers, dans l'ordre ; les index du plan renvoient à cet ordre (à partir de 0).
- `plan.items` : une entrée par page du résultat, dans l'ordre final. `page` est l'index de la page (base 0) pour les PDF et `null` pour les images. `rotation` vaut 0, 90, 180 ou 270, dans le sens horaire.
- Les erreurs reviennent sous forme de JSON `{"error": "message"}` avec le statut HTTP approprié (400, 413, 415, 422 ou 429).
- `GET /health` répond `{"status":"ok"}` et `GET /api/config` indique les limites actives.

## Mode navigateur (sans serveur)

La même interface peut aussi fonctionner sans le serveur. Quand elle est servie comme de simples fichiers statiques (par exemple sur GitHub Pages) et que `api/config` ne répond pas, elle passe d'elle-même en mode navigateur : le PDF est assemblé sur votre propre appareil avec pdf-lib, et aucun fichier n'est envoyé nulle part. Le conteneur continue de fonctionner exactement comme avant. Une version hébergée est disponible à l'adresse https://rafaelguedes953.github.io/pdf-unificador/, publiée par la CI sur GitHub Pages.

Limites par rapport au conteneur :

- **Mémoire de l'appareil.** La limite est la mémoire du navigateur et de l'appareil, pas celle du serveur. Les gros lots peuvent échouer sur des téléphones modestes, et la page affiche un message suggérant moins de fichiers ou des fichiers plus petits.
- **Les grandes images sont réduites.** Les images de plus de 16 mégapixels qui doivent être ré-encodées (correction EXIF, PNG, WebP) sont réduites à 16 MP, ce qui donne encore plus de 300 ppp en A4. Les JPEG déjà dans la bonne orientation entrent dans le PDF intacts, quelle que soit leur taille.
- **La page peut se figer un instant.** Le PDF est construit sur le thread principal, si bien que les gros lots peuvent bloquer l'écran jusqu'à la fin.
- **Peu de tests sur les navigateurs pour l'instant.** Il n'a été validé que sur Chrome (ordinateur). Firefox, Safari et les navigateurs mobiles n'ont pas été testés.
- **Un 404 sans gravité dans la console.** La console du navigateur affiche un 404 pour `api/config` ; cette sonde est la façon dont le mode est détecté.

Les limites de fichiers, de taille et de pages sont les mêmes que dans le conteneur, et HEIC, GIF et TIFF ne sont toujours pas pris en charge.

## Développement local

```bash
npm ci
npm run dev        # http://localhost:3000, rechargement à l'enregistrement
```

| Commande | Ce qu'elle fait |
| --- | --- |
| `npm run dev` | Serveur en mode développement. |
| `npm run typecheck` | Vérifie les types TypeScript. |
| `npm test` | Lance les tests (backend et API). |
| `npm run build` | Copie les bibliothèques du navigateur dans `vendor/` et compile vers `dist/`. |
| `npm start` | Exécute la version compilée. |

Les bibliothèques du navigateur (pdf.js et SortableJS) sont des dépendances de développement, et `npm run vendor` ne copie dans `vendor/` que les fichiers nécessaires. Ainsi, elles et les lourdes dépendances que pdf.js apporte pour tourner sous Node restent hors de l'image de production.

### Structure

```
src/        serveur (Fastify) : routes, validation du plan, assemblage du PDF
public/     interface web (HTML, CSS et JavaScript, sans étape de build)
tools/      script qui prépare vendor/
test/       tests (node:test)
scripts/    protect-main.sh (protection de la branche main)
casaos/     compose à importer dans CasaOS
docs/       README traduits
.github/    workflows CI/CD, Dependabot, CODEOWNERS et modèle de PR
```

## CI/CD

Trois workflows dans `.github/workflows/` :

- **`ci.yml`** s'exécute à chaque pull request et à chaque push sur `main` :
  - `build-test` : installe les dépendances, vérifie les types, lance les tests et compile.
  - `docker-build` : construit l'image pour `amd64` et `arm64`, démarre le conteneur et vérifie `/health`, l'interface et les bibliothèques du navigateur. Le build `arm64` s'exécute en émulation, c'est donc l'étape la plus lente.
- **`publish.yml`** s'exécute quand quelque chose entre dans `main` (ou quand un tag `vX.Y.Z` est créé) et publie l'image multi-architecture sur le GitHub Container Registry, à l'adresse `ghcr.io/<utilisateur>/pdf-unificador`, avec les tags `latest`, le hash du commit et, pour les tags de version, le numéro de version (`1.0.0` et `1.0`). Sur les tags de version, il vérifie aussi que le tag correspond à la `version` du `package.json` et, après la publication de l'image, crée la Release GitHub avec des notes générées automatiquement.
- **`pages.yml`** s'exécute quand les fichiers de l'interface changent sur `main` (ou manuellement) et publie le site sur GitHub Pages, où il fonctionne en [mode navigateur](#mode-navigateur-sans-serveur). Avant de publier, il vérifie que les fichiers essentiels sont dans le site. Il nécessite Settings → Pages → Source sur **GitHub Actions**, une seule fois.

Dependabot (`.github/dependabot.yml`) ouvre chaque semaine des pull requests pour mettre à jour les dépendances npm, les GitHub Actions et l'image de base Docker.

Pour mettre à jour le serveur après une modification publiée : `docker compose pull && docker compose up -d` (ou réinstallez/mettez à jour l'application dans CasaOS).

## Publier une release

1. Sur une branche, mettez à jour la version (`npm version 1.1.0 --no-git-tag-version`) et ouvrez la pull request.
2. Après le merge dans `main`, créez le tag à partir de `main` à jour et envoyez-le :

   ```bash
   git checkout main && git pull
   git tag v1.1.0
   git push origin v1.1.0
   ```

3. Le workflow **Publicar imagem** (« Publier l'image ») publie `ghcr.io/<utilisateur>/pdf-unificador:1.1.0` (et `1.1`) et crée la Release GitHub. `latest` continue de pointer vers le dernier commit de `main`.

Pour figer le Raspberry Pi sur une version, utilisez le tag à la place de `latest` (par exemple `ghcr.io/<utilisateur>/pdf-unificador:1.0.0`).

## Protection de la branche main

`main` est protégée par deux rulesets GitHub (Settings → Rules → Rulesets), tous deux actifs sur la branche par défaut :

| Ruleset | S'applique à | Ce qu'il exige |
|---|---|---|
| `protectMain` | tout le monde, sans bypass | Pull request obligatoire (0 approbation), checks `build-test` et `docker-build` au vert avec la branche à jour, conversations résolues, historique linéaire, pas de force push et pas de suppression |
| `requireApproval` | tout le monde, sauf le propriétaire sur les pull requests | 1 approbation, y compris la revue du propriétaire du code (`CODEOWNERS`) |

Ainsi, tout collaborateur a besoin de l'approbation du propriétaire, et le propriétaire a seulement besoin que les builds passent. Personne ne peut pousser directement sur `main`.

### Alternative : le script

Si vous préférez la protection de branche classique plutôt que les rulesets, vous pouvez utiliser le script `scripts/protect-main.sh`. N'utilisez pas les deux en même temps. Il configure `main` pour que rien n'entre sans pull request :

- pull request obligatoire (pas de push direct) ;
- checks `build-test` et `docker-build` obligatoires, avec la branche à jour avant le merge ;
- discussions de la PR résolues avant le merge ;
- historique linéaire, pas de force push et pas de suppression de la branche ;
- les règles s'appliquent aussi aux administrateurs.

```bash
gh auth login                       # une fois, avec le compte propriétaire du dépôt
bash scripts/protect-main.sh        # détecte le dépôt à partir du dossier courant
```

**À propos de votre propre approbation.** GitHub ne compte pas l'approbation de l'auteur de la pull request lui-même. Il y a donc deux façons de l'utiliser :

- **Par défaut (`REQUIRED_APPROVALS=0`)** : la PR est obligatoire et la CI doit passer, mais aucune approbation séparée n'est exigée. Dans un dépôt qui n'appartient qu'à vous, votre clic sur **Merge** est la décision finale, et vous seul pouvez le faire.
- **Avec approbation formelle (`REQUIRED_APPROVALS=1`)** : la PR n'entre qu'après votre approbation, et la revue du propriétaire du code (fichier `CODEOWNERS`) devient obligatoire. Cela ne fonctionne que si les PR sont ouvertes par **un autre compte** (un bot ou un collaborateur). Si vous ouvrez la PR avec votre propre compte, vous ne pourrez pas l'approuver et vous ne pourrez pas la fusionner.

```bash
REQUIRED_APPROVALS=1 bash scripts/protect-main.sh
```

Autres options : `ENFORCE_ADMINS=false`, `CHECKS`, `BRANCH` et `DRY_RUN=1` (affiche ce qui serait appliqué sans rien modifier). La protection doit être appliquée **après** le premier push, car elle bloque les push directs sur `main`. Sur les dépôts privés, GitHub peut exiger un abonnement payant pour la protection de branche.

## Reproduire le projet

1. Créez un dépôt vide sur GitHub nommé `pdf-unificador` (le nom doit correspondre à celui de l'image).
2. Remplacez l'utilisateur `RafaelGuedes953` par le vôtre (en minuscules dans les noms d'image, comme `rafaelguedes953`) dans `.github/CODEOWNERS`, `casaos/docker-compose.yml`, `.env.example` et les liens des README.
3. Faites le premier push directement sur `main` :

   ```bash
   git init -b main
   git add .
   git commit -m "feat: initial version"
   git remote add origin git@github.com:VOTRE_UTILISATEUR/pdf-unificador.git
   git push -u origin main
   ```

4. Attendez la fin du workflow **Publicar imagem** (onglet Actions). Il crée le paquet sur GHCR.
5. Appliquez la protection de `main`, avec des rulesets ou avec `bash scripts/protect-main.sh` (voir [Protection de la branche main](#protection-de-la-branche-main)). À partir de là, tout le travail passe par une branche et une pull request.
6. Facultatif : pour publier le site du mode navigateur, activez GitHub Pages (Settings → Pages → Source : **GitHub Actions**) ; le workflow **Publicar site** fait le reste.
7. Installez sur le serveur avec l'une des options d'[Installation](#installation).

## Sécurité et limites

- **Il n'y a pas d'authentification.** Utilisez-la uniquement sur le réseau local ou via un VPN privé, comme Tailscale. N'exposez pas le port sur internet.
- Le conteneur s'exécute avec un utilisateur sans privilèges, un système de fichiers en lecture seule, sans capacités Linux supplémentaires et avec des limites de mémoire et de processus.
- Les en-têtes de sécurité de base sont envoyés, mais il n'y a ni CSP ni HTTPS intégré. Pour le HTTPS, placez un proxy devant (voir la Feuille de route).
- Les PDF protégés par mot de passe et les PDF corrompus sont refusés avec un message clair.
- Formats non pris en charge pour le moment : HEIC, GIF et TIFF.
- La rotation que vous appliquez est enregistrée comme attribut de la page, sans modifier le contenu. Les JPEG déjà dans la bonne orientation vont dans le PDF sans recompression ; les PNG, les WebP et les photos nécessitant une correction EXIF sont ré-encodés (JPEG en qualité 90, ou PNG quand il y a de la transparence).

## Feuille de route

Le projet avance par phases, une à la fois.

- [x] **Phase 1** : fusionner PDF et images, miniatures, réorganiser, pivoter, supprimer des pages, orientation EXIF, images ajustées à l'A4, Docker, CasaOS, CI/CD et protection de `main`.
- [ ] **Phase 2** : mode A4 avec marges facultatives, ou taille d'origine ; prise en charge de HEIC ; et nettoyage automatique des fichiers temporaires (il n'y en a pas aujourd'hui, car tout se fait en mémoire ; cela deviendra utile si quelque chose est écrit sur le disque).
- [ ] **Phase 3** : diviser un PDF, extraire une plage de pages (par ex. 2-5) et compression avec Ghostscript.
- [ ] **Phase 4** : HTTPS avec Tailscale, PWA avec Share Target (Android) et extras facultatifs (mot de passe, filigrane, OCR).
