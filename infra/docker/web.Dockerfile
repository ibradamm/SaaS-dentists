# Image de l'interface : fichiers compilés servis par Caddy, qui relaie /api vers l'API
# (infra/caddy). Construite depuis la racine du dépôt : docker build -f infra/docker/web.Dockerfile .
FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e AS build
RUN npm install -g pnpm@10.33.0
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @dental/web... \
  && pnpm --filter @dental/web build \
  && node apps/web/scripts/caddy-headers.mjs > /security-headers.caddy

FROM caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d
COPY infra/caddy/Caddyfile infra/caddy/app.caddy /etc/caddy/
COPY --from=build /security-headers.caddy /etc/caddy/security-headers.caddy
COPY --from=build /repo/apps/web/dist /srv
# Sans droits d'administration : Caddy n'écrit que dans /data et /config.
RUN chown -R nobody:nobody /data /config
USER nobody
