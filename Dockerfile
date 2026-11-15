# syntax=docker/dockerfile:1

# ---- build: compila o TypeScript ----
FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY tools ./tools
COPY src ./src
# "build" copia as libs do navegador para vendor/ e compila o TypeScript para dist/.
RUN npm run build

# ---- deps: só as dependências de produção ----
FROM node:26-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime: imagem final ----
FROM node:26-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/vendor ./vendor
COPY public ./public
COPY package.json ./

# Roda sem privilégios (usuário "node" já existe na imagem oficial).
USER node
EXPOSE 3000

# Usa o fetch do próprio Node, então a imagem não precisa de curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
