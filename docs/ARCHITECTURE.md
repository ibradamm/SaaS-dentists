# Plateforme de gestion de cabinet dentaire — Architecture v2

> Statut : **en vigueur depuis le 2026-09-26** (recentrage du périmètre, ADR 0004).
> - L'architecture v1, qui incluait WhatsApp, l'agent IA et Google Calendar, est archivée dans `docs/future/`.
> - Phases réalisées : 0 (analyse), 1 (fondations), 2 (authentification, rôles, utilisateurs), 3 (patients et import), 4 (cabinet et disponibilités, en attente de validation).
> - Décisions détaillées : `docs/adr/`. Rapports de phase : `docs/phases/`.

---

## 0. Périmètre

**Dans le périmètre :** un SaaS de gestion de cabinet dentaire, utilisé par le personnel (administrateur, dentiste, secrétaire), qui permet de gérer entièrement le cabinet :
- utilisateurs et permissions ;
- paramètres du cabinet ;
- patients, avec import de données existantes ;
- praticiens, disponibilités et blocages ;
- rendez-vous et agenda ;
- paiements et revenus encaissés ;
- tableau de bord, statistiques et journal d'audit.

L'architecture reste multi-cabinets : chaque donnée métier est rattachée à un cabinet et isolée par PostgreSQL.

**Hors périmètre actuel (extensions futures, `docs/future/README.md`) :**
- WhatsApp ;
- agent conversationnel IA ;
- Google Calendar ;
- rappels aux patients (SMS, e-mail) ;
- portail patient ;
- facturation légale et télétransmission, dossier clinique complet (odontogramme, radiographies) ;
- interface d'inscription de nouveaux cabinets (création par commande d'administration pour l'instant).

---

## A. Architecture

### A.1 Invariants et mécanismes qui les garantissent

| Invariant | Mécanisme (dans le code et la base, pas seulement dans l'interface) |
|---|---|
| I1. Aucune double réservation d'un praticien ni d'un patient | Contraintes d'exclusion PostgreSQL (`EXCLUDE USING gist`) sur (praticien, plage) et (patient, plage), limitées aux statuts qui occupent le créneau ; verrou transactionnel par praticien pour les contrôles d'horaires et d'absences (ADR 0007) |
| I2. Aucune fuite entre cabinets | `clinic_id` partout, clés étrangères composites, Row-Level Security activée et forcée sur toutes les tables, filtre explicite dans les services (ADR 0001) |
| I3. Permissions vérifiées côté serveur | `authorize()` dans chaque service et permission déclarée par route (ADR 0003) ; l'interface masque seulement |
| I4. Actions sensibles tracées | Journal d'audit en ajout seul, écrit dans la même transaction que l'action |
| I5. Aucune action asynchrone perdue | Tâche enfilée dans la transaction métier (outbox pg-boss), rejouée en cas d'échec |

**Source de vérité unique : PostgreSQL.**

### A.2 Vue d'ensemble

```
 Navigateur (React : administrateur, dentiste, secrétaire)
        │  HTTPS, cookie de session httpOnly, jeton CSRF
        ▼
 API (Fastify) ── authentification, permissions, validation (Zod), audit
        │  services métier (même code pour l'API et les tâches)
        ▼
 PostgreSQL 16 ── données métier (RLS), file de tâches (pg-boss), journal d'audit
        ▲
        │
 Worker (Node) ── tâches asynchrones : purges, conservation des données,
                  futures intégrations
```

**Monolithe modulaire** : une base de code et deux processus (API, worker). Pour une petite équipe et un faible volume, les microservices ajouteraient de la complexité sans bénéfice.

### A.3 Couches

```
Adaptateurs d'entrée   Routes HTTP │ Gestionnaires de tâches
                             ▼             ▼
Services métier        auth, users, clinic, patients, imports, scheduling,
(règles, permissions,  appointments, finance, dashboard, audit
 audit)
                             ▼
Accès aux données      Drizzle ORM, toujours dans un contexte cabinet (withTenant)
```

Règles :
- aucune règle métier dans l'interface ni dans les routes ;
- une intégration externe future passera par un port (interface) et un adaptateur, testable avec une implémentation factice.

### A.4 Surface d'API

| Domaine | Routes | État |
|---|---|---|
| Santé | `GET /health/live`, `GET /health/ready` | Fait |
| Authentification | `POST /api/auth/login`, `/logout`, `/password`, `/mfa/setup`, `/mfa/activate`, `/mfa/verify` ; `GET /api/auth/me`, `/csrf` | Fait |
| Utilisateurs | `GET/POST /api/users`, `PATCH /api/users/:id`, `POST /api/users/:id/reset-password`, `/reset-mfa` | Fait |
| Cabinet | `GET/PATCH /api/clinic` (nom, fuseau, langue, coordonnées) | Fait |
| Patients | `GET/POST /api/patients`, `GET/PATCH /api/patients/:id`, archivage, contacts, notes médicales, doublons | Fait |
| Import | `GET/POST /api/imports`, lignes, rapport, validation, annulation, abandon | Fait |
| Praticiens et disponibilités | `GET/POST /api/practitioners`, `PATCH /:id`, archivage ; `GET/POST /api/appointment-types`, `PATCH /:id`, archivage ; `GET/PUT /api/practitioners/:id/schedules`, `DELETE …/schedules/:periodId` ; `GET/POST /api/availability-blocks`, `PUT/DELETE /:id` ; `GET /api/availability?from&to&practitionerId` | Fait (ADR 0006) |
| Rendez-vous | `GET /api/appointments?from&to&practitionerId&includeCancelled`, `GET /api/appointments/:id`, `POST /api/appointments` (confirmation explicite `allowOutsideAvailability`), `PATCH /:id` (déplacement, version), `POST /:id/status` (honoré, patient absent, annulé, correction) ; `GET /api/patients/:id/appointments` ; `GET /api/availability/slots` ; conflits renvoyés par les écritures d'horaires et d'indisponibilités | Fait (ADR 0007) |
| Finances | `GET /api/patients/:id/account` ; `POST /api/charges` (clé d'idempotence, paiement immédiat facultatif), `POST /api/charges/:id/cancel` ; `POST /api/payments` (clé d'idempotence), `POST /api/payments/:id/void` ; `GET /api/receivables` ; `GET /api/finance/revenue?from&to`, `GET /api/finance/payments?from&to` | Fait (ADR 0009) |
| Tableau de bord et statistiques | `GET /api/dashboard?from&to&practitionerId` : activité, occupation, patients, restant à encaisser, honorés sans acte, revenus ; sections selon les permissions | Fait (ADR 0010) |
| Journal d'audit | `GET /api/audit-logs?from&to&actorId&action&entityType&entityId&before` (permission `audit.read`, jours locaux du cabinet, curseur exact), `GET /api/audit-logs/actors` | Fait (ADR 0011) |

Les contrats d'entrée et de sortie sont des schémas Zod de `packages/shared`, partagés par le serveur et l'interface.

### A.5 Observabilité
- **Logs JSON** (pino), avec un `request_id` généré par le serveur ; champs sensibles masqués à la source.
- **Erreurs journalisées par liste blanche** : type, code, SQL sans valeurs, pile ; jamais les paramètres SQL ni le `detail` PostgreSQL (ADR 0011).
- **Journal d'audit** consultable par l'administrateur (page « Journal », ADR 0011).
- **Remontée des erreurs vers Sentry**, facultative (`SENTRY_DSN`), sans SDK, événement par liste blanche, environnement = `APP_ENV` (ADR 0011). À vérifier contre le vrai service en recette.
- **Métriques** (`/metrics`, réseau interne) : Phase 11.

### A.6 Environnements
- `APP_ENV` ∈ `development`, `test`, `staging`, `production` ; configuration validée au démarrage.
- **Tests :** base jetable à chaque exécution ; parcours de bout en bout sur une base `dental_e2e` recréée, avec les migrations, l'API, le worker et l'interface compilés (ADR 0012).
- **Staging :** jamais de données patients réelles.

---

## B. Stack technique (versions figées dans le lockfile)

| Besoin | Choix | Raison principale |
|---|---|---|
| Langage | TypeScript 6.0 (strict) partout | Contrats partagés serveur et interface. La version 7 est incompatible avec typescript-eslint |
| Serveur | Node.js 22, Fastify 5, Zod 4 | Code explicite, validation systématique |
| Base de données | PostgreSQL 16 | Contraintes d'exclusion, RLS, transactions |
| Accès aux données, migrations | Drizzle ORM ; drizzle-kit pour générer le SQL ; exécuteur de migrations strict maison | ADR 0002 |
| Tâches asynchrones | pg-boss 12 (dans PostgreSQL) | Outbox transactionnelle, aucune infrastructure en plus |
| Authentification | Sessions serveur, Argon2id (`@node-rs/argon2`), TOTP (otplib) | ADR 0003 |
| Téléphones | libphonenumber-js (métadonnées complètes) | Normalisation E.164 fiable |
| Interface | React 19, Vite 8, react-router 8, TanStack Query 5, Tailwind 4 | Application de gestion sans besoin de rendu serveur |
| Import de fichiers | papaparse (CSV), read-excel-file (xlsx), lecture dans le navigateur | ADR 0005 |
| Agenda | Grille maison (React, `Intl`), sans bibliothèque de calendrier | FullCalendar écarté : fuseau nommé du cabinet seulement avec un greffon Luxon (> 200 ko) ; pas de glisser-déposer au MVP (ADR 0007, section 7) |
| Dates et fuseaux | Luxon (serveur) ; `Intl` dans l'interface pour l'affichage dans le fuseau du cabinet | Fuseaux IANA, changements d'heure (ADR 0006) |
| Graphiques | Écrits à la main (HTML et CSS) | Colonnes, barres et jauges simples : une bibliothèque ajouterait plusieurs dizaines de ko (ADR 0010) |
| Tests | Vitest, Testing Library, Playwright 1.56 (Chromium) et axe-core : parcours de bout en bout sur la pile de production (ADR 0012) | |
| Qualité | ESLint (règles de frontières), Prettier, gitleaks, `pnpm audit` en CI, budget du chargement initial de l'interface (`pnpm check:bundle`) | |
| Déploiement (Phase 11) | Conteneurs, Caddy (TLS automatique), PostgreSQL managé avec restauration à un instant donné | |

---

## C. Structure du dépôt

```
apps/server/src/
  api/           routes HTTP, plugin d'authentification, cookie, gestion d'erreurs
  config/        variables d'environnement (Zod), logger
  db/            client, withTenant, schéma Drizzle, migrations, exécuteur, bootstrap, CLI
  jobs/          file de tâches (pg-boss), gestionnaires
  lib/           erreurs, chiffrement, métadonnées de requête
  modules/       audit, auth, users, clinic, patients, imports, scheduling, appointments (puis finance…)
apps/web/src/    app (routeur, en-tête, gardes), pages (today, agenda, patients, availability, settings…),
                 composants, lib (client API, cache, auth, dates)
packages/shared/ contrats Zod, catalogue des permissions
infra/           docker-compose de développement
scripts/         PostgreSQL local, initialisation du .env
docs/            ARCHITECTURE.md, adr/, phases/, future/
```

---

## D. Base de données

### D.1 Conventions
- **Identifiants :** UUID v7 générés par l'application.
- **Dates :** `timestamptz` en UTC ; fuseau IANA du cabinet pour l'affichage et les disponibilités.
- **Montants :** entiers en centimes, avec code devise.
- **Isolation :** `clinic_id` obligatoire, par défaut celui du contexte de transaction. Clés étrangères composites `(clinic_id, x_id)`. RLS activée et forcée sur toutes les tables ; test de catalogue bloquant.
- **Rôles :** `dental_owner` exécute les migrations ; `dental_app` n'a que des droits DML, colonne par colonne quand c'est pertinent.
- **Suppression :** archivage plutôt que suppression. Le verrou optimiste (`version`) protège les fiches modifiables.

### D.2 Tables

| Table | Rôle | État |
|---|---|---|
| `clinics` | Cabinet : nom, fuseau, langue, devise, pays, coordonnées, paramètres | Fait |
| `audit_logs` | Journal en ajout seul | Fait |
| `users`, `clinic_memberships`, `sessions` | Comptes, rôle par cabinet, sessions | Fait |
| `patients` | Identité, coordonnées administratives, note administrative, statut (actif ou archivé), source (saisie ou import), numéro de dossier d'origine, version | Fait |
| `patient_contacts` | Téléphones au format E.164, lien (patient lui-même, responsable légal, autre), contact principal | Fait |
| `patient_medical_notes` | Notes médicales chiffrées, en ajout seul, lecture tracée | Fait |
| `import_batches`, `import_rows` | Lots d'import et lignes validées ; données effacées après validation ou abandon | Fait |
| `practitioners` | Praticien réservable (lié ou non à un compte membre du cabinet), couleur, actif ou archivé, version | Fait |
| `appointment_types` | Type de rendez-vous : nom (unique parmi les actifs), durée (5 à 480 min), couleur, version | Fait |
| `working_schedules`, `working_intervals` | Périodes d'horaires datées par praticien, plages hebdomadaires en heure locale ; chevauchements refusés par contraintes d'exclusion | Fait |
| `availability_blocks` | Absences et créneaux bloqués, d'un praticien ou de tout le cabinet, en instants UTC | Fait |
| `appointment_statuses` | Statuts (prévu, honoré, patient absent, annulé) et leur effet sur le créneau (`occupies_slot`) ; commune à tous les cabinets, lecture seule pour l'application | Fait |
| `appointments` | Rendez-vous : praticien, patient, type, début et fin (grille de 5 min, 5 à 480 min), statut, note administrative, motif d'annulation, mention « sans facturation » (rendez-vous gratuit, ADR 0010), version ; jamais supprimés | Fait |
| `charges` | Montants dus (« actes à encaisser ») : patient, rendez-vous et praticien facultatifs, libellé, montant en centimes, devise, ouvert ou annulé (motif, date, auteur), clé d'idempotence ; jamais modifiés ni supprimés | Fait |
| `payments` | Encaissements rattachés à un montant dû : montant en centimes, moyen, référence, instant d'enregistrement fixé par le serveur, encaissé ou annulé (motif, date, auteur), clé d'idempotence ; jamais modifiés ni supprimés | Fait |

**Garanties financières (migration 0014, ADR 0009)** : droits par colonne (seules les colonnes d'annulation sont modifiables, aucun `DELETE`), déclencheurs qui n'autorisent que `OPEN → CANCELLED` et `RECORDED → VOIDED`, et un déclencheur qui verrouille le montant dû (`FOR UPDATE`) avant de vérifier que la somme des paiements valides ne dépasse pas le dû. Les dépenses ne sont pas suivies au MVP (question 4).

**Contraintes anti double réservation (migration 0012)** : `EXCLUDE USING gist (practitioner_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (occupies_slot)`, et la même sur `patient_id`. `occupies_slot` est recalculée depuis le statut par un déclencheur et n'est pas modifiable par l'application : ajouter un statut ne demande qu'une ligne dans `appointment_statuses`. Tests de concurrence réels (service et HTTP) : ADR 0007 et rapport de la Phase 5.

---

## E. Flux métier du personnel

1. **Journée type :**
   1. la secrétaire se connecte et consulte l'agenda du jour ;
   2. elle crée, déplace ou annule des rendez-vous, et recherche ou crée les patients ;
   3. elle enregistre les paiements.
2. **Dentiste :** agenda, fiches patients, notes médicales, blocage de ses créneaux, revenus encaissés.
3. **Chaque écriture :** permission vérifiée, transaction, audit, verrou optimiste. Si la fiche a changé entre-temps, l'écran est rechargé au lieu d'écraser la modification.
4. **Blocage d'un créneau déjà occupé :** les rendez-vous en conflit sont listés et une décision explicite est demandée. Aucune annulation silencieuse.
5. **Import initial :** l'administrateur importe les patients de l'ancien outil (CSV ou Excel, voir Phase 3).

---

## F. Rôles et permissions

Le catalogue et la matrice sont définis dans le code (`packages/shared/src/permissions.ts`) et testés de façon exhaustive (ADR 0003). Réponses O9 du 2026-09-26 appliquées.

| Permission | ADMIN | DENTIST | SECRETARY |
|---|:-:|:-:|:-:|
| `appointment.read`, `appointment.write` | ✓ | ✓ | ✓ |
| `schedule.manage_own` (ses horaires et blocages) | ✓ | ✓ | — |
| `schedule.manage_any` (tout praticien) | ✓ | — | ✓ |
| `patient.read`, `patient.write` | ✓ | ✓ | ✓ |
| `patient.medical.read`, `patient.medical.write` | ✓ | ✓ | — |
| `payment.read`, `payment.write` | ✓ | ✓ | ✓ |
| `payment.void` | ✓ | ✓ | — |
| `finance.reports.read` | ✓ | ✓ | — |
| `clinic.settings.manage`, `user.manage`, `audit.read` | ✓ | — | — |
| `data.import` | ✓ | — | — |

Double authentification obligatoire pour ADMIN et DENTIST.

---

## G. Sécurité

| Domaine | Mesure |
|---|---|
| Transport | TLS (Caddy), HSTS, cookies `Secure` et `__Host-` hors développement |
| Authentification | Argon2id, verrouillage, sessions révocables, TOTP, renouvellement du jeton à chaque élévation (ADR 0003) ; tentatives sérialisées par adresse, codes TOTP faux comptés pour le compte (ADR 0011) |
| Requêtes | Politique d'accès obligatoire sur chaque route, vérifiée avant la lecture du corps ; jeton CSRF et vérification de l'origine ; limitation du nombre de requêtes ; taille des corps limitée ; en-têtes de sécurité (helmet) ; matrice de toutes les routes testée (ADR 0011) |
| Autorisation | Permissions dans les services et les routes, RLS, clés composites, droits par colonne |
| Validation | Zod sur chaque entrée ; requêtes paramétrées uniquement |
| Données sensibles | Notes médicales et secrets TOTP chiffrés (AES-256-GCM), clé hors base ; lecture des notes médicales auditée |
| Secrets | Variables d'environnement et gestionnaire de secrets ; gitleaks en CI ; `.env` exclu de Git |
| Interface | Pages chargées à la demande ; cache des requêtes vidé à tout changement de session (compte, cabinet, expiration) et retour à la connexion sur une réponse 401 (ADR 0008) |
| Logs et audit | Aucune donnée patient dans les logs (chemin des requêtes sans chaîne de requête, corps masqués, erreurs par liste blanche) ; l'audit ne recopie pas les valeurs modifiées (noms de champs seulement) ; catalogue fermé des actions |
| Sauvegardes | PostgreSQL managé avec restauration à un instant donné ; test de restauration documenté (Phase 11) |

### G.2 Durées de conservation (proposition technique, à valider juridiquement)

| Donnée | Proposition |
|---|---|
| Lignes d'import (données personnelles) | Effacées à la validation ou à l'abandon du lot ; brouillons abandonnés effacés après 24 h (tâche nocturne, ADR 0011) |
| Sessions terminées | 30 jours après leur fin (validé pour le MVP), puis supprimées par la tâche nocturne. Politique configurable (`SESSION_RETENTION_DAYS`, 30 à 3 650 jours) à revoir après avis juridique ; plancher de 30 jours dans la politique RLS (ADR 0011) |
| Journaux applicatifs | 30 jours |
| `audit_logs` | À fixer avec un juriste (souvent plusieurs années) |
| Paiements | Durée légale comptable du pays |
| Patients inactifs | Archivage ; effacement selon la règle retenue après avis juridique (conflit avec la conservation du dossier médical, ADR 0011) |

---

## H. Plan des phases (v2)

L'ordre suit les priorités fixées le 2026-09-26. Les disponibilités passent avant les rendez-vous, car un rendez-vous ne se valide que par rapport aux horaires et aux blocages d'un praticien. Chaque phase livre son interface, ses tests et sa documentation.

| Phase | Contenu | Priorités couvertes | État |
|---|---|---|---|
| 0 | Analyse et architecture | — | Fait |
| 1 | Fondations : monorepo, PostgreSQL, migrations, isolation, file de tâches, CI | 1, 2 | Fait |
| 2 | Authentification, rôles, permissions, utilisateurs, paramètres minimaux du cabinet | 3, 4, 6 | Fait |
| 3 | Patients : dossier administratif, contacts, notes médicales restreintes, recherche, doublons, **import CSV / Excel** | 7 | Fait |
| 4 | Cabinet et disponibilités : profil du cabinet, praticiens (un ou plusieurs), types de rendez-vous, horaires hebdomadaires datés, absences et blocages, calcul des disponibilités (pas de table d'horaires d'ouverture, ADR 0006) | 5, 10, 11 | Fait |
| 5 | Rendez-vous et agenda : création, déplacement, annulation, statuts, anti double réservation, vues jour et semaine, historique patient (ADR 0007) | 8, 9 | Fait |
| 6 | Applications web dentiste et secrétaire : parcours quotidiens par rôle, ergonomie, accessibilité, téléphone et tablette (ADR 0008) | 12, 13 | Fait |
| 7 | Paiements et revenus encaissés : actes à encaisser, paiements partiels, restant dû, annulations motivées, « À encaisser », revenus par période (ADR 0009) | 14 | Fait |
| 8 | Tableau de bord et statistiques : indicateurs du jour sur l'accueil, page « Statistiques » par période et praticien, calculs en base dans le fuseau du cabinet (ADR 0010) | 15, 16 | Fait |
| 9 | Journal d'audit consultable et revue de sécurité : page « Journal », matrice de toutes les routes, fuite entre cabinets, tentatives simultanées, journaux sans donnée patient, remontée des erreurs, conservation (ADR 0011) | 17, 18 | Fait |
| 10 | Tests complets et validation globale : parcours de bout en bout sur la pile de production en CI (trois rôles, concurrence, réseau, changement d'heure, isolation, accessibilité, responsive), charge, restauration, démonstration (ADR 0012, `docs/demo.md`) | 19 | Fait (en attente de validation) |
| 11 | Déploiement : hébergement, secrets, sauvegardes, supervision, procédures | 20 | À faire |

---

## I. Dépendances externes

**Aucun service payant n'est requis par le périmètre actuel.** Les seules dépendances sont :
- les paquets npm, sous licence MIT ou Apache-2.0, vérifiés à l'installation et audités en CI ;
- Sentry, **facultatif** (remontée des erreurs, sans SDK ni donnée saisie, ADR 0011) : désactivé sans `SENTRY_DSN`, offre gratuite suffisante au MVP ;
- l'hébergeur (Phase 11). Si le cabinet est en France, un hébergement certifié HDS est obligatoire pour des données de santé.

---

## J. Risques et parades

| Risque | Parade |
|---|---|
| Double réservation (deux secrétaires en même temps) | Contraintes d'exclusion et verrou par praticien ; tests de concurrence (service, HTTP, deux navigateurs) et tests par mutation (Phases 5 et 10) |
| Double encaissement ou encaissement supérieur au dû (double clic, réseau, deux postes) | Clé d'idempotence par saisie ; verrou du montant dû et contrôle de la somme en base ; tests de concurrence (base, service, HTTP, navigateur) et tests par mutation (Phase 7) |
| Double envoi d'un formulaire (double clic, bouton qui rebondit) | Bouton désactivé pendant l'envoi ; requêtes identiques en cours regroupées par le client API ; clés d'idempotence des encaissements ; parcours de bout en bout (Phase 10) |
| Erreurs de fuseau ou de changement d'heure | UTC en base, Luxon, tests sur les dates de changement d'heure ; parcours avec un poste réglé sur un autre fuseau que le cabinet ; test de garde contre tout affichage sans fuseau (Phase 10) |
| Import de mauvaise qualité (colonnes mal associées) | Aperçu avant validation, rapport ligne par ligne, annulation d'un import non modifié |
| Perte de données | Restauration à un instant donné, sauvegardes hors site, tests de restauration (sauvegarde et restauration vérifiées en CI, Phase 10 ; exercice sur l'hébergement réel en Phase 11) |
| Perte de la clé de chiffrement | Clé sauvegardée dans le gestionnaire de secrets ; sans elle, notes médicales et secrets TOTP sont illisibles |
| Non-conformité données de santé | Minimisation, hébergement adapté, avis juridique avant la production |
| Dérive du périmètre | Périmètre explicite (section 0, ADR 0004) |
| Limitation de débit en mémoire | Suffisante pour une seule instance ; stockage partagé si plusieurs instances (Phase 11) |
| Essais de mots de passe ou de codes en parallèle | Une tentative à la fois par adresse, 10 échecs (mots de passe et codes) puis 15 minutes de verrouillage ; tests de concurrence (ADR 0011) |
| Donnée patient dans un journal ou chez Sentry | Sérialisation des erreurs et événements Sentry par liste blanche ; tests sur erreurs réelles et parcours complet (ADR 0011) |

---

## K. Coûts

Seul l'hébergement est à prévoir, pour environ 30 à 150 € par mois selon le fournisseur (haut de fourchette pour un hébergement HDS), plus un nom de domaine. Aucun coût par message ni par appel d'IA dans le périmètre actuel.

---

## L. Questions ouvertes

| # | Question | Bloque | Réponse par défaut |
|---|---|---|---|
| 1 | Pays des premiers cabinets clients ? | Phase 11 (production) | Aucune : hébergement, conservation et obligations en dépendent |

Questions 3 et 4 (chiffre d'affaires, dépenses), réponse du 2026-09-27 : le chiffre d'affaires correspond aux sommes réellement encaissées ; le montant dû se distingue du montant payé ; paiements partiels et restant dû visibles ; pas de dépenses au MVP (ADR 0009).

Question 2 (praticiens, fauteuils), réponse du 2026-09-26 : un ou plusieurs praticiens par cabinet ; pas de fauteuils ni de salles au MVP, modèle extensible (ADR 0006, section 8).

Question O3 (logiciel métier existant), réponse du 2026-09-26 : inconnue, car le produit est un SaaS généraliste. D'où l'import de fichiers en Phase 3 et l'absence de dossier clinique complet.

---

## M. Extensions futures

Voir `docs/future/README.md` : conception de référence archivée, prérequis de chaque extension et fondations conservées dans le code (file de tâches et outbox, autorisation dans les services, acteurs d'audit, contacts E.164, chiffrement applicatif).
