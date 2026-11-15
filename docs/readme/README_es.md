[English](../../README.md) · [Português (Brasil)](README_pt-BR.md) · **Español** · [Français](README_fr.md)

> Esta es una traducción del [README en inglés](../../README.md), que es la versión de referencia. Si hay alguna diferencia, prevalece el inglés.

# PDF Unificador

Una aplicación web que une **imágenes y PDFs en un único PDF**. Subes los archivos, ves una miniatura de cada página, reordenas, giras, eliminas lo que no quieres y descargas el resultado. Está pensada para ejecutarse como contenedor en un servidor doméstico (Raspberry Pi con CasaOS) y usarse desde el navegador del móvil o del portátil dentro de la red local.

## Para qué sirve

- Unir en un solo PDF fotos de documentos hechas con el móvil.
- Combinar PDFs existentes (un contrato y sus anexos, por ejemplo) en el orden correcto.
- Mezclar ambos: PDFs e imágenes en el mismo resultado.
- Hacerlo todo en tu propia máquina, sin enviar documentos a servicios de terceros.

## Qué hace la versión actual

- Acepta **PDF, JPG, PNG y WebP** (varios archivos a la vez; en el ordenador también se puede arrastrar y soltar).
- Muestra una miniatura por página, incluida cada página de un PDF.
- **Reordena** las páginas (arrastrando la tarjeta o con los botones de anterior/siguiente, que ayudan en el móvil).
- **Gira** cada página en pasos de 90 grados.
- **Elimina** las páginas no deseadas antes de generar.
- Corrige la orientación de las fotos del móvil (EXIF), de modo que la foto queda en el PDF tal como se ve en pantalla.
- Ajusta cada imagen dentro de una página A4 (vertical u horizontal), sin recortar ni deformar.
- Funciona sin internet: las bibliotecas del navegador las sirve el propio servidor.

La interfaz web está disponible por ahora solo en portugués de Brasil.

Los planes para las próximas versiones están en la [Hoja de ruta](#hoja-de-ruta).

## Cómo funciona

1. El navegador lee los archivos y genera las miniaturas localmente (pdf.js para los PDFs).
2. Al hacer clic en **Gerar PDF** ("Generar PDF"), el navegador envía los archivos originales y un pequeño plan en JSON que indica qué página va en qué posición y con qué rotación.
3. El servidor (Node.js, Fastify, pdf-lib y sharp) monta el PDF siguiendo el plan y devuelve el archivo.

El servidor **no escribe nada en disco**: los archivos se procesan en memoria y se descartan al terminar la petición. El contenedor se ejecuta con el sistema de archivos en modo de solo lectura.

## Requisitos

- Para ejecutar: Docker con Compose (o CasaOS). La imagen se publica para `linux/amd64` y `linux/arm64`, por lo que sirve tanto para PC como para Raspberry Pi de 64 bits.
- Para desarrollar: Node.js 22 o superior.

## Instalación

### Opción 1: Docker Compose, construyendo en el propio servidor

```bash
git clone https://github.com/RafaelGuedes953/pdf-unificador.git
cd pdf-unificador
cp .env.example .env        # opcional: ajusta el puerto y los límites
docker compose up -d --build
```

Abre `http://IP-DEL-SERVIDOR:8085`.

### Opción 2: imagen lista, publicada por el CI

El CI publica una imagen lista, para `amd64` y `arm64`, en el GitHub Container Registry con cada cambio en `main` (consulta [CI/CD](#cicd)), así que no hace falta construir nada en el servidor.

```bash
# en .env, define la imagen:
# IMAGE=ghcr.io/rafaelguedes953/pdf-unificador:latest
docker compose pull
docker compose up -d
```

Si el paquete en GitHub es privado, ejecuta `docker login ghcr.io` en el servidor con un token que tenga el permiso `read:packages`. Si prefieres no iniciar sesión, haz público el paquete en sus ajustes de GitHub.

### Opción 3: CasaOS

1. En CasaOS, abre la tienda de aplicaciones y elige instalar una aplicación personalizada, usando la opción de **importar** un compose. Pega el contenido de `casaos/docker-compose.yml`. La ruta exacta de los menús puede variar según la versión de CasaOS.
2. En la pantalla de instalación, el **puerto del host** (por defecto 8085) es un campo editable: cámbialo si ya está en uso. El puerto interno del contenedor es siempre el 3000.
3. Instala y abre la aplicación con el botón del panel.

El archivo incluye un bloque `x-casaos` con título, descripción y categoría para que la aplicación se vea bien en el panel.

## Configuración

Todo es opcional. Con Compose, las variables vienen del archivo `.env`; en CasaOS, edítalas en la pantalla de instalación.

| Variable | Valor por defecto | Para qué sirve |
| --- | --- | --- |
| `HOST_PORT` | `8085` | Puerto publicado en el host (solo en el Compose genérico). |
| `IMAGE` | `pdf-unificador:local` | Imagen usada por Compose. |
| `MAX_FILES` | `20` | Número máximo de archivos por unión. |
| `MAX_FILE_MB` | `25` | Tamaño máximo de cada archivo, en MB. |
| `MAX_TOTAL_MB` | `100` | Tamaño máximo sumado de los archivos, en MB. |
| `MAX_PAGES` | `300` | Número máximo de páginas del PDF final. |
| `MAX_IMAGE_MEGAPIXELS` | `100` | Megapíxeles máximos de una imagen. |
| `MAX_CONCURRENT_JOBS` | `2` | Uniones simultáneas; por encima de eso, el servidor pide que se intente de nuevo. |
| `SHARP_CONCURRENCY` | `2` | Hilos usados en el procesamiento de imágenes. |
| `MEM_LIMIT` | `1g` | Límite de memoria del contenedor. |

El consumo de memoria crece con el tamaño de los archivos procesados, porque todo se hace en memoria. En una Raspberry Pi con poca RAM, reduce `MAX_TOTAL_MB` y `MAX_CONCURRENT_JOBS`. Los valores por defecto son puntos de partida razonables y no se han calibrado para un modelo concreto de Raspberry Pi.

## Uso

1. Toca **Adicionar arquivos** ("Añadir archivos") o arrastra archivos a la página, en el ordenador.
2. Ajusta la lista: arrastra las tarjetas (en el móvil, mantén pulsado un instante antes de arrastrar) o usa los botones `‹` y `›`; gira con `↻`; elimina con `✕`.
3. Toca **Gerar PDF** ("Generar PDF"). La descarga empieza sola y el mensaje de estado incluye un enlace para abrir el archivo.

### API

La interfaz usa una API sencilla, que también sirve para automatizaciones (n8n, scripts):

```bash
curl -o unido.pdf \
  -F "files=@contrato.pdf" \
  -F "files=@foto.jpg" \
  -F 'plan={"items":[{"file":1,"page":null,"rotation":0},{"file":0,"page":0,"rotation":90}]}' \
  http://IP-DEL-SERVIDOR:8085/api/merge
```

- `files`: los archivos, en orden; los índices del plan se refieren a ese orden (empieza en 0).
- `plan.items`: una entrada por página del resultado, en el orden final. `page` es el índice de la página (base 0) para los PDFs y `null` para las imágenes. `rotation` es 0, 90, 180 o 270, en el sentido de las agujas del reloj.
- Los errores vuelven como JSON `{"error": "mensaje"}` con el estado HTTP adecuado (400, 413, 415, 422 o 429).
- `GET /health` responde `{"status":"ok"}` y `GET /api/config` informa de los límites activos.

## Desarrollo local

```bash
npm ci
npm run dev        # http://localhost:3000, se recarga al guardar
```

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor en modo de desarrollo. |
| `npm run typecheck` | Comprueba los tipos de TypeScript. |
| `npm test` | Ejecuta las pruebas (backend y API). |
| `npm run build` | Copia las bibliotecas del navegador a `vendor/` y compila a `dist/`. |
| `npm start` | Ejecuta la versión compilada. |

Las bibliotecas del navegador (pdf.js y SortableJS) son dependencias de desarrollo y `npm run vendor` copia solo los archivos necesarios a `vendor/`. Así, ellas y las pesadas dependencias que pdf.js trae para ejecutarse en Node no acaban en la imagen de producción.

### Estructura

```
src/        servidor (Fastify): rutas, validación del plan, montaje del PDF
public/     interfaz web (HTML, CSS y JavaScript sin paso de compilación)
tools/      script que prepara vendor/
test/       pruebas (node:test)
scripts/    protect-main.sh (protección de la rama main)
casaos/     compose para importar en CasaOS
docs/       READMEs traducidos
.github/    workflows de CI/CD, Dependabot, CODEOWNERS y plantilla de PR
```

## CI/CD

Dos workflows en `.github/workflows/`:

- **`ci.yml`** se ejecuta en cada pull request y en cada push a `main`:
  - `build-test`: instala dependencias, comprueba los tipos, ejecuta las pruebas y compila.
  - `docker-build`: construye la imagen para `amd64` y `arm64`, arranca el contenedor y comprueba `/health`, la interfaz y las bibliotecas del navegador. La compilación `arm64` se ejecuta emulada, por lo que es el paso más lento.
- **`publish.yml`** se ejecuta cuando algo entra en `main` (o cuando se crea una etiqueta `vX.Y.Z`) y publica la imagen multiarquitectura en el GitHub Container Registry, en `ghcr.io/<usuario>/pdf-unificador`, con las etiquetas `latest`, el hash del commit y, en las etiquetas de versión, el número de versión (`1.0.0` y `1.0`). En las etiquetas de versión también comprueba que la etiqueta coincida con la `version` del `package.json` y, tras publicar la imagen, crea la Release en GitHub con notas generadas automáticamente.

Dependabot (`.github/dependabot.yml`) abre pull requests semanales para actualizar las dependencias npm, las GitHub Actions y la imagen base de Docker.

Para actualizar el servidor tras un cambio publicado: `docker compose pull && docker compose up -d` (o reinstala/actualiza la aplicación en CasaOS).

## Publicar una release

1. En una rama, actualiza la versión (`npm version 1.1.0 --no-git-tag-version`) y abre el pull request.
2. Tras el merge en `main`, crea la etiqueta desde la `main` actualizada y envíala:

   ```bash
   git checkout main && git pull
   git tag v1.1.0
   git push origin v1.1.0
   ```

3. El workflow **Publicar imagem** ("Publicar imagen") publica `ghcr.io/<usuario>/pdf-unificador:1.1.0` (y `1.1`) y crea la Release en GitHub. `latest` sigue apuntando al último commit de `main`.

Para fijar la Raspberry Pi en una versión, usa la etiqueta en lugar de `latest` (por ejemplo `ghcr.io/<usuario>/pdf-unificador:1.0.0`).

## Protección de la rama main

`main` está protegida por dos rulesets de GitHub (Settings → Rules → Rulesets), ambos activos en la rama predeterminada:

| Ruleset | A quién se aplica | Qué exige |
|---|---|---|
| `protectMain` | todos, sin bypass | Pull request obligatorio (0 aprobaciones), checks `build-test` y `docker-build` en verde con la rama actualizada, conversaciones resueltas, historial lineal, sin force push y sin eliminación |
| `requireApproval` | todos, excepto el propietario en los pull requests | 1 aprobación, incluida la revisión del propietario del código (`CODEOWNERS`) |

Así, cualquier colaborador necesita la aprobación del propietario, y el propietario solo necesita que las compilaciones pasen. Nadie puede hacer push directo a `main`.

### Alternativa: script

Si prefieres la protección de rama clásica en lugar de rulesets, puedes usar el script `scripts/protect-main.sh`. No uses los dos a la vez. Configura `main` para que nada entre sin pull request:

- pull request obligatorio (sin push directo);
- checks `build-test` y `docker-build` obligatorios, con la rama actualizada antes del merge;
- discusiones del PR resueltas antes del merge;
- historial lineal, sin force push y sin eliminación de la rama;
- las reglas también valen para los administradores.

```bash
gh auth login                       # una vez, con la cuenta propietaria del repositorio
bash scripts/protect-main.sh        # detecta el repositorio por la carpeta actual
```

**Sobre tu propia aprobación.** GitHub no cuenta la aprobación del propio autor del pull request. Por eso hay dos formas de uso:

- **Por defecto (`REQUIRED_APPROVALS=0`)**: el PR es obligatorio y el CI debe pasar, pero no se exige una aprobación aparte. En un repositorio solo tuyo, tu clic en **Merge** es la decisión final, y solo tú puedes hacerlo.
- **Con aprobación formal (`REQUIRED_APPROVALS=1`)**: el PR solo entra después de que lo apruebes, y pasa a exigirse la revisión del propietario del código (archivo `CODEOWNERS`). Esto solo funciona si los PRs los abre **otra cuenta** (un bot o un colaborador). Si abres el PR con tu propia cuenta, no podrás aprobarlo y no podrás hacer el merge.

```bash
REQUIRED_APPROVALS=1 bash scripts/protect-main.sh
```

Otras opciones: `ENFORCE_ADMINS=false`, `CHECKS`, `BRANCH` y `DRY_RUN=1` (muestra lo que se aplicaría sin cambiar nada). La protección debe aplicarse **después** del primer push, porque bloquea los push directos a `main`. En repositorios privados, GitHub puede exigir un plan de pago para la protección de ramas.

## Replicar el proyecto

1. Crea un repositorio vacío en GitHub llamado `pdf-unificador` (el nombre debe coincidir con el de la imagen).
2. Sustituye el usuario `RafaelGuedes953` por el tuyo (en minúsculas en los nombres de imagen, como `rafaelguedes953`) en `.github/CODEOWNERS`, `casaos/docker-compose.yml`, `.env.example` y en los enlaces de los README.
3. Haz el primer push directamente a `main`:

   ```bash
   git init -b main
   git add .
   git commit -m "feat: initial version"
   git remote add origin git@github.com:TU_USUARIO/pdf-unificador.git
   git push -u origin main
   ```

4. Espera a que termine el workflow **Publicar imagem** (pestaña Actions). Crea el paquete en GHCR.
5. Aplica la protección de `main`, con rulesets o con `bash scripts/protect-main.sh` (consulta [Protección de la rama main](#protección-de-la-rama-main)). A partir de ahí, todo el trabajo entra por rama y pull request.
6. Instala en el servidor con una de las opciones de [Instalación](#instalación).

## Seguridad y limitaciones

- **No hay autenticación.** Úsalo solo en la red local o mediante una VPN privada, como Tailscale. No expongas el puerto a internet.
- El contenedor se ejecuta como usuario sin privilegios, con sistema de archivos de solo lectura, sin capacidades extra de Linux y con límites de memoria y de procesos.
- Se envían las cabeceras de seguridad básicas, pero no hay CSP ni HTTPS integrado. Para HTTPS, pon un proxy por delante (consulta la Hoja de ruta).
- Los PDFs protegidos con contraseña y los PDFs dañados se rechazan con un mensaje claro.
- Formatos no admitidos por ahora: HEIC, GIF y TIFF.
- La rotación que aplicas se guarda como atributo de la página, sin alterar el contenido. Los JPEG que ya tienen la orientación correcta pasan al PDF sin recompresión; los PNG, los WebP y las fotos que necesitan corrección EXIF se recodifican (JPEG con calidad 90, o PNG cuando hay transparencia).

## Hoja de ruta

El proyecto se hace por fases, una cada vez.

- [x] **Fase 1**: unir PDFs e imágenes, miniaturas, reordenar, girar, eliminar páginas, orientación EXIF, imágenes ajustadas a A4, Docker, CasaOS, CI/CD y protección de `main`.
- [ ] **Fase 2**: modo A4 con márgenes opcionales, o tamaño original; compatibilidad con HEIC; y limpieza automática de temporales (hoy no los hay, porque todo se hace en memoria; pasa a valer si algo empieza a escribirse en disco).
- [ ] **Fase 3**: dividir PDF, extraer un rango de páginas (p. ej., 2-5) y compresión con Ghostscript.
- [ ] **Fase 4**: HTTPS con Tailscale, PWA con Share Target (Android) y extras opcionales (contraseña, marca de agua, OCR).
