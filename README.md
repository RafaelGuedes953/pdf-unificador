**English** · [Português (Brasil)](docs/readme/README_pt-BR.md) · [Español](docs/readme/README_es.md) · [Français](docs/readme/README_fr.md)

# PDF Unificador

A web app that merges **images and PDFs into a single PDF**. You upload the files, see a thumbnail of every page, reorder, rotate, remove what you don't want and download the result. It is designed to run as a container on a home server (Raspberry Pi with CasaOS) and be used from the browser of your phone or laptop inside the local network.

## What it is for

- Merging photos of documents taken with your phone into one PDF.
- Combining existing PDFs (a contract plus attachments, for example) in the right order.
- Mixing both: PDFs and images in the same result.
- Doing everything on your own machine, without sending documents to third-party services.

## What the current version does

- Accepts **PDF, JPG, PNG and WebP** (several files at once; on a computer you can also drag and drop).
- Shows one thumbnail per page, including every page of a PDF.
- **Reorders** pages (by dragging the card, or with the previous/next buttons, which help on a phone).
- **Rotates** each page in 90-degree steps.
- **Removes** unwanted pages before generating.
- Fixes the orientation of phone photos (EXIF), so a photo ends up in the PDF the way it looks on screen.
- Fits each image inside an A4 page (portrait or landscape), without cropping or distortion.
- Works offline: the browser libraries are served by the server itself.

The web interface is currently available only in Brazilian Portuguese.

Plans for upcoming versions are in the [Roadmap](#roadmap).

## How it works

1. The browser reads the files and generates the thumbnails locally (pdf.js for PDFs).
2. When you click **Gerar PDF** ("Generate PDF"), the browser sends the original files plus a small JSON plan saying which page goes in which position and with which rotation.
3. The server (Node.js, Fastify, pdf-lib and sharp) builds the PDF following the plan and returns the file.

The server **writes nothing to disk**: files are processed in memory and discarded at the end of the request. The container runs with a read-only filesystem.

## Requirements

- To run: Docker with Compose (or CasaOS). The image is published for `linux/amd64` and `linux/arm64`, so it works on PCs and on 64-bit Raspberry Pis.
- To develop: Node.js 22 or later.

## Installation

### Option 1: Docker Compose, building on the server itself

```bash
git clone https://github.com/RafaelGuedes953/pdf-unificador.git
cd pdf-unificador
cp .env.example .env        # optional: adjust port and limits
docker compose up -d --build
```

Open `http://SERVER-IP:8085`.

### Option 2: ready-made image, published by CI

The CI publishes a ready-made `amd64` and `arm64` image to the GitHub Container Registry on every change to `main` (see [CI/CD](#cicd)), so nothing needs to be built on the server.

```bash
# in .env, set the image:
# IMAGE=ghcr.io/rafaelguedes953/pdf-unificador:latest
docker compose pull
docker compose up -d
```

If the package on GitHub is private, run `docker login ghcr.io` on the server with a token that has the `read:packages` permission. If you prefer not to log in, make the package public in its settings on GitHub.

### Option 3: CasaOS

1. In CasaOS, open the app store and choose to install a custom app, using the **import** option for a compose file. Paste the content of `casaos/docker-compose.yml`. The exact menu path may vary with the CasaOS version.
2. On the installation screen, the **host port** (default 8085) is an editable field: change it if it is already in use. The container's internal port is always 3000.
3. Install it and open it with the app button on the dashboard.

The file includes an `x-casaos` block with title, description and category so the app looks good on the dashboard.

## Configuration

Everything is optional. With Compose, the variables come from the `.env` file; on CasaOS, edit them on the installation screen.

| Variable | Default | What it does |
| --- | --- | --- |
| `HOST_PORT` | `8085` | Port published on the host (generic Compose only). |
| `IMAGE` | `pdf-unificador:local` | Image used by Compose. |
| `MAX_FILES` | `20` | Maximum number of files per merge. |
| `MAX_FILE_MB` | `25` | Maximum size of each file, in MB. |
| `MAX_TOTAL_MB` | `100` | Maximum combined size of the files, in MB. |
| `MAX_PAGES` | `300` | Maximum number of pages in the final PDF. |
| `MAX_IMAGE_MEGAPIXELS` | `100` | Maximum megapixels of a single image. |
| `MAX_CONCURRENT_JOBS` | `2` | Simultaneous merges; above this, the server asks the client to try again. |
| `SHARP_CONCURRENCY` | `2` | Threads used for image processing. |
| `MEM_LIMIT` | `1g` | Container memory limit. |

Memory usage grows with the size of the processed files, because everything is done in memory. On a Raspberry Pi with little RAM, lower `MAX_TOTAL_MB` and `MAX_CONCURRENT_JOBS`. The default values are reasonable starting points and have not been calibrated for a specific Raspberry Pi model.

## Usage

1. Tap **Adicionar arquivos** ("Add files"), or drag files onto the page on a computer.
2. Adjust the list: drag the cards (on a phone, hold for a moment before dragging) or use the `‹` and `›` buttons; rotate with `↻`; remove with `✕`.
3. Tap **Gerar PDF** ("Generate PDF"). The download starts by itself and the status message includes a link to open the file.

### API

The interface uses a simple API, which is also suitable for automation (n8n, scripts):

```bash
curl -o merged.pdf \
  -F "files=@contract.pdf" \
  -F "files=@photo.jpg" \
  -F 'plan={"items":[{"file":1,"page":null,"rotation":0},{"file":0,"page":0,"rotation":90}]}' \
  http://SERVER-IP:8085/api/merge
```

- `files`: the files, in order; the plan indexes refer to this order (starting at 0).
- `plan.items`: one entry per page of the result, in final order. `page` is the page index (0-based) for PDFs and `null` for images. `rotation` is 0, 90, 180 or 270, clockwise.
- Errors come back as JSON `{"error": "message"}` with the appropriate HTTP status (400, 413, 415, 422 or 429).
- `GET /health` answers `{"status":"ok"}` and `GET /api/config` reports the active limits.

## Browser mode (no server)

The same interface can also run without the server. When it is served as plain static files (for example on GitHub Pages) and `api/config` does not answer, it switches to browser mode by itself: the PDF is assembled on your own device with pdf-lib, and no file is sent anywhere. The container keeps working exactly as before.

Limitations compared with the container:

- **Device memory.** The limit is the memory of the browser and the device, not the server's. Large batches can fail on simple phones, and the page shows a message suggesting fewer or smaller files.
- **Large images are reduced.** Images above 16 megapixels that need re-encoding (EXIF correction, PNG, WebP) are scaled down to 16 MP, which still gives more than 300 dpi on A4. JPEGs already in the correct orientation go into the PDF untouched, at any size.
- **The page can freeze for a moment.** The PDF is built on the main thread, so large batches may block the screen until they finish.
- **Little browser testing so far.** It was only validated on Chrome (desktop). Firefox, Safari and mobile browsers are untested.
- **A harmless 404 in the console.** The browser console shows a 404 for `api/config`; that probe is how the mode is detected.

The limits on files, size and pages are the same as in the container, and HEIC, GIF and TIFF are still not supported.

## Local development

```bash
npm ci
npm run dev        # http://localhost:3000, reloads on save
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server. |
| `npm run typecheck` | Checks the TypeScript types. |
| `npm test` | Runs the tests (backend and API). |
| `npm run build` | Copies the browser libraries to `vendor/` and compiles to `dist/`. |
| `npm start` | Runs the compiled version. |

The browser libraries (pdf.js and SortableJS) are development dependencies, and `npm run vendor` copies only the necessary files to `vendor/`. This way they, and the heavy dependencies pdf.js brings in to run on Node, stay out of the production image.

### Project layout

```
src/        server (Fastify): routes, plan validation, PDF assembly
public/     web interface (HTML, CSS and JavaScript, no build step)
tools/      script that prepares vendor/
test/       tests (node:test)
scripts/    protect-main.sh (main branch protection)
casaos/     compose file to import into CasaOS
docs/       translated READMEs
.github/    CI/CD workflows, Dependabot, CODEOWNERS and PR template
```

## CI/CD

Two workflows in `.github/workflows/`:

- **`ci.yml`** runs on every pull request and every push to `main`:
  - `build-test`: installs dependencies, checks types, runs the tests and builds.
  - `docker-build`: builds the image for `amd64` and `arm64`, starts the container and checks `/health`, the interface and the browser libraries. The `arm64` build runs emulated, so it is the slowest step.
- **`publish.yml`** runs when something lands on `main` (or when a `vX.Y.Z` tag is created) and publishes the multi-architecture image to the GitHub Container Registry, at `ghcr.io/<user>/pdf-unificador`, with the tags `latest`, the commit hash and, on version tags, the version number (`1.0.0` and `1.0`). On version tags it also checks that the tag matches the `version` in `package.json` and, after publishing the image, creates the GitHub Release with automatically generated notes.

Dependabot (`.github/dependabot.yml`) opens weekly pull requests to update npm dependencies, GitHub Actions and the Docker base image.

To update the server after a published change: `docker compose pull && docker compose up -d` (or reinstall/update the app in CasaOS).

## Publishing a release

1. On a branch, bump the version (`npm version 1.1.0 --no-git-tag-version`) and open the pull request.
2. After the merge into `main`, create the tag from the updated `main` and push it:

   ```bash
   git checkout main && git pull
   git tag v1.1.0
   git push origin v1.1.0
   ```

3. The **Publicar imagem** ("Publish image") workflow publishes `ghcr.io/<user>/pdf-unificador:1.1.0` (and `1.1`) and creates the GitHub Release. `latest` keeps pointing to the latest commit on `main`.

To pin the Raspberry Pi to a version, use the tag instead of `latest` (for example `ghcr.io/<user>/pdf-unificador:1.0.0`).

## Main branch protection

`main` is protected by two GitHub rulesets (Settings → Rules → Rulesets), both active on the default branch:

| Ruleset | Applies to | What it requires |
|---|---|---|
| `protectMain` | everyone, no bypass | Pull request required (0 approvals), `build-test` and `docker-build` checks green with the branch up to date, conversations resolved, linear history, no force push and no deletion |
| `requireApproval` | everyone, except the owner on pull requests | 1 approval, including the code owner review (`CODEOWNERS`) |

This way, any collaborator needs the owner's approval, and the owner only needs the builds to pass. Nobody can push directly to `main`.

### Alternative: script

If you prefer classic branch protection instead of rulesets, you can use the `scripts/protect-main.sh` script. Do not use both at the same time. It configures `main` so that nothing gets in without a pull request:

- pull request required (no direct push);
- `build-test` and `docker-build` checks required, with the branch up to date before merging;
- PR discussions resolved before merging;
- linear history, no force push and no deletion of the branch;
- rules also apply to administrators.

```bash
gh auth login                       # once, with the account that owns the repository
bash scripts/protect-main.sh        # detects the repository from the current folder
```

**About your own approval.** GitHub does not count the approval of the pull request's own author. That is why there are two ways to use it:

- **Default (`REQUIRED_APPROVALS=0`)**: a PR is required and CI must pass, but no separate approval is needed. In a repository that is only yours, your click on **Merge** is the final decision, and only you can do it.
- **With formal approval (`REQUIRED_APPROVALS=1`)**: the PR only gets in after you approve it, and the code owner review (`CODEOWNERS` file) becomes required. This only works if the PRs are opened by **another account** (a bot or a collaborator). If you open the PR with your own account, you will not be able to approve it and will be unable to merge.

```bash
REQUIRED_APPROVALS=1 bash scripts/protect-main.sh
```

Other options: `ENFORCE_ADMINS=false`, `CHECKS`, `BRANCH` and `DRY_RUN=1` (shows what would be applied without changing anything). The protection must be applied **after** the first push, because it blocks direct pushes to `main`. On private repositories, GitHub may require a paid plan for branch protection.

## Replicating the project

1. Create an empty repository on GitHub called `pdf-unificador` (the name must match the image name).
2. Replace the user `RafaelGuedes953` with yours (lowercase in image names, like `rafaelguedes953`) in `.github/CODEOWNERS`, `casaos/docker-compose.yml`, `.env.example` and the README links.
3. Make the first push directly to `main`:

   ```bash
   git init -b main
   git add .
   git commit -m "feat: initial version"
   git remote add origin git@github.com:YOUR_USER/pdf-unificador.git
   git push -u origin main
   ```

4. Wait for the **Publicar imagem** workflow to finish (Actions tab). It creates the package on GHCR.
5. Apply the `main` protection, with rulesets or with `bash scripts/protect-main.sh` (see [Main branch protection](#main-branch-protection)). From then on, all work goes in through a branch and a pull request.
6. Install on the server with one of the [Installation](#installation) options.

## Security and limitations

- **There is no authentication.** Use it only on the local network or over a private VPN such as Tailscale. Do not expose the port to the internet.
- The container runs as an unprivileged user, with a read-only filesystem, no extra Linux capabilities and limits on memory and processes.
- Basic security headers are sent, but there is no CSP or built-in HTTPS. For HTTPS, put a proxy in front (see the Roadmap).
- Password-protected PDFs and corrupted PDFs are rejected with a clear message.
- Formats not supported for now: HEIC, GIF and TIFF.
- The rotation you apply is stored as a page attribute, without changing the content. JPEGs that are already in the correct orientation go into the PDF without recompression; PNG, WebP and photos that need EXIF correction are re-encoded (JPEG at quality 90, or PNG when there is transparency).

## Roadmap

The project is built in phases, one at a time.

- [x] **Phase 1**: merge PDFs and images, thumbnails, reorder, rotate, remove pages, EXIF orientation, images fitted to A4, Docker, CasaOS, CI/CD and `main` protection.
- [ ] **Phase 2**: A4 mode with optional margins, or original size; HEIC support; and automatic cleanup of temporary files (today there are none, since everything is done in memory; it applies if anything starts being written to disk).
- [ ] **Phase 3**: split PDF, extract a page range (e.g. 2-5) and compression with Ghostscript.
- [ ] **Phase 4**: HTTPS with Tailscale, PWA with Share Target (Android) and optional extras (password, watermark, OCR).
