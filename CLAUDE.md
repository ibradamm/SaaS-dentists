# Consignes pour Claude Code

Projet : plateforme de gestion de cabinet dentaire. Le plan validé est dans `docs/ARCHITECTURE.md`. Le travail avance **par phases** : ne commencer une phase qu'après validation de la précédente par l'utilisateur.

## Commandes

- Environnement local : `pnpm setup:env` (crée `.env` avec une clé de chiffrement)
- Vérification complète : `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm check:bundle`
- PostgreSQL local sans Docker : `pnpm dev:db`, puis `pnpm db:bootstrap && pnpm db:migrate`
- Parcours de bout en bout (build de production puis Playwright, ~5 min) : `pnpm e2e` ; un fichier : `pnpm build && pnpm --filter @dental/e2e exec playwright test tests/<fichier>`
- Test réel de Sentry (staging uniquement, `SENTRY_DSN` en variable d'environnement) : `APP_ENV=staging pnpm --filter @dental/server sentry:check`
- Vérification d'un déploiement hébergé (HTTPS, TLS, en-têtes, CORS, erreurs, cookies, adresse du client, limitation derrière le proxy) : `pnpm --filter @dental/e2e check:deployment --url https://… --accounts comptes.json [--rate-limit --expect-ip …]` ; comptes de test synthétiques : `staging:accounts` ; temps de réponse : `staging:timings`
- Pile staging locale (images de production, Caddy, proxy de périmètre simulé, HTTPS) : `infra/staging-local/compose.yml` (exécutée en CI). Déploiement du staging : `docs/operations/deploiement-staging.md` (ADR 0013), jamais sans budget accordé par le porteur du projet
- Nouvelle migration :
  - après une modification de `apps/server/src/db/schema` : `pnpm --filter @dental/server db:generate` ;
  - SQL manuel (RLS, droits, triggers) : `pnpm --filter @dental/server exec drizzle-kit generate --custom --name=<nom>`.

## Règles non négociables

- Ne jamais annoncer qu'un test est passé sans l'avoir exécuté ; ne jamais présenter une intégration comme fonctionnelle sans l'avoir vérifiée.
- Toute requête métier passe par `withTenant` et filtre aussi explicitement par `clinic_id`. Toute table du schéma public a RLS activée et forcée, avec une politique.
- Toute action protégée appelle `authorize(actor, permission)` dans son service. Les permissions et la matrice des rôles viennent de `packages/shared/src/permissions.ts`, et `permissions.test.ts` doit être mis à jour à chaque changement.
- Un compteur d'échecs (connexion, codes TOTP) est écrit dans une transaction validée *avant* de lever l'erreur.
- L'API et le worker utilisent le rôle `dental_app`. Le rôle `dental_owner` sert uniquement aux migrations et à l'administration.
- Une migration appliquée est immuable. Pas de migration descendante (ADR 0002).
- Toute conversion heure locale ↔ instant passe par `modules/scheduling/local-time.ts` (heure murale, fuseau du cabinet) ; aucune conversion dans le fuseau du serveur ou du navigateur (ADR 0006).
- Toute nouvelle table qui référence `patients` est intégrée aux conditions d'annulation d'import (`imports.service.ts`, `revert`) ; le test `schema-catalog` l'impose (ADR 0005).
- Rendez-vous : la contrainte d'exclusion est la garantie finale contre la double réservation ; toute écriture qui dépend des horaires ou des indisponibilités prend d'abord le verrou du praticien (`lockPractitioners`). Une dérogation (hors horaires, blocage) n'est jamais automatique et toujours tracée (ADR 0007).
- Les permissions sont vérifiées côté serveur, jamais seulement dans l'interface.
- Toute route déclare `config.access` (`public`, `authenticated`, `allow`, `permission` ou `anyPermission`) : sinon l'API refuse de démarrer. La matrice `security-matrix.int.test.ts` et le test `cross-clinic.int.test.ts` couvrent automatiquement toute nouvelle route ; une nouvelle ressource à identifiant s'ajoute à `RESOURCE_BY_PREFIX` (ADR 0011).
- Toute nouvelle action tracée s'ajoute au catalogue `AUDIT_ACTIONS` et à son libellé (`packages/shared/src/audit.ts`, `audit-labels.ts`) : `recordAudit` refuse le reste. L'audit ne recopie jamais un contenu saisi.
- Une erreur se journalise sous la clé `err` (sérialiseur par liste blanche) ; jamais de valeur saisie dans un message de log. La remontée Sentry passe par `ErrorReporter`, sans SDK (ADR 0011).
- Toute tentative d'authentification (mot de passe, code) passe par `lockAttempts` et compte ses échecs pour le compte, dans la transaction validée avant l'erreur.
- Aucun secret dans le code ni dans Git. Aucune donnée sensible dans les logs.
- Toute action asynchrone ou externe est enfilée dans la transaction métier via `enqueue` (outbox).
- Une fonctionnalité visible par le personnel ajoute ou étend un parcours `e2e/tests/` ; toute donnée saisie par un parcours est déclarée dans `e2e/support/sentinels.ts` (contrôle final des journaux, de l'audit et de la file de tâches). Pas de relance automatique d'un test instable : on le corrige (ADR 0012).
- Toute création rejouable par un nouvel essai porte une clé d'idempotence, gardée tant que l'issue est inconnue (`lib/idempotency.ts`) : encaissements (ADR 0009), rendez-vous (ADR 0007, section 11).
- En-têtes de sécurité de l'interface : source unique `apps/web/security-headers.ts`, à reprendre à l'identique par le proxy ; aucune page ne doit déclencher de violation de CSP (pas de `unsafe-inline` ni `unsafe-eval`).
- Déploiement (ADR 0013) : une seule instance d'API (limiteur en mémoire) ; seul le service `migrate` détient les accès propriétaire et administrateur de PostgreSQL et finit par `check-database` ; Caddy sans journal d'accès ; aucun coût engagé ni service payant activé sans accord explicite du porteur du projet.
- Texte comparable (recherche, doublons, import) : `normalizeForSearch` garde les lettres de tous les alphabets (noms en arabe et en tifinagh au Maroc).
- Toute date ou heure affichée passe par le fuseau du cabinet (`formatDateTime(iso, timeZone)`, `lib/dates.ts`) ; `timezone-guard.test.ts` refuse le reste.
- Périmètre actuel : SaaS de gestion du cabinet uniquement. Aucune fonctionnalité WhatsApp, agent IA ou Google Calendar (extensions futures, `docs/future/`).
