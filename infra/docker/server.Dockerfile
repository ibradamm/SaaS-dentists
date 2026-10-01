# Image du serveur : API, worker, bootstrap, migrations et commandes d'administration.
# Même image pour chaque service, seule la commande change (docs/operations/deploiement-staging.md).
# Construite depuis la racine du dépôt : docker build -f infra/docker/server.Dockerfile .
FROM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS build
RUN npm install -g pnpm@10.33.0
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @dental/server... \
  && pnpm --filter @dental/server build \
  && pnpm --filter @dental/server deploy --prod --legacy /out

FROM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist ./dist
USER node
CMD ["node", "dist/main-api.js"]
