[English](../../README.md) · **Português (Brasil)** · [Español](README_es.md) · [Français](README_fr.md)

> Esta é uma tradução do [README em inglês](../../README.md), que é a versão de referência. Se houver diferença, vale o inglês.

# PDF Unificador

Aplicativo web para juntar **imagens e PDFs em um único PDF**. Você envia os arquivos, vê as miniaturas de cada página, reordena, gira, remove o que não quer e baixa o resultado. Foi pensado para rodar em um container num servidor doméstico (Raspberry Pi com CasaOS), acessado pelo navegador do celular ou do notebook dentro da rede local.

## Para que serve

- Juntar fotos de documentos tiradas no celular em um PDF só.
- Combinar PDFs existentes (contrato + anexos, por exemplo) na ordem certa.
- Misturar os dois: PDFs e imagens no mesmo resultado.
- Fazer tudo na sua própria máquina, sem enviar documentos para serviços de terceiros.

## O que a versão atual faz

- Aceita **PDF, JPG, PNG e WebP** (vários arquivos de uma vez; no computador também dá para arrastar e soltar).
- Mostra uma miniatura por página, inclusive para cada página de um PDF.
- **Reordena** (arrastando o cartão ou pelos botões de anterior/próximo, que ajudam no celular).
- **Gira** cada página em passos de 90 graus.
- **Remove** páginas indesejadas antes de gerar.
- Corrige a orientação das fotos de celular (EXIF), então a foto sai no PDF do jeito que aparece na tela.
- Ajusta cada imagem dentro de uma página A4 (retrato ou paisagem), sem cortar e sem deformar.
- Roda sem internet: as bibliotecas do navegador são servidas pelo próprio servidor.

A interface web está disponível apenas em português do Brasil por enquanto.

Os planos para as próximas versões estão em [Roadmap](#roadmap).

## Como funciona

1. O navegador lê os arquivos e gera as miniaturas localmente (pdf.js para PDFs).
2. Ao clicar em **Gerar PDF**, o navegador envia os arquivos originais e um pequeno plano em JSON dizendo qual página vem em que posição e com qual rotação.
3. O servidor (Node.js, Fastify, pdf-lib e sharp) monta o PDF seguindo o plano e devolve o arquivo.

O servidor **não grava nada em disco**: os arquivos são processados em memória e descartados ao fim da requisição. O container roda com sistema de arquivos somente leitura.

## Requisitos

- Para rodar: Docker com Compose (ou CasaOS). A imagem é publicada para `linux/amd64` e `linux/arm64`, então serve para PC e para Raspberry Pi de 64 bits.
- Para desenvolver: Node.js 22 ou superior.

## Instalação

### Opção 1: Docker Compose, construindo no próprio servidor

```bash
git clone https://github.com/RafaelGuedes953/pdf-unificador.git
cd pdf-unificador
cp .env.example .env        # opcional: ajuste porta e limites
docker compose up -d --build
```

Abra `http://IP-DO-SERVIDOR:8085`.

### Opção 2: imagem pronta, publicada pelo CI

O CI publica uma imagem pronta, para `amd64` e `arm64`, no GitHub Container Registry a cada mudança na `main` (veja [CI/CD](#cicd)), então não é preciso construir nada no servidor.

```bash
# no .env, defina a imagem:
# IMAGE=ghcr.io/rafaelguedes953/pdf-unificador:latest
docker compose pull
docker compose up -d
```

Se o pacote no GitHub estiver privado, faça `docker login ghcr.io` no servidor com um token que tenha a permissão `read:packages`. Se preferir não usar login, torne o pacote público nas configurações dele no GitHub.

### Opção 3: CasaOS

1. No CasaOS, abra a loja de apps e escolha instalar um app personalizado, usando a opção de **importar** um compose. Cole o conteúdo de `casaos/docker-compose.yml`. O caminho exato dos menus pode variar conforme a versão do CasaOS.
2. Na tela de instalação, a **porta do host** (padrão 8085) é um campo editável: troque se ela já estiver em uso. A porta interna do container é sempre 3000.
3. Instale e abra pelo botão do app no painel.

O arquivo inclui um bloco `x-casaos` com título, descrição e categoria para o app aparecer bem no painel.

## Configuração

Tudo é opcional. No Compose, as variáveis vêm do arquivo `.env`; no CasaOS, edite-as na tela de instalação.

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `HOST_PORT` | `8085` | Porta publicada no host (só no Compose genérico). |
| `IMAGE` | `pdf-unificador:local` | Imagem usada pelo Compose. |
| `MAX_FILES` | `20` | Máximo de arquivos por unificação. |
| `MAX_FILE_MB` | `25` | Tamanho máximo de cada arquivo, em MB. |
| `MAX_TOTAL_MB` | `100` | Tamanho máximo somado dos arquivos, em MB. |
| `MAX_PAGES` | `300` | Máximo de páginas no PDF final. |
| `MAX_IMAGE_MEGAPIXELS` | `100` | Máximo de megapixels de uma imagem. |
| `MAX_CONCURRENT_JOBS` | `2` | Unificações simultâneas; acima disso o servidor pede para tentar de novo. |
| `SHARP_CONCURRENCY` | `2` | Threads usadas no processamento de imagens. |
| `MEM_LIMIT` | `1g` | Limite de memória do container. |

O consumo de memória cresce com o tamanho dos arquivos processados, porque tudo é feito em memória. Em um Raspberry com pouca RAM, reduza `MAX_TOTAL_MB` e `MAX_CONCURRENT_JOBS`. Os valores padrão são pontos de partida razoáveis, não foram calibrados para um modelo específico de Raspberry.

## Usando

1. Toque em **Adicionar arquivos** (ou arraste arquivos para a página, no computador).
2. Ajuste a lista: arraste os cartões (no celular, segure um instante antes de arrastar) ou use os botões `‹` e `›`; gire com `↻`; remova com `✕`.
3. Toque em **Gerar PDF**. O download começa sozinho e a mensagem de status traz um link para abrir o arquivo.

### API

A interface usa uma API simples, que também serve para automações (n8n, scripts):

```bash
curl -o unificado.pdf \
  -F "files=@contrato.pdf" \
  -F "files=@foto.jpg" \
  -F 'plan={"items":[{"file":1,"page":null,"rotation":0},{"file":0,"page":0,"rotation":90}]}' \
  http://IP-DO-SERVIDOR:8085/api/merge
```

- `files`: os arquivos, na ordem; o índice do plano refere-se a essa ordem (começa em 0).
- `plan.items`: uma entrada por página do resultado, na ordem final. `page` é o índice da página (base 0) para PDFs e `null` para imagens. `rotation` é 0, 90, 180 ou 270, no sentido horário.
- Erros voltam como JSON `{"error": "mensagem"}` com o status HTTP adequado (400, 413, 415, 422 ou 429).
- `GET /health` responde `{"status":"ok"}` e `GET /api/config` informa os limites ativos.

## Modo no navegador (sem servidor)

A mesma interface também roda sem o servidor. Quando ela é servida como arquivos estáticos (por exemplo, no GitHub Pages) e `api/config` não responde, ela passa sozinha para o modo no navegador: o PDF é montado no seu próprio aparelho com o pdf-lib, e nenhum arquivo é enviado para lugar nenhum. O container continua funcionando exatamente como antes. Uma versão hospedada está disponível em https://rafaelguedes953.github.io/pdf-unificador/, publicada pelo CI no GitHub Pages.

Limitações em relação ao container:

- **Memória do aparelho.** O limite é a memória do navegador e do aparelho, não a do servidor. Lotes grandes podem falhar em celulares simples, e a página mostra uma mensagem sugerindo menos arquivos ou arquivos menores.
- **Imagens grandes são reduzidas.** Imagens acima de 16 megapixels que precisam ser recodificadas (correção de EXIF, PNG, WebP) são reduzidas para 16 MP, o que ainda dá mais de 300 dpi no A4. JPEGs que já estão na orientação correta entram no PDF intactos, em qualquer tamanho.
- **A página pode travar por um instante.** O PDF é montado na thread principal, então lotes grandes podem bloquear a tela até terminar.
- **Pouco teste em navegadores até agora.** Só foi validado no Chrome (computador). Firefox, Safari e navegadores de celular não foram testados.
- **Um 404 inofensivo no console.** O console do navegador mostra um 404 para `api/config`; essa sondagem é como o modo é detectado.

Os limites de arquivos, tamanho e páginas são os mesmos do container, e HEIC, GIF e TIFF continuam sem suporte.

## Desenvolvimento local

```bash
npm ci
npm run dev        # http://localhost:3000, recarrega ao salvar
```

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor em modo de desenvolvimento. |
| `npm run typecheck` | Verifica os tipos do TypeScript. |
| `npm test` | Roda os testes (backend e API). |
| `npm run build` | Copia as bibliotecas do navegador para `vendor/` e compila para `dist/`. |
| `npm start` | Executa a versão compilada. |

As bibliotecas do navegador (pdf.js e SortableJS) são dependências de desenvolvimento e `npm run vendor` copia só os arquivos necessários para `vendor/`. Assim elas, e as dependências pesadas que o pdf.js traz para rodar no Node, não vão para a imagem de produção.

### Estrutura

```
src/        servidor (Fastify): rotas, validação do plano, montagem do PDF
public/     interface web (HTML, CSS e JavaScript sem build)
tools/      script que prepara o vendor/
test/       testes (node:test)
scripts/    protect-main.sh (proteção da branch main)
casaos/     compose para importar no CasaOS
docs/       READMEs traduzidos
.github/    workflows de CI/CD, Dependabot, CODEOWNERS e template de PR
```

## CI/CD

Três workflows em `.github/workflows/`:

- **`ci.yml`** roda em todo pull request e em todo push na `main`:
  - `build-test`: instala dependências, verifica tipos, roda os testes e compila.
  - `docker-build`: constrói a imagem para `amd64` e `arm64`, sobe o container e confere `/health`, a interface e as bibliotecas do navegador. O build `arm64` roda emulado, então é a etapa mais demorada.
- **`publish.yml`** roda quando algo entra na `main` (ou quando se cria uma tag `vX.Y.Z`) e publica a imagem multi-arquitetura no GitHub Container Registry, em `ghcr.io/<usuario>/pdf-unificador`, com as tags `latest`, o hash do commit e, nas tags de versão, o número da versão (`1.0.0` e `1.0`). Nas tags de versão ele também confere se a tag bate com a `version` do `package.json` e, depois de publicar a imagem, cria a Release no GitHub com as notas geradas automaticamente.
- **`pages.yml`** roda quando os arquivos da interface mudam na `main` (ou manualmente) e publica o site no GitHub Pages, onde ele roda no [modo no navegador](#modo-no-navegador-sem-servidor). Antes de publicar, confere se os arquivos essenciais estão no site. Precisa de Settings → Pages → Source em **GitHub Actions**, uma única vez.

O Dependabot (`.github/dependabot.yml`) abre pull requests semanais para atualizar dependências npm, GitHub Actions e a imagem base do Docker.

Para atualizar o servidor depois de uma mudança publicada: `docker compose pull && docker compose up -d` (ou reinstale/atualize o app no CasaOS).

## Publicando uma release

1. Em uma branch, atualize a versão (`npm version 1.1.0 --no-git-tag-version`) e abra o pull request.
2. Depois do merge na `main`, crie a tag a partir da `main` atualizada e envie:

   ```bash
   git checkout main && git pull
   git tag v1.1.0
   git push origin v1.1.0
   ```

3. O workflow **Publicar imagem** publica `ghcr.io/<usuario>/pdf-unificador:1.1.0` (e `1.1`) e cria a Release no GitHub. `latest` continua apontando para o último commit da `main`.

Para fixar o Raspberry em uma versão, use a tag no lugar de `latest` (por exemplo `ghcr.io/<usuario>/pdf-unificador:1.0.0`).

## Proteção da branch main

A `main` é protegida por dois rulesets do GitHub (Settings → Rules → Rulesets), ambos ativos na branch padrão:

| Ruleset | Quem se aplica | O que exige |
|---|---|---|
| `protectMain` | todos, sem bypass | PR obrigatório (0 aprovações), checks `build-test` e `docker-build` verdes com a branch atualizada, conversas resolvidas, histórico linear, sem force push e sem exclusão |
| `requireApproval` | todos, exceto o dono em PRs | 1 aprovação, incluindo a revisão do dono do código (`CODEOWNERS`) |

Assim, qualquer colaborador precisa da aprovação do dono, e o dono só precisa que os builds passem. Não há push direto na `main` para ninguém.

### Alternativa: script

Quem preferir a proteção de branch clássica, em vez de rulesets, pode usar o script `scripts/protect-main.sh`. Não use os dois ao mesmo tempo. Ele configura a `main` para que nada entre sem pull request:

- pull request obrigatório (sem push direto);
- checks `build-test` e `docker-build` obrigatórios, com a branch atualizada antes do merge;
- discussões do PR resolvidas antes do merge;
- histórico linear, sem force push e sem exclusão da branch;
- regras valem também para administradores.

```bash
gh auth login                       # uma vez, com a conta dona do repositório
bash scripts/protect-main.sh        # detecta o repositório pela pasta atual
```

**Sobre a sua aprovação.** O GitHub não conta a aprovação do próprio autor do pull request. Por isso há duas formas de uso:

- **Padrão (`REQUIRED_APPROVALS=0`)**: o PR é obrigatório e o CI precisa passar, mas não se exige uma aprovação separada. Num repositório só seu, o seu clique em **Merge** é a decisão final, e só você consegue fazê-lo.
- **Com aprovação formal (`REQUIRED_APPROVALS=1`)**: o PR só entra depois de aprovado por você, e a revisão do dono do código (arquivo `CODEOWNERS`) passa a ser exigida. Isso só funciona se os PRs forem abertos por **outra conta** (um bot ou um colaborador). Se você abrir o PR com a sua própria conta, não conseguirá aprová-lo e ficará sem poder fazer o merge.

```bash
REQUIRED_APPROVALS=1 bash scripts/protect-main.sh
```

Outras opções: `ENFORCE_ADMINS=false`, `CHECKS`, `BRANCH` e `DRY_RUN=1` (mostra o que seria aplicado sem alterar nada). A proteção precisa ser aplicada **depois** do primeiro push, porque ela bloqueia pushes diretos na `main`. Em repositórios privados, o GitHub pode exigir um plano pago para proteção de branch.

## Replicando o projeto

1. Crie um repositório vazio no GitHub chamado `pdf-unificador` (o nome precisa bater com o da imagem).
2. Troque o usuário `RafaelGuedes953` pelo seu (em minúsculas nos nomes de imagem, como `rafaelguedes953`) em `.github/CODEOWNERS`, `casaos/docker-compose.yml`, `.env.example` e nos links dos READMEs.
3. Faça o primeiro push direto na `main`:

   ```bash
   git init -b main
   git add .
   git commit -m "feat: initial version"
   git remote add origin git@github.com:SEU_USUARIO/pdf-unificador.git
   git push -u origin main
   ```

4. Espere o workflow **Publicar imagem** terminar (aba Actions). Ele cria o pacote no GHCR.
5. Aplique a proteção da `main`, com rulesets ou com `bash scripts/protect-main.sh` (veja [Proteção da branch main](#proteção-da-branch-main)). A partir daí, todo trabalho entra por branch e pull request.
6. Opcional: para publicar o site do modo no navegador, ative o GitHub Pages (Settings → Pages → Source: **GitHub Actions**); o workflow **Publicar site** faz o resto.
7. Instale no servidor por uma das opções de [Instalação](#instalação).

## Segurança e limitações

- **Não há autenticação.** Use apenas na rede local ou por uma VPN privada, como o Tailscale. Não exponha a porta na internet.
- O container roda como usuário sem privilégios, com sistema de arquivos somente leitura, sem capacidades extras do Linux e com limites de memória e de processos.
- Os cabeçalhos de segurança básicos são enviados, mas não há CSP nem HTTPS embutidos. Para HTTPS, coloque um proxy na frente (veja o Roadmap).
- PDFs protegidos por senha e PDFs corrompidos são recusados com uma mensagem clara.
- Formatos não suportados no momento: HEIC, GIF e TIFF.
- A rotação que você aplica é gravada como atributo da página, sem alterar o conteúdo. JPEGs que já estão na orientação correta seguem para o PDF sem recompressão; PNG, WebP e fotos que precisam de correção de EXIF são recodificados (JPEG com qualidade 90, ou PNG quando há transparência).

## Roadmap

O projeto é feito por fases, uma de cada vez.

- [x] **Fase 1**: unir PDFs e imagens, miniaturas, reordenar, girar, remover páginas, orientação EXIF, imagens ajustadas ao A4, Docker, CasaOS, CI/CD e proteção da `main`.
- [ ] **Fase 2**: modo A4 com margens (opcional) ou tamanho original, suporte a HEIC e limpeza automática de temporários (hoje não há temporários, pois tudo é feito em memória; passa a valer se algo for gravado em disco).
- [ ] **Fase 3**: dividir PDF, extrair intervalo de páginas (ex.: 2-5) e compressão com Ghostscript.
- [ ] **Fase 4**: HTTPS com Tailscale, PWA com Share Target (Android) e extras opcionais (senha, marca d'água, OCR).
