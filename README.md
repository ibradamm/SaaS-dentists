# Plateforme de gestion de cabinet dentaire

Périmètre actuel : SaaS de gestion du cabinet pour le personnel (ADR 0004). WhatsApp, l'agent IA et Google Calendar sont des extensions futures (`docs/future/`).

Monorepo TypeScript :
- API (Fastify) et worker (pg-boss) ;
- interface web (React) ;
- base PostgreSQL 16 avec isolation des données par cabinet.

Fonctionnalités disponibles :
- comptes, rôles (administrateur, dentiste, secrétaire), double authentification ;
- dossiers patients : recherche, doublons, téléphones, archivage, notes médicales restreintes et chiffrées ;
- import de patients depuis un fichier CSV ou Excel (menu Patients → « Importer un fichier », administrateur ; voir ADR 0005) ;
- cabinet (profil, praticiens, types de rendez-vous) et disponibilités par praticien : horaires datés, absences, blocages, dans le fuseau du cabinet (ADR 0006) ;
- agenda des rendez-vous (menu « Agenda ») : vues jour et semaine, création avec créneaux libres proposés, déplacement, statuts (prévu, honoré, patient absent, annulé), historique sur la fiche patient ; double réservation impossible, y compris en base ; hors horaires, sur un blocage ou dans le passé seulement après confirmation explicite, tracée (ADR 0007, 0008) ;
- parcours par rôle (ADR 0008) : accueil « Aujourd'hui » (« Ma journée » pour un praticien, journée du cabinet pour le secrétariat, mise en route pour l'administrateur), recherche rapide de patient, création d'un patient pendant la prise de rendez-vous ; interface adaptée à l'ordinateur, à la tablette et au téléphone ;
- paiements (section « Paiements » de la fiche patient, bouton « Encaisser » d'un rendez-vous) : actes à encaisser, paiements partiels, restant dû, annulations motivées réservées au dentiste et à l'administrateur ; liste « À encaisser » ; revenus encaissés par période pour le dentiste et l'administrateur. Montants en centimes entiers, aucune donnée financière modifiable ni supprimable, double saisie impossible (ADR 0009) ;
- tableau de bord (ADR 0010) : « À suivre » sur l'accueil (rendez-vous à venir, restant à encaisser, rendez-vous honorés sans acte, encaissé du jour) et page « Statistiques » (jour, semaine, mois, année ou période libre, par praticien) : activité, taux d'absence et d'annulation, occupation, patients, revenus et leur évolution. Tout est calculé par le serveur, selon les permissions de chacun.

Architecture et décisions : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/adr/`](docs/adr). Avancement : [`docs/phases/`](docs/phases).

## Prérequis

- Node.js ≥ 22.12 (`.nvmrc`), pnpm 10 (`corepack enable`)
- PostgreSQL 16, au choix :
  - Docker : `docker compose -f infra/docker-compose.yml up -d`
  - sans Docker, binaires PostgreSQL installés : `pnpm dev:db` (cluster local dans `.data/pg`)

## Démarrage

```bash
pnpm install
pnpm setup:env            # crée .env (valeurs locales + clé de chiffrement générée)
pnpm db:bootstrap         # rôles dental_owner / dental_app et base (une fois)
pnpm db:migrate           # migrations + schéma de la file de tâches
pnpm db:seed              # cabinet de démonstration + 3 comptes (mots de passe temporaires affichés)

pnpm dev:api              # http://127.0.0.1:3000/health/ready
pnpm dev:worker
pnpm dev:web              # http://127.0.0.1:5173
```

Première connexion d'un compte :
1. mot de passe temporaire ;
2. choix d'un mot de passe personnel ;
3. pour les administrateurs et les dentistes, mise en place de la double authentification (application TOTP).

## Administration (tous environnements, rôle propriétaire)

```bash
pnpm admin:create-clinic --name "Cabinet X" --timezone Europe/Paris --locale fr-FR --currency EUR --country FR
pnpm admin:create-admin --clinic <id> --email admin@cabinet.fr --name "Nom Prénom"
pnpm admin:reset-mfa --email admin@cabinet.fr   # perte du téléphone du seul administrateur
```

## Vérifications (identiques à la CI)

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm check:bundle
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
- Toute requête métier passe par `withTenant` (`apps/server/src/db/tenant.ts`) et filtre aussi explicitement par `clinic_id`.
- Toute action protégée appelle `authorize()` dans son service ; la route déclare aussi la permission (`config.access`).
- Toute table du schéma public reçoit RLS, `FORCE` et une politique ; le test `schema-catalog` l'impose.
- Une migration appliquée n'est jamais modifiée (voir ADR 0002).
- Toute nouvelle table liée aux patients doit être prise en compte par l'annulation d'import ; le test `schema-catalog` l'impose.
