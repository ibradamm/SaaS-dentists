# Phase 1 — Fondations : rapport

Date : 2026-09-26. Statut : **code et tests locaux terminés** ; résultat de la CI GitHub consigné ci-dessous après exécution.

## Livré

| Élément | Emplacement |
|---|---|
| Monorepo pnpm (3 paquets), TypeScript strict, ESLint avec règles de frontières, Prettier | racine |
| Configuration validée par Zod pour chaque point d'entrée : une variable invalide bloque le démarrage, sans jamais afficher sa valeur | `apps/server/src/config/env.ts` |
| Logs JSON structurés (pino), champs sensibles masqués, identifiant de requête généré par le serveur | `config/logger.ts`, `api/app.ts` |
| Rôles PostgreSQL séparés (propriétaire / applicatif), bootstrap idempotent | `db/bootstrap.ts`, `db/roles.ts` |
| Schéma `clinics` et `audit_logs`, migrations générées par drizzle-kit et SQL manuel (RLS, droits, triggers) | `db/schema/`, `db/migrations/` |
| Exécuteur de migrations strict : verrou, empreintes, ordre, sens unique | `db/migrator.ts`, ADR 0002 |
| Isolation multi-cabinet : RLS forcée, `withTenant`, `clinic_id` par défaut, garde de démarrage | `db/tenant.ts`, `db/guard.ts`, ADR 0001 |
| Journal d'audit en ajout seul, écriture validée par Zod | `modules/audit/` |
| File de tâches pg-boss : installée par le propriétaire, exécutée par le rôle applicatif, envoi transactionnel (outbox) | `jobs/queue.ts`, `db/deploy.ts` |
| API Fastify : `/health/live`, `/health/ready`, format d'erreur unique sans fuite interne, en-têtes de sécurité (helmet), taille de corps limitée | `api/` |
| Worker : démarrage, arrêt propre (SIGTERM), registre des gestionnaires (vide pour l'instant) | `main-worker.ts`, `jobs/handlers.ts` |
| Build de production (esbuild), migrations copiées dans `dist/` | `apps/server/scripts/build.mjs` |
| Interface web minimale : vérifie la chaîne interface → API → base via le contrat partagé | `apps/web` |
| Contrats partagés (codes d'erreur, réponses de santé) | `packages/shared` |
| CI GitHub Actions : formatage, lint, typage, dérive schéma/migrations, tests avec PostgreSQL 16, build, gitleaks (historique complet), audit des dépendances | `.github/workflows/ci.yml` |
| PostgreSQL de développement : docker-compose, ou script sans Docker | `infra/`, `scripts/dev-postgres.sh` |
| `.env.example`, `.gitignore`, `.gitleaks.toml`, README, CLAUDE.md, ADR 0001-0002 | racine, `docs/` |

## Vérifications exécutées

Environnement : Node 22.22, PostgreSQL 16.13 local.

| Vérification | Résultat |
|---|---|
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | OK |
| Tests `packages/shared` | 3/3 |
| Tests `apps/web` (jsdom) | 3/3 |
| Tests `apps/server` : unitaires + intégration sur base jetable, rôle applicatif réel | 55/55 |
| Test par mutation : RLS retirée sur `audit_logs` / UPDATE+DELETE accordés sur l'audit / contexte cabinet non local | 6, 3 et 3 tests échouent respectivement : les tests détectent bien ces régressions |
| Build serveur et web ; migration exécutée depuis `dist/` | OK |
| Démarrage réel de l'API (`/health/ready` = 200, 404 et 400 au format standard) et du worker (rôle applicatif) | OK |
| Garde de démarrage : l'API lancée avec le rôle propriétaire refuse de démarrer | OK |
| `drizzle-kit generate` après commit : aucune dérive | OK |
| gitleaks 8.30.1 (compilé localement) : arbre de travail et historique | aucune fuite ; une fausse clé plantée est bien détectée |
| `pnpm audit --prod --audit-level high` | aucune vulnérabilité |
| `docker compose config` | syntaxe valide ; **non exécuté** (pas de moteur Docker dans l'environnement) |

Couverture des tests d'intégration :
- **Isolation** : 12 tests (lecture, écriture croisée, mise à jour croisée, disparition du contexte sur la même connexion, rollback, identifiant invalide, droits de colonnes).
- **Catalogue** : toute table portant `clinic_id` est protégée ; rôle applicatif non privilégié ; audit en ajout seul ; aucun droit CREATE.
- **Audit**, **outbox** (commit, rollback, traitement par le worker, maintenance avec les droits applicatifs), **migrations** (idempotence, deux déploiements concurrents), **API** (santé, 503 si base indisponible, erreurs, en-têtes, corps trop gros), **configuration**.

## Écarts par rapport au plan validé

1. **TypeScript 6.0.3 au lieu de 7.0** : typescript-eslint 8.70 n'accepte que TypeScript < 6.1.
2. **Pas de migrations descendantes** (ADR 0002). Le critère « up/down » est remplacé par : base vierge, idempotence, concurrence, dérive.
3. **Migrateur Drizzle non utilisé**. Il ignore en silence les migrations appliquées hors ordre, ne vérifie pas les empreintes et ne prend pas de verrou (ADR 0002).
4. **Table `users` déplacée en Phase 2**, avec memberships, rôles et sessions, pour concevoir l'authentification d'un bloc.
5. **Limitation du nombre de requêtes (rate limiting) reportée en Phase 2**, avec les limites propres à la connexion.

## Limites connues

- **CI GitHub** : les résultats sont à lire sur GitHub après le push. L'étape gitleaks de la CI télécharge le binaire officiel, que je n'ai pas pu télécharger ici.
- **Somme de contrôle de gitleaks** : lue depuis la même release que le binaire. Elle protège contre la corruption, pas contre une release compromise. Figer l'empreinte SHA-256 dans le workflow est à faire.
- **Vulnérabilité modérée** dans esbuild ≤ 0.24.2 : dépendance de développement via drizzle-kit, concerne uniquement le serveur de développement d'esbuild, que drizzle-kit n'utilise pas. Non corrigée pour ne pas casser drizzle-kit ; à surveiller.
- **Taille du bundle web** : 300 ko (92 ko gzip), à cause de Zod complet. Optimisation à envisager en Phase 8.
- **Mots de passe des rôles communs au cluster** : le bootstrap les réaffirme. Des tests lancés avec d'autres mots de passe modifient donc ceux de la base de développement du même cluster (constaté pendant la vérification). Sans effet en CI (cluster jetable) ; à revoir si un cluster est partagé entre développeurs.
- **TLS vers PostgreSQL en production** : non imposé pour l'instant, décision en Phase 13 selon l'hébergement.

## Reste à faire (phases suivantes)

La Phase 2 (authentification, rôles, permissions) démarre après ta validation de ce rapport.
