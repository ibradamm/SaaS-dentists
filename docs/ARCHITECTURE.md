# Plateforme de gestion de cabinet dentaire — Phase 0 : analyse et architecture

> Statut : **proposition en attente de validation**. Aucun code applicatif n'a été écrit.
> Date : 2026-09-26. Toute information marquée **[À VÉRIFIER]** n'a pas pu être confirmée
> sur la documentation officielle depuis l'environnement de développement (accès réseau restreint).

### Révision 1 (2026-09-26) — relecture critique et vérifications

| Point | Résultat |
|---|---|
| Environnement (section 0.2) | Revérifié : conforme (Docker sans daemon, Redis 7.0, PostgreSQL 16 serveur, Chromium Playwright ; Meta bloqué ; `developers.google.com` également bloqué) |
| Modèles et tarifs Claude | Confirmés (référence Anthropic du 2026-06-24). Ajout de Claude Opus 5.5 comme option (N.2) |
| Tarification WhatsApp au 1er octobre 2026 | Confirmée par plusieurs sources secondaires concordantes ; page officielle Meta toujours inaccessible **[À VÉRIFIER]** |
| Politique Meta sur les chatbots IA | Confirmée : bots dédiés à un processus (prise de rendez-vous) autorisés |
| Quotas Google Calendar 2026 | Confirmés par sources secondaires citant la page officielle |
| Paquets npm | Versions et licences vérifiées sur le registre npm (L) ; pg-boss 12 documente la création de jobs dans une transaction existante, y compris via Drizzle |
| **Correction H.3** | Le calendrier miroir ne doit **pas** appartenir au compte de service : Google déconseille explicitement un compte de service comme propriétaire d'un calendrier secondaire. Il appartient désormais à un compte Google du cabinet et est partagé avec le compte de service |
| **Ajout L / M13 / O1** | La politique WhatsApp Business interdit d'envoyer ou de demander des informations de santé **si la réglementation applicable l'interdit** sur des systèmes ne répondant pas à des exigences renforcées. Question juridique avancée : elle bloque désormais la Phase 6, pas seulement la production |
| Ajouts | Table `messaging_channels` (routage des webhooks vers le bon cabinet), verrou par praticien étendu aux blocages, gestion du `refusal` et des fallbacks côté API Claude, observabilité (A.5), environnements (A.6), durées de conservation proposées (J.2) |

---

## 0. Constat de départ

### 0.1 Projet existant
- Dépôt `ibradamm/SaaS-dentists` **vide** (aucun commit). Rien à reprendre, aucune dette existante.

### 0.2 Environnement de développement (conteneur Claude Code)
| Élément | État | Conséquence |
|---|---|---|
| Node.js 22, pnpm 10 | disponibles | Stack TypeScript utilisable immédiatement |
| Python 3.11, uv | disponibles | Non retenu (voir B) |
| PostgreSQL 16 (binaires serveur `initdb`, `pg_ctl`) | disponibles, aucun cluster lancé | Tests d'intégration possibles sur un vrai PostgreSQL local |
| Redis 7 | disponible | Non nécessaire au MVP (voir B) |
| Docker | client présent, **pas de daemon** | `docker compose` fourni pour votre machine, mais non exécutable ici |
| Chromium + Playwright | disponibles | Tests E2E de l'interface possibles |
| Réseau sortant | npm/PyPI OK ; `api.anthropic.com` joignable ; `www.googleapis.com` joignable ; **`graph.facebook.com`, `developers.facebook.com` et `developers.google.com` bloqués** | L'intégration WhatsApp réelle **ne peut pas être vérifiée depuis cet environnement** : elle le sera sur un environnement de staging avec vos identifiants |
| Secrets | aucune clé Anthropic/Google/Meta configurée | Les intégrations réelles nécessiteront des identifiants de test fournis par vous |

---

## A. Architecture proposée

### A.1 Décisions structurantes (déduites des invariants métier)

Les exigences se réduisent à cinq invariants non négociables. Chaque décision d'architecture en découle.

| Invariant | Mécanisme qui le garantit (et pas seulement le prompt) |
|---|---|
| I1. Aucune double réservation | Contrainte d'exclusion PostgreSQL (`EXCLUDE USING gist`) sur `(praticien, plage horaire)` + verrou transactionnel par praticien |
| I2. Aucune réservation sans confirmation du patient | Réservation en deux temps : `HELD` (blocage temporaire) → `CONFIRMED` uniquement sur un événement patient postérieur à la proposition (bouton WhatsApp ou nouveau message) ; vérifié par le code |
| I3. L'agent n'invente ni créneau ni rendez-vous | L'agent ne peut réserver qu'un créneau **renvoyé par le système** (référence opaque stockée côté serveur) ; le message de confirmation final est généré par le code à partir de la base, pas par le LLM |
| I4. Aucune fuite entre cabinets ni entre patients | `clinic_id` partout + clés étrangères composites + Row-Level Security PostgreSQL ; les outils de l'agent reçoivent le contexte (cabinet, conversation, téléphone) du serveur, jamais du LLM |
| I5. Permissions vérifiées côté serveur | RBAC dans la couche service, appliqué à tous les points d'entrée (API web, outils de l'agent, jobs) |

**Source de vérité unique : PostgreSQL.** Google Calendar n'offre aucune opération atomique « créer seulement si libre » : deux requêtes concurrentes peuvent toutes deux lire un créneau libre puis créer un événement. Il ne peut donc pas garantir I1. Il devient un **miroir** (projection en lecture pour le dentiste et la secrétaire sur leurs téléphones) et, optionnellement, une **source d'indisponibilités** importées. Détails en section H.

### A.2 Vue d'ensemble

```
                 ┌──────────────┐       ┌──────────────────────┐
 Patient ──────► │  WhatsApp    │──────►│  API (Fastify)        │◄──── Navigateur
 (WhatsApp)      │  Cloud API   │webhook│  - webhooks signés    │      (React SPA :
                 │  (Meta)      │◄──────│  - REST + sessions    │       dentiste,
                 └──────────────┘ envoi │  - RBAC + tenant      │       secrétaire,
                                        └──────────┬───────────┘       admin)
                                                   │ services métier (même code)
                                        ┌──────────▼───────────┐
                                        │  PostgreSQL 16        │  ◄── source de vérité
                                        │  - données métier     │      (RDV, patients,
                                        │  - file de jobs       │       paiements, audit)
                                        │    (pg-boss, outbox)  │
                                        └──────────▲───────────┘
                                                   │
                                        ┌──────────┴───────────┐
                                        │  Worker (Node)        │
                                        │  - agent IA (boucle)  │────► API Claude (Anthropic)
                                        │  - envoi WhatsApp     │────► WhatsApp Cloud API
                                        │  - synchro calendrier │◄───► Google Calendar API
                                        │  - rappels, expirations│
                                        └──────────────────────┘
```

- **Deux processus** issus d'une même base de code : `api` (HTTP) et `worker` (jobs asynchrones). Le webhook WhatsApp répond en quelques millisecondes et délègue le traitement au worker : Meta réémet les webhooks qui ne sont pas acquittés rapidement, et un appel LLM prend plusieurs secondes.
- **Outbox transactionnelle** : toute action externe (envoi WhatsApp, écriture Google Calendar, rappel) est enregistrée comme job **dans la même transaction** que la modification métier. Si WhatsApp ou Google est indisponible, rien n'est perdu : le job est rejoué avec backoff exponentiel.
- **Monolithe modulaire** plutôt que microservices : une seule équipe, un seul cabinet au départ, faible volumétrie (quelques centaines de messages par jour). Les microservices ajouteraient du réseau, du déploiement et de la cohérence distribuée sans bénéfice ici.

### A.3 Couches (séparation des responsabilités)

```
Adaptateurs d'entrée     Routes HTTP │ Handlers de jobs │ Outils de l'agent
                               ▼              ▼                 ▼
Services métier          patients, scheduling, appointments, conversations,
(règles, RBAC, audit)    messaging, finance, clinics, identity, audit
                               ▼
Accès aux données        Repositories (Drizzle) — toujours dans un contexte tenant
                               ▼
Ports d'intégration      WhatsAppPort, CalendarPort, LlmPort (+ implémentations factices pour les tests)
```

Règle : les outils de l'agent et les routes HTTP appellent **les mêmes services**. Aucune règle métier n'est dupliquée dans l'agent ou dans le frontend.

### A.4 Surface d'API REST (aperçu, détaillée phase par phase)

| Domaine | Endpoints principaux |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/mfa/*` |
| Patients | `GET/POST /patients`, `GET/PATCH /patients/:id`, `GET /patients/:id/appointments`, `GET /patients/:id/payments` |
| Agenda | `GET /appointments?from&to&practitionerId`, `POST /appointments`, `PATCH /appointments/:id` (déplacer/modifier, verrou optimiste par `version`), `POST /appointments/:id/cancel` |
| Disponibilités | `GET /availability?type&from&to`, `GET/PUT /practitioners/:id/working-hours`, `POST/DELETE /availability-blocks` |
| Conversations | `GET /conversations?mode=HUMAN`, `GET /conversations/:id/messages`, `POST /conversations/:id/messages`, `POST /conversations/:id/handoff/release` |
| Finances | `GET/POST /payments`, `POST /payments/:id/void`, `GET/POST /charges`, `GET /finance/summary?period` |
| Admin | `GET/POST /users`, `PATCH /users/:id/role`, `GET/PUT /clinic/settings`, `GET /audit-logs` |
| Webhooks | `GET/POST /webhooks/whatsapp`, `POST /webhooks/google-calendar` |
| Santé | `GET /health/live`, `GET /health/ready` |

Contrats d'entrée/sortie définis en **Zod** dans un paquet partagé, utilisés à la fois pour la validation serveur et le typage du frontend.

### A.5 Observabilité

| Besoin | Mécanisme |
|---|---|
| Logs structurés | pino (JSON), un `request_id` propagé de la requête HTTP aux jobs qu'elle crée ; champs sensibles masqués à la source |
| Métriques | Endpoint `/metrics` (format Prometheus, `prom-client`) exposé uniquement sur le réseau interne : latence HTTP, profondeur et échecs des files de jobs, âge de la dernière synchro Google, échecs d'envoi WhatsApp, runs d'agent par issue (REPLIED/HANDOFF/ERROR/LIMIT), tokens consommés |
| Erreurs | Service de suivi d'erreurs compatible Sentry (hébergé en UE ou auto-hébergé, par ex. GlitchTip), avec suppression des données personnelles avant envoi |
| Traçabilité de l'agent | `agent_runs` + `agent_tool_calls` en base, consultables par l'ADMIN : pour chaque réponse envoyée, on retrouve l'intention détectée, les outils appelés, leurs entrées/sorties masquées et le résultat |
| Alertes métier | Bandeaux dans l'application (synchro Google en retard, messages WhatsApp en échec, handoffs urgents non pris en charge) |

### A.6 Environnements

`APP_ENV` ∈ `development`, `test`, `staging`, `production`. La configuration est lue une seule fois au démarrage et validée par un schéma Zod : une variable manquante ou invalide empêche le démarrage. `test` utilise une base créée puis détruite à chaque exécution et des fakes pour toutes les intégrations externes. `staging` sert aux tests réels (numéro de test Meta, calendrier de test, clé Anthropic dédiée) et ne contient jamais de données patients réelles.

---

## B. Stack technique proposée

Chaque choix est comparé à l'alternative crédible principale. Critères : fiabilité, simplicité, maintenabilité, adéquation au besoin.

| Besoin | Choix | Alternative écartée | Raison du choix |
|---|---|---|---|
| Langage | **TypeScript** (front + back) | Python (FastAPI) + TS (front) | Un seul langage : contrats Zod partagés entre API et interface, SDK officiels Anthropic et Google en TypeScript, une seule chaîne d'outillage |
| Runtime | **Node.js 22 LTS** | Bun | Maturité, compatibilité des bibliothèques |
| Framework API | **Fastify 5** + Zod | NestJS | Moins d'abstraction (pas d'injection de dépendances par décorateurs), code explicite plus facile à relire et à tester ; la structure en modules est imposée par convention et vérifiée par lint. NestJS reste défendable pour une grande équipe |
| Base de données | **PostgreSQL 16** | — | Contraintes d'exclusion (anti double réservation), RLS (isolation multi-cabinet), `tstzrange`, transactions robustes |
| Accès BD / migrations | **Drizzle ORM** + migrations SQL versionnées | Prisma | Prisma ne modélise ni les contraintes d'exclusion ni les politiques RLS ; Drizzle reste proche du SQL et accepte des migrations SQL personnalisées relues comme du code |
| File de jobs / outbox | **pg-boss** (dans PostgreSQL) | BullMQ (Redis) | Mise en file **dans la même transaction** que l'écriture métier (vraie outbox), zéro infrastructure supplémentaire, volumétrie très inférieure aux limites |
| Authentification | **Sessions serveur** (cookie `httpOnly`, `Secure`, `SameSite`) + Argon2id + TOTP | JWT | Révocation immédiate, aucun jeton lisible par JavaScript, adapté à une application web first-party |
| Frontend | **React + Vite** (SPA), TanStack Query, React Router | Next.js | Application authentifiée sans besoin de SEO/SSR ; une SPA statique consommant l'API évite de glisser de la logique métier côté serveur frontend |
| UI | **Tailwind CSS + shadcn/ui** (primitives Radix accessibles) | Material UI | Accessibilité clavier/lecteur d'écran intégrée, composants copiés dans le dépôt (pas de verrouillage) |
| Agenda UI | **FullCalendar** (paquets MIT : timegrid, daygrid, interaction) | Composant maison | Vues jour/semaine, glisser-déposer, fuseaux horaires ; les vues « ressources » payantes ne sont pas nécessaires au MVP |
| Graphiques | **Recharts** | Chart.js | Intégration React native |
| Dates / fuseaux | **Luxon** | date-fns-tz | Gestion explicite des fuseaux IANA et des changements d'heure |
| Téléphones | **libphonenumber-js** | regex | Normalisation E.164 fiable |
| LLM | **API Claude** via `@anthropic-ai/sdk`, boucle d'outils écrite à la main | Tool Runner (bêta), Managed Agents | Contrôle total de chaque itération (garde-fous, audit, limites) sans dépendance bêta ; Managed Agents fournit des conteneurs par session, inutiles ici |
| Modèle | **`claude-opus-5`** par défaut, configurable par variable d'environnement | `claude-sonnet-5`, `claude-haiku-4-5` | Modèle recommandé par défaut ; un modèle moins cher ne sera retenu **que si** la suite d'évaluation de l'agent (Phase 7) montre une qualité équivalente — décision vous revenant (coûts en N) |
| WhatsApp | **WhatsApp Cloud API** (Meta, en direct) derrière une interface `WhatsAppPort` | BSP (Twilio, 360dialog) | Pas de marge intermédiaire par message, API officielle ; l'interface permet de basculer vers un BSP si l'onboarding Meta pose problème |
| Calendrier | **Google Calendar API v3** + compte de service | OAuth utilisateur | Pour un seul cabinet : pas d'écran de consentement ni de vérification OAuth Google ; OAuth deviendra nécessaire en mode SaaS multi-cabinets |
| Logs | **pino** (JSON structuré, masquage des champs sensibles) | winston | Intégré à Fastify, performant |
| Tests | **Vitest**, `fastify.inject`, **Playwright** | Jest | Rapide, compatible ESM/TypeScript natif |
| Qualité | ESLint (+ règles de frontières entre modules), Prettier, `tsc --strict`, **gitleaks** | — | Détection de secrets avant commit et en CI |
| CI | GitHub Actions (PostgreSQL en service container) | — | Dépôt déjà sur GitHub |
| Déploiement | Conteneurs Docker, reverse proxy **Caddy** (TLS automatique) | Kubernetes | Surdimensionné pour un cabinet ; hébergeur à définir selon le pays (voir O) |

Les versions exactes de chaque dépendance seront vérifiées et figées (lockfile) au moment de leur installation, pas avant.

---

## C. Structure des dossiers

Choix : **monorepo pnpm à 3 paquets**. Un découpage en 8 paquets (`agent/`, `database/`, `integrations/`…) multiplierait la configuration de build sans bénéfice à ce stade ; les frontières sont assurées par dossiers + règle ESLint.

```
SaaS-dentists/
├── apps/
│   ├── server/                      # backend : un code, deux points d'entrée
│   │   ├── src/
│   │   │   ├── main-api.ts          # processus HTTP
│   │   │   ├── main-worker.ts       # processus jobs
│   │   │   ├── config/              # lecture/validation des variables d'env (Zod), logger
│   │   │   ├── db/
│   │   │   │   ├── schema/          # schéma Drizzle par domaine
│   │   │   │   ├── migrations/      # SQL versionné (jamais modifié après application)
│   │   │   │   ├── tenant.ts        # withTenant(clinicId, tx => …) : SET LOCAL + RLS
│   │   │   │   └── seed/
│   │   │   ├── modules/             # domaine métier
│   │   │   │   ├── identity/        # users, sessions, rôles, permissions
│   │   │   │   ├── clinics/         # paramètres, infos publiées (FAQ, tarifs)
│   │   │   │   ├── patients/
│   │   │   │   ├── scheduling/      # horaires, blocages, calcul de disponibilités (pur)
│   │   │   │   ├── appointments/    # holds, confirmation, déplacement, annulation
│   │   │   │   ├── conversations/   # conversations, messages, handoff
│   │   │   │   ├── finance/         # actes facturables, paiements, synthèses
│   │   │   │   ├── notifications/   # rappels, alertes internes
│   │   │   │   └── audit/
│   │   │   │       (chaque module : *.service.ts, *.repository.ts, *.schemas.ts, *.policy.ts, __tests__/)
│   │   │   ├── api/                 # adaptateur HTTP : routes, plugins (auth, rbac, tenant,
│   │   │   │                        #   rate-limit, erreurs), webhooks
│   │   │   ├── worker/              # adaptateur jobs : handlers pg-boss, planification
│   │   │   ├── agent/
│   │   │   │   ├── router.ts        # classification d'intention (sortie structurée)
│   │   │   │   ├── loop.ts          # boucle outil → résultat → décision
│   │   │   │   ├── tools/           # un fichier par outil (adaptateur vers les services)
│   │   │   │   ├── prompts/         # prompts versionnés
│   │   │   │   ├── guardrails.ts    # limites, détection d'échec, handoff forcé
│   │   │   │   └── tracing.ts       # agent_runs / agent_tool_calls
│   │   │   └── integrations/
│   │   │       ├── whatsapp/        # port + client Cloud API + vérif. signature + fake
│   │   │       ├── google-calendar/ # port + client + synchro + fake
│   │   │       └── llm/             # port + client Anthropic + fake scriptable
│   │   └── test/                    # helpers : base de test, fabriques, fakes
│   └── web/                         # SPA React
│       └── src/
│           ├── app/                 # routage, layout, garde d'authentification
│           ├── features/            # agenda, patients, inbox, finance, settings, dashboard
│           ├── components/ui/       # shadcn/ui
│           └── lib/                 # client API typé, formatage
├── packages/
│   └── shared/                      # contrats Zod (DTO), catalogue des permissions,
│                                    # codes d'erreur, énumérations partagées
├── tests/e2e/                       # Playwright (parcours dentiste / secrétaire)
├── evals/agent/                     # scénarios d'évaluation de l'agent avec le vrai modèle
├── docs/                            # ARCHITECTURE.md, adr/, runbooks/, compliance/
├── scripts/                         # base de dev, seed, sauvegarde/restauration
├── infra/                           # docker-compose.yml, Dockerfiles, Caddyfile
├── .github/workflows/               # CI
├── .env.example                     # variables sans valeurs réelles
└── .gitignore
```

Correspondance avec la structure conceptuelle demandée : `backend/` → `apps/server`, `frontend/` → `apps/web`, `agent/` → `apps/server/src/agent`, `database/` → `apps/server/src/db`, `integrations/` → `apps/server/src/integrations`, `tests/` → tests unitaires/intégration colocalisés + `tests/e2e` + `evals/`.

---

## D. Schéma de base de données

### D.1 Conventions
- Identifiants **UUID v7** (ordonnés dans le temps, bons pour les index), générés par l'application.
- Toutes les tables métier : `clinic_id NOT NULL`, `created_at`, `updated_at` (timestamptz).
- **Clés étrangères composites** `(clinic_id, x_id) → x(clinic_id, id)` : un rendez-vous ne peut physiquement pas référencer un patient d'un autre cabinet.
- **RLS** activée sur toutes les tables métier : politique `clinic_id = current_setting('app.clinic_id')::uuid`. Le rôle applicatif n'est ni propriétaire des tables ni `BYPASSRLS` ; les migrations utilisent un rôle distinct. Les jobs système qui concernent tous les cabinets (expiration des holds, rappels, réconciliation) itèrent sur les cabinets et traitent chacun dans son propre contexte `withTenant` ; aucun job ne contourne la RLS. Seules deux résolutions précèdent le contexte cabinet : `phone_number_id` → cabinet (webhook WhatsApp) et canal Google → cabinet. Elles passent par des fonctions SQL dédiées qui ne renvoient qu'un `clinic_id`.
- Horodatages en **UTC** (`timestamptz`) ; le fuseau IANA du cabinet sert au calcul des disponibilités et à l'affichage.
- Montants en **entiers (centimes)** + code devise ISO 4217. Jamais de flottants.
- Suppression logique (`archived_at`) pour patients et utilisateurs ; les suppressions physiques sont réservées aux demandes d'effacement légales (procédure documentée).
- Verrouillage optimiste (`version`) sur les rendez-vous et les patients pour les éditions concurrentes depuis l'interface.

### D.2 Tables

**Tenancy et identité**
| Table | Colonnes clés | Notes |
|---|---|---|
| `clinics` | id, name, timezone, locale, currency, country_code, settings (jsonb validé par Zod) | Paramètres : délai minimal d'annulation, horizon de réservation, durée de hold, texte d'urgence, etc. |
| `users` | id, email (unique global), password_hash (Argon2id), full_name, status, mfa_secret_enc, last_login_at | Utilisateur global : un même compte pourra appartenir à plusieurs cabinets |
| `clinic_memberships` | id, clinic_id, user_id, role_id, status | unique(clinic_id, user_id) |
| `permissions` | key (PK), description | Alimentée depuis le catalogue défini dans le code ; aucune permission hors catalogue possible |
| `roles` | id, clinic_id (NULL = rôle système), key, name | ADMIN, DENTIST, SECRETARY semés par migration |
| `role_permissions` | role_id, permission_key | |
| `sessions` | id (= SHA-256 du jeton), user_id, clinic_id, expires_at, last_seen_at, ip, user_agent | Le jeton brut n'est jamais stocké |
| `practitioners` | id, clinic_id, user_id (nullable), display_name, color, active | Ressource réservable, distincte du compte utilisateur |

**Planning**
| Table | Colonnes clés | Notes |
|---|---|---|
| `appointment_types` | id, clinic_id, name, patient_label, duration_min, buffer_min, agent_bookable, active | L'agent ne réserve que les types `agent_bookable` |
| `working_hours` | id, clinic_id, practitioner_id, weekday, start_time, end_time, valid_from, valid_to | Horaires hebdomadaires récurrents |
| `availability_blocks` | id, clinic_id, practitioner_id, start_at, end_at, reason (interne), source (APP / GOOGLE_IMPORT), external_event_id, created_by | Congés, absences, blocages |
| `appointments` | id, clinic_id, practitioner_id, patient_id, appointment_type_id, start_at, end_at, status, hold_expires_at, source (AGENT / STAFF), conversation_id, created_by_user_id, cancelled_at, cancelled_by, cancel_reason, rescheduled_from_id, admin_note, version | Statuts : HELD, CONFIRMED, COMPLETED, NO_SHOW, CANCELLED, EXPIRED |

Contrainte anti double réservation :
```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    practitioner_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (status IN ('HELD','CONFIRMED','COMPLETED','NO_SHOW'));
```
**Vérifié le 2026-09-26 sur PostgreSQL 16.13** (cluster jetable) : créneau adjacent, rendez-vous annulé chevauchant et autre praticien → acceptés ; chevauchement → rejeté (`violates exclusion constraint`) ; deux sessions concurrentes sur le même créneau → la seconde échoue, une seule ligne en base. Cette vérification sera reprise comme test automatisé en Phase 4.

Une contrainte ne peut pas dépendre de `now()` : les holds expirés sont donc passés à `EXPIRED` (a) par un job chaque minute et (b) dans la transaction de réservation elle-même, avant l'insertion, pour la plage concernée.

Les blocages (`availability_blocks`) ne font pas partie de la contrainte : le personnel doit pouvoir placer volontairement un rendez-vous sur une plage bloquée. La cohérence est garantie par un **verrou consultatif transactionnel par praticien** (`pg_advisory_xact_lock`) pris à la fois par la création de rendez-vous, de hold et de blocage. Un hold de l'agent et un blocage posé simultanément par la secrétaire sont donc sérialisés : le second voit le premier et réagit (l'agent revalide les blocages, la création du blocage liste le conflit).

**Synchronisation calendrier**
| Table | Colonnes clés |
|---|---|
| `calendar_connections` | id, clinic_id, provider, mirror_calendar_id, import_calendar_ids, sync_token, watch_channel_id, watch_resource_id, watch_expires_at, last_synced_at, status, last_error |
| `calendar_event_links` | id, clinic_id, appointment_id, external_event_id, etag, synced_version, sync_status (PENDING/SYNCED/FAILED), attempts, last_error |

**Patients** (séparation administratif / médical / financier)
| Table | Colonnes clés | Accès |
|---|---|---|
| `patients` | id, clinic_id, first_name, last_name, birth_date (nullable), email (nullable), status, created_source, archived_at, version | Administratif |
| `patient_contacts` | id, clinic_id, patient_id, phone_e164, relationship (SELF/GUARDIAN/OTHER), is_primary, whatsapp_opt_in_at | Un numéro peut être lié à plusieurs patients (parent qui gère ses enfants) |
| `patient_medical_notes` | id, clinic_id, patient_id, author_user_id, content_enc, created_at | **Médical** — permission dédiée, contenu chiffré au niveau applicatif. Portée MVP à confirmer (question O3) |
| `patient_documents` | (hors MVP) | |

**Finances**
| Table | Colonnes clés | Notes |
|---|---|---|
| `charges` | id, clinic_id, patient_id, appointment_id, label, amount_cents, currency, status (OPEN/VOIDED), created_by | Montant dû. Sans cette table, les impayés ne sont pas calculables |
| `payments` | id, clinic_id, patient_id, appointment_id (nullable), amount_cents, currency, method (CASH/CARD/CHECK/TRANSFER/OTHER), paid_at, status (RECORDED/VOIDED), void_reason, recorded_by, reference | **Immuable** : une erreur se corrige par annulation (void) + nouvel enregistrement, jamais par modification du montant |
| `expenses` | (option désactivée par défaut) | |

**Conversations et messages**
| Table | Colonnes clés | Notes |
|---|---|---|
| `conversations` | id, clinic_id, channel, contact_phone_e164, active_patient_id, mode (BOT/HUMAN/CLOSED), assigned_user_id, last_inbound_at, agent_state (jsonb), version | `last_inbound_at` détermine la fenêtre de 24 h WhatsApp |
| `messages` | id, clinic_id, conversation_id, direction (IN/OUT), author_type (PATIENT/AGENT/STAFF/SYSTEM), author_user_id, provider_message_id (unique), kind (TEXT/INTERACTIVE/TEMPLATE/MEDIA), body, payload, status (RECEIVED/QUEUED/SENT/DELIVERED/READ/FAILED), error_code | Les statuts ne peuvent qu'avancer (webhooks désordonnés) |
| `handoffs` | id, clinic_id, conversation_id, reason, urgency (NORMAL/HIGH), summary, status (OPEN/IN_PROGRESS/RESOLVED), taken_by, resolved_at | |
| `messaging_channels` | id, clinic_id, provider (WHATSAPP_CLOUD), phone_number_id (unique global), waba_id, display_phone, status | Routage des webhooks : Meta envoie le `phone_number_id` destinataire ; il désigne le cabinet **avant** tout traitement. Numéro inconnu → événement rejeté et journalisé |
| `whatsapp_templates` | id, clinic_id, name, language, category, provider_status | |
| `webhook_events` | id, provider, external_id (unique), received_at, signature_valid, payload (rétention courte), processed_at, error | Idempotence : Meta peut livrer deux fois le même webhook |

**Agent (traçabilité)**
| Table | Colonnes clés |
|---|---|
| `agent_runs` | id, clinic_id, conversation_id, trigger_message_ids, model, prompt_version, intent, outcome (REPLIED/HANDOFF/ERROR/LIMIT), input_tokens, output_tokens, cache_read_tokens, started_at, finished_at, error_code |
| `agent_tool_calls` | id, clinic_id, agent_run_id, seq, tool_name, input (masqué), output (masqué), status (OK/ERROR/DENIED), error_code, duration_ms |

Le raisonnement interne du modèle n'est **ni stocké ni montré au patient** ; on conserve les décisions observables (outils appelés, entrées, résultats, réponse envoyée).

**Transverse**
| Table | Colonnes clés | Notes |
|---|---|---|
| `clinic_knowledge` | id, clinic_id, topic, content, published, updated_by | Seule source des réponses informatives de l'agent (adresse, services, tarifs publiés, politique d'annulation) |
| `notifications` | id, clinic_id, type, channel, target_patient_id / target_user_id, appointment_id, scheduled_for, status, attempts, message_id, last_error | Rappels patients et alertes internes |
| `audit_logs` | id, clinic_id, actor_type (USER/AGENT/SYSTEM), actor_id, action, entity_type, entity_id, changes (noms de champs + valeurs non sensibles), request_id, ip, created_at | **Ajout seul** : `UPDATE`/`DELETE` révoqués pour le rôle applicatif |

---

## E. Architecture de l'agent IA

### E.1 Principe
Le LLM décide **quoi faire** ; le code garantit **ce qui est permis**. L'agent est une boucle bornée qui observe les résultats réels des outils. Il ne dispose que d'outils limités au patient de la conversation.

### E.2 Pipeline par tour patient

```
Message(s) entrant(s)
  │  regroupement 4 s (le patient envoie souvent 2-3 messages d'affilée)
  │  sérialisation : un seul traitement à la fois par conversation
  ▼
[0] Conversation en mode HUMAN ? ── oui ──► notifier la secrétaire, l'agent ne répond pas
  │ non
  ▼
[1] Événement déterministe ? (clic bouton « Confirmer »/« Annuler » avec référence de hold)
  │     └─ oui ──► confirmation par le code, sans LLM ──► message de confirmation généré depuis la base
  ▼
[2] Routeur (appel LLM, sortie structurée JSON validée) :
      { intent, urgency, language, needs_human, confidence }
      intent ∈ GREETING, INFO_REQUEST, HOURS, SERVICES, PRICES, BOOK, RESCHEDULE,
               CANCEL, CONFIRM, EXISTING_APPOINTMENT, MEDICAL_QUESTION, URGENT,
               COMPLAINT, PAYMENT, HUMAN_REQUESTED, OFF_TOPIC, UNCLEAR
  │
  ├─ URGENT ─────────► message d'urgence **défini par le cabinet** (texte fixe) + handoff priorité HAUTE + alerte
  ├─ MEDICAL / COMPLAINT / PAYMENT / HUMAN_REQUESTED ─► message de transfert + handoff
  ├─ OFF_TOPIC ──────► refus poli (l'agent est limité au cabinet — exigence de la politique Meta)
  ▼
[3] Boucle agent (Claude + outils), max 6 itérations :
      décision → appel d'outil → validation Zod → contrôle de permission → exécution
      → résultat structuré → observation → décision suivante … → réponse finale
  │
  ▼
[4] Garde-fous de sortie : longueur, absence d'identifiants internes, échecs répétés
  │   (2 incompréhensions consécutives, erreur d'outil répétée, limite d'itérations,
  │    stop_reason « refusal ») ──► handoff
  ▼
[5] Réponse enregistrée + envoi mis en file (outbox) dans la même transaction
```

Pourquoi un routeur séparé plutôt qu'une seule boucle : l'urgence et les demandes médicales doivent être détectées de façon **fiable et testable** avant toute action. Un appel court à sortie structurée donne une intention explicite, mesurable dans les tests et les métriques. Coût : un appel bref supplémentaire par tour (~1 à 2 s de latence, coût marginal).

### E.3 État et mémoire
- **Aucune disponibilité n'est gardée en mémoire du modèle** : chaque proposition provient d'un appel à `find_available_slots` sur la base.
- `conversations.agent_state` (jsonb, validé par Zod) contient uniquement : patient actif, créneaux proposés (références courtes `S1…S5` → données réelles côté serveur), hold en cours, rendez-vous listés (`A1…`), compteur d'incompréhensions.
- Contexte envoyé au modèle : prompt système versionné (règles, limites médicales, ton) + infos du cabinet + date/heure courante dans le fuseau du cabinet + état + 20 derniers messages. Partie stable en tête pour le cache de prompt.

### E.4 Garantie de confirmation (invariant I2)
1. `hold_slot(S2)` crée un rendez-vous `HELD` (10 min, configurable) — possible uniquement pour une référence renvoyée précédemment par `find_available_slots`.
2. Le système envoie un récapitulatif **généré par le code** avec boutons interactifs [Confirmer] [Autre créneau].
3. `confirm_hold` n'aboutit que si un **événement patient postérieur au hold** existe (clic bouton ou nouveau message). Le LLM ne peut donc pas réserver dans le même tour que la proposition.
4. Hold expiré et créneau pris entre-temps → le patient est informé et de nouveaux créneaux sont proposés.

### E.5 Limites médicales
- Aucun outil médical n'existe ; le prompt interdit diagnostic, prescription, réassurance médicale.
- Le motif est recueilli au niveau « général » uniquement (« contrôle », « douleur », « détartrage »).
- Le texte d'urgence (numéro à appeler, consignes) est **paramétré par le cabinet**, jamais rédigé par le LLM.

### E.6 Résilience
- API Claude indisponible ou lente (timeout 30 s, 2 tentatives) → message fixe « notre assistant est momentanément indisponible, l'équipe vous répondra » + handoff. Jamais de réponse inventée.
- Plafonds de coût : nombre maximal d'appels LLM par conversation et par jour ; dépassement → handoff.
- `stop_reason: "refusal"` traité explicitement : le fallback serveur de l'API Claude est activé (`fallbacks: "default"`, bêta `server-side-fallback-2026-07-01`) ; si la réponse reste un refus → handoff. `stop_reason: "max_tokens"` → la réponse n'est pas envoyée, handoff.
- Le routeur utilise les **sorties structurées** (`output_config.format`) et non un `tool_choice` forcé : le forçage d'outil est refusé (erreur 400) par Claude Opus 5.5 et Fable 5.1. Ce choix évite de bloquer un changement de modèle ultérieur.

---

## F. Outils de l'agent

Règles communes à tous les outils :
- Entrées validées par schéma Zod (et `strict: true` côté API Claude) ; tout argument invalide → erreur structurée renvoyée au modèle.
- `clinic_id`, `conversation_id` et numéro de téléphone **injectés par le serveur**, jamais fournis par le LLM.
- Principal `AGENT` avec permissions propres, limitées aux patients liés au numéro de la conversation.
- Sortie : `{ ok: true, data }` ou `{ ok: false, error: { code, message_for_agent } }`. Données minimales (prénom + initiale, jamais d'autres patients).
- Chaque appel est tracé dans `agent_tool_calls` (entrées/sorties masquées).

| Outil | Rôle | Garde-fous |
|---|---|---|
| `get_clinic_info(topic)` | Adresse, horaires, services, tarifs **publiés**, politique d'annulation | Lit uniquement `clinic_knowledge` publié ; « information indisponible » si absent |
| `list_my_patient_profiles()` | Patients liés au numéro (prénom + initiale) | Aucun accès par recherche libre |
| `register_patient(first_name, last_name, birth_date?)` | Crée un patient lié au numéro | Date de naissance seulement si le paramètre cabinet l'exige ; dédoublonnage |
| `select_patient(profile_ref)` | Fixe le patient concerné (cas famille) | Référence issue de la liste ci-dessus uniquement |
| `list_appointment_types()` | Types réservables par l'agent + durées | Filtre `agent_bookable` |
| `find_available_slots(type_ref, date_from, date_to, time_of_day?, practitioner_ref?)` | Calcule les créneaux libres | Horizon max configurable ; renvoie ≤ 5 créneaux `S1…S5` ; échoue proprement si la source d'indisponibilités n'est pas fraîche (section H) |
| `hold_slot(slot_ref)` | Bloque temporairement un créneau proposé | Référence connue obligatoire ; revalide en transaction ; un seul hold actif par conversation |
| `confirm_hold(hold_ref)` | Confirme le rendez-vous | Événement patient postérieur au hold requis ; hold non expiré |
| `list_my_appointments()` | Rendez-vous à venir du patient actif | Références `A1…` |
| `reschedule_appointment(appointment_ref, slot_ref)` | Déplacement en deux temps (hold puis confirmation) | Délai minimal du cabinet ; ancien RDV annulé dans la même transaction que la confirmation du nouveau |
| `cancel_appointment(appointment_ref, reason?)` | Annulation après confirmation explicite | Délai minimal ; en deçà → handoff |
| `handoff_to_human(reason, summary, urgency)` | Transfert à la secrétaire | Passe la conversation en mode HUMAN, crée le handoff, alerte l'équipe |

Écarts assumés par rapport à la liste initiale :
- **Pas d'outil `send_whatsapp_message`** : la réponse de l'agent est le résultat de la boucle, envoyée une seule fois par l'orchestrateur via l'outbox. Un outil d'envoi permettrait des envois multiples ou non tracés. Les rappels et confirmations sont des jobs système.
- `get_business_hours` est fusionné dans `get_clinic_info`.
- `update_patient` n'est pas exposé à l'agent au MVP : une modification d'identité passe par la secrétaire (risque d'usurpation via un téléphone partagé).
- `get_patient` / `get_appointment` sont remplacés par des versions limitées au périmètre de la conversation (`list_my_*`).

---

## G. Flux WhatsApp → Agent → Agenda → Patient

### G.1 Réception
1. Meta appelle `POST /webhooks/whatsapp`.
2. Vérification de la signature `X-Hub-Signature-256` (HMAC-SHA256 du corps brut avec l'App Secret). Signature invalide → 401, rien n'est traité.
3. Résolution du cabinet par `phone_number_id` (`messaging_channels`), puis déduplication par identifiant de message Meta (`webhook_events.external_id` unique). Un même webhook peut contenir plusieurs messages ou statuts : chacun est dédupliqué individuellement.
4. Enregistrement du message, mise à jour de `last_inbound_at`, mise en file du job `conversation.process` (clé de singleton = conversation, délai 4 s).
5. Réponse `200` immédiate.
6. Webhooks de statut (sent/delivered/read/failed) → mise à jour monotone de `messages.status`.

### G.2 Prise de rendez-vous (cas nominal)
```
Patient : « Bonjour, je voudrais un rendez-vous pour un détartrage la semaine prochaine, le matin »
  → routeur : intent=BOOK
  → list_my_patient_profiles()                 → aucun profil
  → agent : demande nom et prénom
Patient : « Karim Benali »
  → register_patient("Karim", "Benali")        → profil P1
  → list_appointment_types()                   → détartrage = 30 min
  → find_available_slots(détartrage, lun..ven, matin) → S1 mar 9h00, S2 mar 10h30, S3 jeu 9h30
  → agent : propose les 3 créneaux (liste interactive)
Patient : choisit S2
  → hold_slot(S2)                              → HELD jusqu'à +10 min
  → système : récapitulatif généré par le code + boutons [Confirmer] [Autre créneau]
Patient : clique [Confirmer]
  → confirm_hold (déterministe, sans LLM)      → CONFIRMED (transaction)
       même transaction : audit_log + outbox { message de confirmation,
                                               synchro Google Calendar,
                                               rappel J-1 si opt-in }
  → patient reçoit la confirmation (texte construit depuis la base)
  → le rendez-vous apparaît dans l'application (source de vérité) puis dans Google Calendar (miroir)
```

### G.3 Cas d'erreur
| Situation | Comportement |
|---|---|
| Créneau pris entre proposition et hold | `hold_slot` échoue (contrainte d'exclusion) → l'agent en informe le patient et rappelle `find_available_slots` |
| Hold expiré avant confirmation | Confirmation refusée → nouveaux créneaux proposés |
| Aucun créneau dans la période | L'agent le dit et propose d'élargir la période ; jamais de créneau inventé |
| Base indisponible | Erreur contrôlée ; message fixe + retry du job ; aucune affirmation de réservation |
| Envoi WhatsApp échoué | Job rejoué (backoff) ; après N échecs → statut FAILED + alerte dans le tableau de bord |
| Patient hors fenêtre de 24 h | Seuls les templates approuvés peuvent être envoyés ; l'interface l'impose |

### G.4 Rappels
Job planifié à J-1 (configurable), uniquement si `whatsapp_opt_in_at` est renseigné. Message **template de catégorie utility** (hors fenêtre de 24 h) avec boutons [Je confirme] [Annuler / déplacer]. Le template contient la date, l'heure et le nom du cabinet, **jamais le type de soin** (minimisation, risque M13).

---

## H. Flux Dentiste/Secrétaire → Agenda → Agent, et synchronisation Google Calendar

### H.1 Actions du personnel
1. Action dans l'interface (créer, déplacer, annuler, bloquer) → API REST.
2. Session vérifiée → contexte cabinet (RLS) → permission vérifiée dans le service.
3. Transaction : verrou par praticien + contrainte d'exclusion + `version` (verrou optimiste : si quelqu'un a modifié le rendez-vous entre-temps, l'écran est rafraîchi au lieu d'écraser).
4. Même transaction : `audit_logs` + outbox (miroir Google, notification WhatsApp au patient si opt-in et fenêtre/template appropriés).
5. L'agent lit toujours l'état courant en base : un créneau libéré par la secrétaire est immédiatement proposable ; un créneau bloqué ne l'est plus.

Blocage d'un créneau déjà occupé : l'interface liste les rendez-vous en conflit et demande une décision explicite (déplacer/annuler avec notification). Aucune annulation silencieuse.

### H.2 Reprise des conversations (handoff)
- Boîte de réception « Conversations à traiter » (mode HUMAN, triées par urgence puis ancienneté).
- La secrétaire répond depuis l'application ; le message part du numéro du cabinet avec `author_type = STAFF`.
- Au-delà de 24 h sans message du patient, seul l'envoi de template est proposé.
- Bouton « Rendre la main à l'assistant ». L'agent ne prétend jamais qu'un humain a répondu.
- Hors horaires d'ouverture : le patient est informé que l'équipe répondra à la réouverture.

### H.3 Stratégie de synchronisation Google Calendar

| Question | Réponse |
|---|---|
| Source de vérité | **PostgreSQL**, pour les rendez-vous comme pour les blocages créés dans l'application |
| Rôle de Google Calendar | (1) **Miroir** en lecture des rendez-vous, visible par dentiste et secrétaire ; (2) **optionnel** : calendrier « Indisponibilités » du dentiste importé comme blocages |
| Calendrier miroir | **Possédé par un compte Google du cabinet** (compte dédié, par ex. `agenda.cabinet@…`), partagé avec le compte de service en « Modifier les événements » et avec le personnel en **lecture seule**. *Correction de la révision 1* : Google déconseille un compte de service comme propriétaire d'un calendrier secondaire (comportements imprévus, suppression impossible par un tiers). Un calendrier partagé n'apparaît pas automatiquement dans la liste du compte de service : il faut l'ajouter par `calendarList.insert` (Phase 5). Le propriétaire garde techniquement un droit d'écriture ; ses modifications manuelles sont traitées comme des divergences (ligne « Conflits ») |
| Idempotence | L'identifiant d'événement Google est dérivé de l'UUID du rendez-vous (Google accepte des identifiants fournis par le client en base32hex ; les caractères hexadécimaux sont inclus) → recréer deux fois ne duplique pas |
| Contenu des événements | Minimal par défaut (ex. « RDV – Karim B. – Détartrage »), jamais de motif médical ; niveau de détail à décider (question O6) |
| Conflits | La base gagne toujours. Si un événement miroir diverge (modification par un tiers disposant de droits d'écriture), il est réécrit depuis la base et un avertissement est journalisé |
| Suppression externe d'un événement miroir | Recréé depuis la base + alerte. **Jamais** d'annulation de rendez-vous déduite d'une suppression dans Google |
| Événements créés manuellement par la secrétaire dans Google | Non pris en charge comme rendez-vous (aucun lien patient). Règle : les rendez-vous se créent dans l'application. Un événement ajouté au calendrier « Indisponibilités » est importé comme **blocage** |
| Erreurs de synchronisation | Jobs rejoués avec backoff ; après N échecs → `sync_status = FAILED` + bandeau « synchronisation Google en retard » ; job de réconciliation nocturne (60 jours glissants) |
| Import des indisponibilités | Synchronisation incrémentale (`syncToken`) déclenchée par notifications push + sondage de secours toutes les 5 min. Les canaux push expirent et ne se renouvellent pas automatiquement → job de renouvellement. `syncToken` invalide (HTTP 410) → resynchronisation complète |
| Google indisponible | Les réservations continuent (la base fait foi) ; le miroir rattrape son retard ensuite. **Si l'import d'indisponibilités est activé et que la dernière synchronisation réussie date de plus de 15 min**, l'agent ne confirme pas de nouveau rendez-vous : il informe le patient qu'un membre de l'équipe confirmera (handoff). Aucune disponibilité inventée |

---

## I. Rôles et permissions (RBAC)

### I.1 Modèle
- Catalogue de permissions **défini dans le code** (`packages/shared`), recopié en base par migration. Une permission absente du catalogue ne peut pas exister.
- Rôles système semés : ADMIN, DENTIST, SECRETARY. Rôles personnalisés par cabinet possibles plus tard (tables déjà prévues).
- Vérification dans la **couche service** (`assertCan(actor, permission, resource)`), donc appliquée identiquement à l'API, aux outils de l'agent et aux jobs. L'interface masque aussi les actions non permises, par ergonomie uniquement.
- Contrôle de périmètre en plus du rôle : cabinet (RLS), propriétaire (un dentiste gère ses propres horaires), conversation (agent).

### I.2 Catalogue et matrice proposée (à valider)

| Permission | ADMIN | DENTIST | SECRETARY | AGENT |
|---|:-:|:-:|:-:|:-:|
| `appointment.read` | ✓ | ✓ | ✓ | propres patients |
| `appointment.write` (créer, déplacer, annuler) | ✓ | ✓ | ✓ | propres patients, selon règles |
| `schedule.manage` (horaires, blocages) | ✓ | ✓ (les siens) | ✓ (pour le compte d'un praticien) ⚠︎ à confirmer | — |
| `patient.read` (administratif) | ✓ | ✓ | ✓ | propres profils, minimal |
| `patient.write` | ✓ | ✓ | ✓ | création uniquement |
| `patient.medical.read` / `.write` | ✓ | ✓ | — | — |
| `payment.read` | ✓ | ✓ | ✓ | — |
| `payment.write` (enregistrer) | ✓ | ✓ | ✓ | — |
| `payment.void` | ✓ | ✓ | — ⚠︎ à confirmer | — |
| `finance.reports.read` (CA, statistiques) | ✓ | ✓ | — ⚠︎ à confirmer | — |
| `conversation.read` / `.reply` | ✓ | ✓ | ✓ | — |
| `clinic.settings.manage` | ✓ | — | — | — |
| `user.manage` (comptes, rôles) | ✓ | — | — | — |
| `audit.read` | ✓ | — | — | — |

Le rôle PATIENT (portail patient) est prévu dans le modèle (principal distinct) mais hors MVP.

---

## J. Architecture de sécurité

| Domaine | Mesure |
|---|---|
| Transport | TLS partout (Caddy, certificats automatiques), HSTS, redirection HTTP→HTTPS |
| Authentification | Argon2id ; sessions opaques (jeton aléatoire 256 bits, seul son hash est stocké) ; expiration glissante + absolue ; rotation à la connexion ; **TOTP obligatoire pour ADMIN et DENTIST** (recommandé pour tous) |
| Anti-force brute | Rate limiting par IP et par compte sur `/auth/login`, délai progressif, journalisation des échecs |
| CSRF | Cookies `SameSite=Lax` + jeton CSRF sur les requêtes modifiantes ; CORS limité à l'origine de l'application |
| En-têtes | `@fastify/helmet` (CSP stricte, `frame-ancestors 'none'`, etc.) |
| Autorisation | RBAC côté service + RLS PostgreSQL + FK composites (défense en profondeur) |
| Validation | Zod sur chaque entrée (HTTP, webhooks, arguments d'outils, JSON stocké) |
| Injections | Requêtes paramétrées exclusivement (Drizzle) ; aucune concaténation SQL ; échappement automatique React |
| Injection de prompt | Le texte du patient ne peut élargir aucun droit : outils limités à la conversation, contexte injecté par le serveur, aucun outil d'administration exposé à l'agent |
| Webhooks | Signature Meta (HMAC-SHA256) ; jeton de canal Google vérifié ; déduplication ; taille de corps limitée |
| Abus | Rate limiting des messages entrants par numéro ; plafond d'appels LLM par conversation/jour ; blocage manuel d'un numéro |
| Secrets | Variables d'environnement alimentées par le gestionnaire de secrets de l'hébergeur ; `.env.example` sans valeur ; `.gitignore` ; gitleaks en pre-commit et en CI |
| Données au repos | Chiffrement disque de l'hébergeur + chiffrement applicatif (AES-256-GCM) des champs très sensibles : secrets TOTP, notes médicales, identifiants d'intégration |
| Base de données | Rôles séparés : migration (DDL) / application (DML sans `BYPASSRLS`) ; `audit_logs` en ajout seul |
| Logs | Masquage pino des champs sensibles (téléphone partiel, pas de contenu de message, pas de jeton) ; identifiant de requête corrélé |
| Sauvegardes | Sauvegarde PostgreSQL avec restauration à un instant donné (PITR), chiffrée, hors site ; **test de restauration mensuel documenté** ; cible RPO ≤ 15 min, RTO ≤ 4 h (à valider) |
| Dépendances | Lockfile, `pnpm audit` en CI, mises à jour régulières |
| Audit | Connexions (succès/échec), modifications patient, création/annulation/déplacement de RDV, paiements et annulations de paiement, changements de rôle, paramètres, prise/rendu de conversation |

### J.2 Durées de conservation (proposition technique, **à valider juridiquement**)

Chaque durée est un paramètre du cabinet appliqué par un job de purge journalisé. Les valeurs ci-dessous sont des hypothèses de départ, pas des obligations vérifiées : elles dépendent du pays (question O1).

| Donnée | Proposition | Justification technique |
|---|---|---|
| Charge brute des webhooks (`webhook_events.payload`) | 7 jours | Utile seulement au diagnostic ; l'information utile est déjà extraite |
| Contenu des messages WhatsApp | 12 mois après le dernier échange | Reprise de contexte par la secrétaire ; au-delà, seules les métadonnées sont conservées |
| Entrées/sorties des outils de l'agent | 90 jours | Débogage et évaluation ; `agent_runs` agrégé conservé plus longtemps sans contenu |
| Journaux applicatifs | 30 jours | Exploitation |
| `audit_logs` | Durée à fixer avec le juriste (souvent plusieurs années) | Preuve des accès aux données |
| Paiements | Durée légale comptable du pays (10 ans en France pour les pièces comptables, à confirmer selon le pays) | Obligation comptable |
| Patients sans rendez-vous ni paiement depuis N années | Archivage puis effacement selon la règle retenue | Minimisation |

---

## K. Plan de développement par phases

Deux ajustements recommandés à l'ordre initial :
1. **Sécurité et tests ne sont pas des phases finales.** Chaque phase livre ses tests et respecte les règles de sécurité ; les phases 11 et 12 deviennent un audit indépendant et des tests de bout en bout / charge / évaluation agent.
2. **Une interface minimale est livrée avec chaque module** (connexion en phase 2, liste patients en phase 3, agenda en phase 4). Sinon, rien n'est utilisable avant la phase 8 et les erreurs de conception de l'API sont découvertes tard. Les phases 8 et 9 finalisent l'ergonomie.

| Phase | Contenu | Critère de fin (tests exécutés et verts) |
|---|---|---|
| 0 | Analyse et architecture (ce document) | Validation par vous |
| 1 | Fondations : monorepo, config Zod, logger, PostgreSQL local, Drizzle + premières migrations (`clinics`, `users`, `audit_logs`), `withTenant` + RLS, pg-boss, squelettes API/worker/web, CI, gitleaks, `.env.example`, `docker-compose` | Migration up/down sur base vierge ; test d'isolation RLS à 2 cabinets ; `/health` ; lint + typecheck + tests en CI |
| 2 | Authentification et RBAC : login/logout, sessions, Argon2id, TOTP, rate limiting, CSRF, rôles/permissions, gestion des utilisateurs, écran de connexion | Tests d'auth (succès, échec, verrouillage, expiration) ; matrice de permissions testée exhaustivement (chaque permission × chaque rôle) |
| 3 | Patients : CRUD, recherche, contacts (famille), séparation administratif/médical, audit | Tests API + permissions ; test d'accès refusé au médical pour SECRETARY |
| 4 | Rendez-vous : types, horaires, blocages, calcul de disponibilités, hold/confirm/move/cancel, contrainte d'exclusion, expiration des holds, agenda web jour/semaine | Tests de concurrence (réservations simultanées → une seule réussit) ; changements d'heure ; dentiste absent ; secrétaire qui modifie |
| 5 | Google Calendar : compte de service, miroir, import optionnel, réconciliation, renouvellement des canaux | Tests contre un fake + tests de contrat ; puis test réel sur un calendrier de test (identifiants fournis par vous) ; tests d'erreur Google |
| 6 | WhatsApp : webhook signé, déduplication, envoi via outbox, statuts, templates, fenêtre 24 h, rate limiting | Tests avec charges utiles Meta enregistrées ; test réel sur numéro de test Meta **depuis un environnement ayant accès à graph.facebook.com** |
| 7 | Agent IA : routeur, boucle, outils, garde-fous, handoff, traçabilité | Tests déterministes (LLM factice scripté) des 13 scénarios exigés + suite d'évaluation avec le vrai modèle (taux de réussite mesuré) |
| 8 | Interface dentiste : dashboard, agenda complet (glisser-déposer), fiche patient, historique | Tests E2E Playwright ; vérifications d'accessibilité (axe) ; responsive mobile/tablette |
| 9 | Interface secrétaire : boîte de réception, reprise de conversation, actions administratives | E2E : reprise d'un handoff, réponse, rendu de la main |
| 10 | Finances : actes, paiements, annulations, impayés, synthèses par période, graphiques | Tests de calcul (périodes, fuseau, annulations) ; accès refusé sans permission |
| 11 | Audit de sécurité : revue OWASP ASVS niveau 2, scan dépendances, revue RLS, test d'intrusion basique | Rapport + corrections |
| 12 | Tests complets : E2E de bout en bout, charge légère, tests de restauration, campagne d'évaluation agent | Rapport de couverture et de résultats |
| 13 | Déploiement : hébergement, secrets, sauvegardes, monitoring, runbooks, procédure de mise à jour | Déploiement staging puis production ; restauration testée |

**À lancer dès maintenant, en parallèle (délais externes) :** création du compte Meta Business et vérification de l'entreprise, numéro WhatsApp dédié, projet Google Cloud, clé API Anthropic, consultation juridique sur les données de santé.

---

## L. Dépendances externes

| Service | Usage | Authentification | Limites / points d'attention | Vérifié |
|---|---|---|---|---|
| **WhatsApp Cloud API** (Meta) | Messages patients | Jeton d'utilisateur système + App Secret (signature webhooks) | Vérification Meta Business ; numéro dédié ; templates soumis à approbation ; **fenêtre de service de 24 h** (hors fenêtre : templates uniquement) ; opt-in requis pour les messages initiés par le cabinet ; niveau de qualité du numéro ; **politique Meta 2026 : les chatbots IA généralistes sont interdits, les bots dédiés à un processus métier (prise de rendez-vous, support) restent autorisés** → l'agent doit refuser les sujets hors cabinet | Sources secondaires concordantes ; doc officielle Meta **[À VÉRIFIER]** (bloquée depuis l'environnement). Version de l'API Graph à figer en Phase 6 |
| **Google Calendar API v3** | Miroir + import d'indisponibilités | Compte de service (clé JSON en secret) | Projets créés après le 1er mai 2026 : 10 000 req/min/projet, 600 req/min/utilisateur, seuil de facturation à 1 000 000 req/jour (facturation détaillée annoncée pour fin 2026 avec 90 jours de préavis) ; canaux push à expiration sans renouvellement automatique ; endpoint HTTPS valide requis | Sources secondaires + extraits de la doc officielle ; exigences exactes du webhook push **[À VÉRIFIER]** en Phase 5 |
| **API Claude** (Anthropic) | Routeur + agent | Clé API (secret) | Rate limits selon le palier du compte ; traitement de données personnelles de santé par un sous-traitant → DPA et options de rétention/résidence à vérifier pour votre compte | Modèles et tarifs vérifiés (référence au 2026-06-24) |
| Hébergeur | API, worker, PostgreSQL managé, sauvegardes | — | **Si le cabinet est en France : hébergement certifié HDS obligatoire** pour des données de santé | Dépend du pays (O1) |
| **Politique WhatsApp Business (santé)** | — | — | La politique de messagerie interdit l'usage pour la télémédecine ou pour envoyer ou demander des informations de santé **si la réglementation applicable interdit** leur transmission à des systèmes ne répondant pas à des exigences renforcées. Elle interdit aussi de demander des numéros d'identité ou de carte bancaire complets. Même un rendez-vous chez un dentiste rattaché à une personne nommée peut constituer une donnée de santé au sens du RGPD. | Source officielle (business.whatsapp.com/policy) citée par plusieurs sources ; texte intégral **[À VÉRIFIER]** — accès bloqué depuis l'environnement |
| Paquets npm | Voir tableau ci-dessous | — | — | **Vérifié sur le registre npm le 2026-09-26** |

Versions actuelles et licences (vérifiées sur le registre npm ; seront figées dans le lockfile à l'installation) :

| Paquet | Version | Licence | Remarque |
|---|---|---|---|
| fastify | 5.12.5 | MIT | |
| zod | 4.6.5 | MIT | |
| drizzle-orm / drizzle-kit | 0.45.3 / 0.31.11 | Apache-2.0 / MIT | |
| pg-boss | 12.35.0 | MIT | Exige Node ≥ 22.12 (environnement : 22.22 ✓) ; le README documente la création de jobs dans une transaction existante, avec adaptateur Drizzle |
| pg | 8.23.0 | MIT | |
| @node-rs/argon2 | 2.2.1 | MIT | Binaire précompilé (préféré à `argon2`, qui compile du natif) |
| otplib | 13.5.0 | MIT | TOTP |
| @fastify/helmet, rate-limit, cookie | 13.1.1, 11.2.0, 11.1.2 | MIT | |
| react / vite / react-router | 19.3.0 / 8.3.1 / 8.4.0 | MIT | |
| @tanstack/react-query | 5.104.0 | MIT | |
| tailwindcss | 4.3.3 | MIT | |
| @fullcalendar/timegrid, interaction | 6.1.21 | MIT | `@fullcalendar/core` est déjà en 7.1.0 alors que les plugins restent en 6.x (7.0 en RC) : alignement des versions à trancher en Phase 4. Les paquets `resource-*` sont sous licence commerciale → non utilisés |
| recharts | 3.10.1 | MIT | |
| luxon / libphonenumber-js | 3.7.2 / 1.13.14 | MIT | |
| pino | 10.3.1 | MIT | |
| @anthropic-ai/sdk | 0.128.0 | MIT | |
| @googleapis/calendar | 20.0.1 | Apache-2.0 | Client Calendar seul, plus léger que `googleapis` |
| vitest / @playwright/test | 5.0.2 / 1.63.0 | MIT / Apache-2.0 | |
| E-mail transactionnel | Réinitialisation de mot de passe | — | **Évitable au MVP** : réinitialisation par l'administrateur | — |

MCP : **aucun MCP n'est nécessaire au produit.** Les intégrations directes par API sont plus simples à contrôler, tester et sécuriser. Côté développement, les outils déjà disponibles (GitHub) suffisent.

---

## M. Risques techniques et solutions

| # | Risque | Probabilité / impact | Mitigation |
|---|---|---|---|
| 1 | Double réservation (concurrence agent + secrétaire) | Moyenne / élevé | Contrainte d'exclusion + verrou par praticien + holds ; test de concurrence |
| 2 | L'agent affirme une réservation inexistante | Moyenne / élevé | Réservation uniquement via outils ; confirmation générée par le code ; tests d'évaluation qui vérifient la cohérence texte/outils. **Risque résiduel faible mais non nul** sur les formulations libres |
| 3 | Injection de prompt par un patient | Moyenne / moyen | Aucun outil ne dépasse le périmètre de la conversation ; contexte serveur ; pas d'outil admin |
| 4 | Identité faible via le numéro (téléphone partagé, numéro réattribué) | Moyenne / moyen | Divulgation minimale ; liens famille explicites ; confirmation du nom avant d'afficher un RDV ; modifications d'identité réservées au personnel |
| 5 | Mauvaise gestion d'une urgence | Faible / très élevé | Routeur dédié + texte d'urgence fixe du cabinet + handoff prioritaire + alerte ; jeu de tests d'urgence |
| 6 | Restriction ou blocage du compte WhatsApp (qualité, politique) | Faible / élevé | Opt-in, templates conformes, agent limité au cabinet, escalade humaine ; interface `WhatsAppPort` permettant de changer de fournisseur |
| 7 | Fenêtre de 24 h mal gérée (échecs d'envoi) | Moyenne / moyen | Calcul depuis `last_inbound_at` ; templates automatiques hors fenêtre ; l'interface l'impose |
| 8 | Webhooks dupliqués ou désordonnés | Élevée / faible | Déduplication par identifiant ; statuts monotones |
| 9 | Bugs de fuseau horaire / changement d'heure | Moyenne / élevé | UTC en base, Luxon, tests sur les dates de changement d'heure |
| 10 | Divergence base ↔ Google Calendar | Moyenne / faible | Base = vérité ; réconciliation nocturne ; alertes |
| 11 | Indisponibilité de l'API Claude | Faible / moyen | Timeout, retry, message fixe + handoff |
| 12 | Dérive des coûts LLM | Moyenne / moyen | Suivi des tokens par run ; plafonds ; cache de prompt ; choix du modèle par évaluation |
| 13 | Non-conformité données de santé (transferts hors UE vers Meta, Google, Anthropic ; clause santé de la politique WhatsApp) | Moyenne / très élevé — **peut remettre en cause le canal WhatsApp lui-même** selon le pays | Minimisation : l'agent ne sollicite jamais de symptômes détaillés, types de soins génériques, aucun type de soin dans les rappels, rien de médical dans Google ; DPA ; hébergement adapté ; **avis juridique avant la Phase 6** (et non seulement avant la production), car une réponse négative change le produit |
| 14 | Perte de données | Faible / très élevé | PITR, sauvegardes hors site chiffrées, tests de restauration |
| 15 | Périmètre qui dérive vers un logiciel métier dentaire complet | Élevée / élevé | Périmètre MVP explicite ; clarification O3 |
| 16 | Intégrations non vérifiables depuis l'environnement de dev (Meta bloqué) | Certaine / moyen | Fakes + tests de contrat ici ; tests réels sur staging avec vos identifiants avant de déclarer l'intégration fonctionnelle |

---

## N. Coûts potentiels des services externes

Ordres de grandeur, **hors hébergement de production et hors développement**. Hypothèse de volume pour un cabinet : ~400 conversations WhatsApp/mois, ~600 rendez-vous/mois.

### N.1 WhatsApp (Meta) — tarification par message, variable selon le pays du destinataire
- Marketing : le plus cher (non utilisé au MVP).
- **Utility** (rappels, confirmations hors fenêtre) : tarif utility du pays. Exemple publié pour les États-Unis (juin 2026) : 0,004 $/message.
- **Service** (réponses dans la fenêtre de 24 h) : gratuit jusqu'au 30 septembre 2026 ; **à partir du 1er octobre 2026 : 1 000 messages gratuits par numéro et par mois, puis facturés au tarif utility**.
- Formule : `coût ≈ (rappels + templates) × tarif_utility + max(0, messages_service − 1000) × tarif_utility`.
- Exemple : 600 rappels + (400 conversations × 6 réponses = 2 400 messages de service, dont 1 400 facturés) ≈ **2 000 messages facturés/mois × tarif utility du pays**. Au tarif américain : ≈ 8 $/mois. **Le tarif de votre pays est à lire sur la grille officielle de Meta**, que je n'ai pas pu consulter directement.
- Un intermédiaire (BSP) ajoute typiquement une marge par message ; évitée avec la Cloud API directe.

### N.2 API Claude (tarifs Anthropic, par million de tokens)
| Modèle | Entrée | Sortie | Coût estimé / conversation de réservation* | ~400 conversations/mois* |
|---|---|---|---|---|
| `claude-opus-5` (par défaut) | 5 $ | 25 $ | 0,30 – 0,50 $ | 120 – 200 $ |
| `claude-opus-5-5` (option ; « en lancement » dans la référence du 2026-06-24, disponibilité sur votre compte à confirmer) | 4 $ | 20 $ | 0,24 – 0,40 $ | 95 – 160 $ |
| `claude-sonnet-5` | 2 $ | 10 $ | 0,12 – 0,20 $ | 50 – 80 $ |
| `claude-haiku-4-5` | 1 $ | 5 $ | 0,06 – 0,10 $ | 25 – 40 $ |

\* Estimation à ±50 % : ~5 tours patient, ~2 appels LLM par tour + routeur, ~5 000 tokens de préfixe stable (lectures en cache à ~0,1× le prix d'entrée), ~3 000 tokens de contexte variable, ~600 tokens de sortie par appel. Les réponses espacées de plus de 5 minutes ne bénéficient pas du cache par défaut ; une durée de cache d'1 h existe (écriture plus chère), son intérêt sera mesuré. Claude Opus 5.5 diffère d'Opus 5 sur plusieurs points d'API (réflexion non désactivable, effort par défaut `medium`, forçage d'outil refusé) : il ne sera retenu qu'après passage de la même suite d'évaluation. **Ces chiffres seront remplacés par des mesures réelles** (tokens journalisés par run) en Phase 7. Le choix d'un modèle moins cher vous revient, sur la base de la suite d'évaluation.

### N.3 Google Calendar API
Gratuit dans les quotas actuels ; volume attendu très inférieur au seuil de 1 000 000 requêtes/jour. Pas besoin de Google Workspace avec un compte de service. Évolution de facturation annoncée pour fin 2026 **[À SURVEILLER]**.

### N.4 Autres
| Poste | Estimation | Confiance |
|---|---|---|
| Hébergement (VM + PostgreSQL managé + sauvegardes) | ~30 à 150 €/mois selon le fournisseur ; l'hébergement certifié HDS se situe dans le haut de la fourchette | Faible — dépend du pays et du fournisseur |
| Nom de domaine | ~10–20 €/an | Élevée |
| Certificats TLS | 0 € (Let's Encrypt via Caddy) | Élevée |
| Suivi d'erreurs | 0 € (offre gratuite ou auto-hébergé) | Moyenne |
| Numéro de téléphone dédié WhatsApp | Coût d'une ligne | Élevée |

---

## O. Questions réellement bloquantes

Classées selon la phase qu'elles bloquent. **Seule la question 0 bloque la Phase 1.**

| # | Question | Bloque | Pourquoi | Hypothèse par défaut si pas de réponse |
|---|---|---|---|---|
| 0 | Validez-vous l'architecture et la stack (A, B, C) ? | Phase 1 | Tout le code en dépend | — |
| 1 | **Pays du cabinet** ? Et : acceptez-vous de consulter un juriste sur l'usage de WhatsApp pour des échanges patients **avant la Phase 6** ? | Phases 6, 7, 13 | Loi applicable (RGPD, loi 09-08…), hébergement HDS obligatoire en France, clause santé de la politique WhatsApp (L), numéro d'urgence, format téléphone, devise, tarifs WhatsApp | Aucune pour la production. Les phases 1 à 5 n'en dépendent pas |
| 2 | **Langues des patients** (français seul ? arabe/darija ? autre ?) | Phase 7 | Prompts, templates WhatsApp (approuvés par langue), tests | Français uniquement |
| 3 | Le cabinet utilise-t-il déjà un **logiciel métier dentaire** (dossier clinique, facturation, télétransmission) ? | Phases 3 et 10 | Évite de dupliquer le dossier médical et la facturation ; détermine si « finances » = suivi interne ou facturation légale | Pas de dossier clinique au MVP (notes restreintes seulement) ; finances = suivi interne des encaissements, **pas** de facturation légale |
| 4 | Nombre de **praticiens** et de **fauteuils/salles** ; un rendez-vous mobilise-t-il un fauteuil ou un(e) assistant(e) ? | Phase 4 | Modèle de ressources de la contrainte anti double réservation | Ressource = praticien ; pas de gestion de fauteuils |
| 5 | Le dentiste utilise-t-il déjà **Google Calendar** (compte Gmail ou Workspace) et contient-il des rendez-vous existants à reprendre ? Le cabinet peut-il créer un compte Google dédié, propriétaire du calendrier miroir ? | Phase 5 | Import initial, choix du calendrier d'indisponibilités, propriétaire du miroir (H.3) | Compte Google dédié du cabinet ; nouveau calendrier miroir ; pas de reprise d'historique |
| 6 | Niveau de détail acceptable dans les événements Google (nom complet, prénom + initiale, référence seule) ? | Phase 5 | Minimisation des données de santé chez un tiers | Prénom + initiale + type de soin |
| 7 | Disposez-vous d'un **numéro dédié** non utilisé sur l'application WhatsApp, et pouvez-vous faire vérifier l'entreprise par Meta ? | Phase 6 | Délai d'onboarding Meta indépendant du code | À démarrer maintenant |
| 8 | Règles du cabinet : délai minimal d'annulation/déplacement par WhatsApp, horizon de réservation, types de soins réservables par l'agent (1re consultation ? urgence ?), texte et numéro d'urgence | Phases 4 et 7 | Paramètres métier des outils de l'agent | Annulation ≥ 24 h, horizon 60 jours, seuls contrôle et détartrage réservables, urgences → humain |
| 9 | Matrice de permissions (I.2) : la secrétaire voit-elle le CA ? peut-elle annuler un paiement ? bloquer l'agenda du dentiste ? | Phases 2 et 10 | Permissions par défaut | Celles marquées ⚠︎ ci-dessus : non / non / oui |
| 10 | Définition du **chiffre d'affaires** : encaissements (paiements reçus sur la période) ou montants facturés ? | Phase 10 | Formule de calcul | Encaissements, libellé « revenus encaissés » |

---

## Annexe — Périmètre explicitement hors MVP
Portail patient, documents et radiographies, dépenses et comptabilité, facturation légale et télétransmission, odontogramme, interface d'onboarding multi-cabinets (l'architecture la supporte, l'onboarding sera manuel), réinitialisation de mot de passe en libre-service, canal SMS de secours.

## Annexe — Sources consultées lors de la révision 1 (2026-09-26)

Les pages officielles de Meta et de Google sont bloquées depuis l'environnement de développement. Les points suivants reposent donc sur des sources secondaires concordantes, qui citent la documentation officielle. Chacun sera revérifié sur la source officielle dans la phase concernée.

- Tarification WhatsApp au 1er octobre 2026 : [Courier](https://www.courier.com/blog/whatsapp-pricing-changes-october-2026), [respond.io](https://respond.io/blog/whatsapp-pricing-change-2026), [EngageLab](https://www.engagelab.com/blog/whatsapp-business-api-pricing) ; page officielle : [Meta for Developers — Pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- Politique Meta sur les chatbots IA généralistes : [respond.io](https://respond.io/blog/whatsapp-general-purpose-chatbots-ban), [TechCrunch](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform/)
- Politique de messagerie WhatsApp Business (clause santé) : [business.whatsapp.com/policy](https://business.whatsapp.com/policy)
- Quotas Google Calendar : [Google — Usage limits](https://developers.google.com/workspace/calendar/api/guides/quota), [Nylas](https://cli.nylas.com/guides/google-calendar-api-quotas)
- Propriété des calendriers secondaires et comptes de service : [Google — Calendar sharing](https://developers.google.com/workspace/calendar/api/concepts/sharing), [Issue tracker 148804709](https://issuetracker.google.com/issues/148804709)
- Modèles et tarifs Claude : référence Anthropic intégrée à l'outillage (mise à jour du 2026-06-24)
- Paquets npm : `npm view <paquet> version license` sur registry.npmjs.org
