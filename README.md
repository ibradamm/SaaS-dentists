# Plateforme de gestion de cabinet dentaire

Monorepo TypeScript :
- API (Fastify) et worker (pg-boss) ;
- interface web (React) ;
- base PostgreSQL 16 avec isolation des données par cabinet.

Architecture et décisions : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/adr/`](docs/adr). Avancement : [`docs/phases/`](docs/phases).

## Prérequis

- Node.js ≥ 22.12 (`.nvmrc`), pnpm 10 (`corepack enable`)
- PostgreSQL 16, au choix :
  - Docker : `docker compose -f infra/docker-compose.yml up -d`
  - sans Docker, binaires PostgreSQL installés : `pnpm dev:db` (cluster local dans `.data/pg`)

## Démarrage

```bash
pnpm install
cp .env.example .env      # valeurs de développement local uniquement
pnpm db:bootstrap         # rôles dental_owner / dental_app et base (une fois)
pnpm db:migrate           # migrations + schéma de la file de tâches
pnpm db:seed              # cabinet de démonstration (development uniquement)

pnpm dev:api              # http://127.0.0.1:3000/health/ready
pnpm dev:worker
pnpm dev:web              # http://127.0.0.1:5173
```

## Vérifications (identiques à la CI)

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

- Les tests d'intégration créent une base jetable, y appliquent toutes les migrations et se connectent avec le rôle applicatif réel (RLS active).
- Ils ont besoin de `TEST_DATABASE_ADMIN_URL`, `DATABASE_OWNER_PASSWORD` et `DATABASE_APP_PASSWORD`, lus depuis `.env`.
- Attention : les rôles PostgreSQL sont communs à tout le cluster. Le bootstrap (y compris celui des tests) réaffirme leurs mots de passe. Lancer les tests avec d'autres mots de passe que ceux du `.env` modifie donc aussi ceux de la base de développement du même cluster.

## Structure

```
apps/server     API, worker, accès aux données, migrations, intégrations
apps/web        interface (React + Vite + Tailwind)
packages/shared contrats Zod partagés entre API et interface
infra/          docker-compose de développement
scripts/        outils de développement (PostgreSQL local)
docs/           architecture, décisions (ADR), rapports de phase
```

## Règles

- Jamais de secret dans le dépôt : `.env` est ignoré par Git et gitleaks tourne en CI.
- Toute requête métier passe par `withTenant` (`apps/server/src/db/tenant.ts`).
- Toute nouvelle table portant `clinic_id` reçoit RLS, `FORCE` et une politique ; le test `schema-catalog` l'impose.
- Une migration appliquée n'est jamais modifiée (voir ADR 0002).
