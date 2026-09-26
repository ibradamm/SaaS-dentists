# Plateforme de gestion de cabinet dentaire — Architecture v2

> Statut : **en vigueur depuis le 2026-09-26** (recentrage du périmètre, ADR 0004).
> - L'architecture v1, qui incluait WhatsApp, l'agent IA et Google Calendar, est archivée dans `docs/future/`.
> - Phases réalisées : 0 (analyse), 1 (fondations), 2 (authentification, rôles, utilisateurs), 3 (patients et import, en attente de validation).
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
| I1. Aucune double réservation d'un praticien | Contrainte d'exclusion PostgreSQL (`EXCLUDE USING gist`) sur (praticien, plage horaire) et verrou transactionnel par praticien (Phase 5) |
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
| Cabinet | `GET/PATCH /api/clinic` | Fait (minimal) ; complété en Phase 4 |
| Patients | `GET/POST /api/patients`, `GET/PATCH /api/patients/:id`, archivage, contacts, notes médicales, doublons | Fait |
| Import | `GET/POST /api/imports`, lignes, rapport, validation, annulation, abandon | Fait |
| Praticiens et disponibilités | praticiens, types de rendez-vous, horaires hebdomadaires, blocages | Phase 4 |
| Rendez-vous | `GET /api/appointments?from&to&practitionerId`, création, modification ou déplacement (version), annulation, statut | Phase 5 |
| Finances | actes à encaisser, paiements, annulation de paiement, synthèses par période | Phase 7 |
| Tableau de bord et statistiques | indicateurs du jour, séries temporelles | Phase 8 |
| Audit | `GET /api/audit-logs` (filtres, pagination) | Phase 9 |

Les contrats d'entrée et de sortie sont des schémas Zod de `packages/shared`, partagés par le serveur et l'interface.

### A.5 Observabilité
- **Logs JSON** (pino), avec un `request_id` généré par le serveur ; champs sensibles masqués à la source.
- **Journal d'audit** consultable par l'administrateur (Phase 9).
- **Métriques** (`/metrics`, réseau interne) et **suivi des erreurs** sans données personnelles : Phase 11.

### A.6 Environnements
- `APP_ENV` ∈ `development`, `test`, `staging`, `production` ; configuration validée au démarrage.
- **Tests :** base jetable à chaque exécution.
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
| Agenda (Phase 5) | FullCalendar, paquets MIT uniquement ; alignement v6/v7 à trancher | Vues jour et semaine, glisser-déposer |
| Dates et fuseaux (Phases 4-5) | Luxon | Fuseaux IANA, changements d'heure |
| Graphiques (Phase 8) | Recharts | Intégration React |
| Tests | Vitest, Testing Library, Playwright (E2E en Phase 10) | |
| Qualité | ESLint (règles de frontières), Prettier, gitleaks, `pnpm audit` en CI | |
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
  modules/       audit, auth, users, clinic, patients, imports (puis scheduling, appointments, finance…)
apps/web/src/    app (routeur, gardes), pages, composants, lib (client API, auth)
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
| `clinics` | Cabinet : nom, fuseau, langue, devise, pays, paramètres | Fait |
| `audit_logs` | Journal en ajout seul | Fait |
| `users`, `clinic_memberships`, `sessions` | Comptes, rôle par cabinet, sessions | Fait |
| `patients` | Identité, coordonnées administratives, note administrative, statut (actif ou archivé), source (saisie ou import), numéro de dossier d'origine, version | Fait |
| `patient_contacts` | Téléphones au format E.164, lien (patient lui-même, responsable légal, autre), contact principal | Fait |
| `patient_medical_notes` | Notes médicales chiffrées, en ajout seul, lecture tracée | Fait |
| `import_batches`, `import_rows` | Lots d'import et lignes validées ; données effacées après validation ou abandon | Fait |
| `practitioners` | Praticien réservable (lié ou non à un compte), couleur, actif | Phase 4 |
| `appointment_types` | Type de rendez-vous : libellé, durée, couleur | Phase 4 |
| `working_hours` | Horaires hebdomadaires par praticien, avec période de validité | Phase 4 |
| `availability_blocks` | Absences, congés, créneaux bloqués | Phase 4 |
| `appointments` | Rendez-vous : praticien, patient, type, début et fin, statut (prévu, honoré, absent, annulé), note administrative, version | Phase 5 |
| `charges` | Montants dus (acte ou rendez-vous) | Phase 7 |
| `payments` | Paiements non modifiables : une erreur s'annule et se ressaisit | Phase 7 |
| `expenses` | Dépenses (option désactivée par défaut) | Phase 7 |

**Contrainte anti double réservation (Phase 5)** : `EXCLUDE USING gist (practitioner_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (status <> 'CANCELLED')`. Elle a été vérifiée sur PostgreSQL 16 en Phase 0 et fera l'objet d'un test de concurrence.

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
| Authentification | Argon2id, verrouillage, sessions révocables, TOTP, renouvellement du jeton à chaque élévation (ADR 0003) |
| Requêtes | Jeton CSRF et vérification de l'origine ; limitation du nombre de requêtes ; taille des corps limitée ; en-têtes de sécurité (helmet) |
| Autorisation | Permissions dans les services et les routes, RLS, clés composites, droits par colonne |
| Validation | Zod sur chaque entrée ; requêtes paramétrées uniquement |
| Données sensibles | Notes médicales et secrets TOTP chiffrés (AES-256-GCM), clé hors base ; lecture des notes médicales auditée |
| Secrets | Variables d'environnement et gestionnaire de secrets ; gitleaks en CI ; `.env` exclu de Git |
| Logs et audit | Aucune donnée patient dans les logs (chemin des requêtes sans chaîne de requête, corps masqués) ; l'audit ne recopie pas les valeurs modifiées (noms de champs seulement) |
| Sauvegardes | PostgreSQL managé avec restauration à un instant donné ; test de restauration documenté (Phase 11) |

### G.2 Durées de conservation (proposition technique, à valider juridiquement)

| Donnée | Proposition |
|---|---|
| Lignes d'import (données personnelles) | Effacées à la validation ou à l'abandon du lot ; brouillons abandonnés effacés après 24 h |
| Sessions expirées | Purge à ajouter (Phase 9) |
| Journaux applicatifs | 30 jours |
| `audit_logs` | À fixer avec un juriste (souvent plusieurs années) |
| Paiements | Durée légale comptable du pays |
| Patients inactifs | Archivage puis effacement selon la règle retenue (procédure d'effacement à documenter, Phase 9) |

---

## H. Plan des phases (v2)

L'ordre suit les priorités fixées le 2026-09-26. Les disponibilités passent avant les rendez-vous, car un rendez-vous ne se valide que par rapport aux horaires et aux blocages d'un praticien. Chaque phase livre son interface, ses tests et sa documentation.

| Phase | Contenu | Priorités couvertes | État |
|---|---|---|---|
| 0 | Analyse et architecture | — | Fait |
| 1 | Fondations : monorepo, PostgreSQL, migrations, isolation, file de tâches, CI | 1, 2 | Fait |
| 2 | Authentification, rôles, permissions, utilisateurs, paramètres minimaux du cabinet | 3, 4, 6 | Fait |
| 3 | Patients : dossier administratif, contacts, notes médicales restreintes, recherche, doublons, **import CSV / Excel** | 7 | Fait (en attente de validation) |
| 4 | Cabinet et disponibilités : profil du cabinet, horaires d'ouverture, praticiens, types de rendez-vous, horaires hebdomadaires, absences et blocages | 5, 10, 11 | À faire |
| 5 | Rendez-vous et agenda : création, déplacement, annulation, statuts, anti double réservation, vues jour et semaine, historique patient | 8, 9 | À faire |
| 6 | Applications web dentiste et secrétaire : parcours quotidiens par rôle, ergonomie, accessibilité, téléphone et tablette | 12, 13 | À faire |
| 7 | Paiements et revenus encaissés : actes à encaisser, paiements, annulations, impayés, périodes | 14 | À faire |
| 8 | Tableau de bord et statistiques | 15, 16 | À faire |
| 9 | Journal d'audit consultable et audit de sécurité : revue OWASP ASVS, purges, rétention, procédure d'effacement | 17, 18 | À faire |
| 10 | Tests complets : E2E Playwright en CI, charge, restauration | 19 | À faire |
| 11 | Déploiement : hébergement, secrets, sauvegardes, supervision, procédures | 20 | À faire |

---

## I. Dépendances externes

**Aucun service payant n'est requis par le périmètre actuel.** Les seules dépendances sont :
- les paquets npm, sous licence MIT ou Apache-2.0, vérifiés à l'installation et audités en CI ;
- l'hébergeur (Phase 11). Si le cabinet est en France, un hébergement certifié HDS est obligatoire pour des données de santé.

---

## J. Risques et parades

| Risque | Parade |
|---|---|
| Double réservation (deux secrétaires en même temps) | Contrainte d'exclusion et verrou par praticien ; test de concurrence |
| Erreurs de fuseau ou de changement d'heure | UTC en base, Luxon, tests sur les dates de changement d'heure |
| Import de mauvaise qualité (colonnes mal associées) | Aperçu avant validation, rapport ligne par ligne, annulation d'un import non modifié |
| Perte de données | Restauration à un instant donné, sauvegardes hors site, tests de restauration |
| Perte de la clé de chiffrement | Clé sauvegardée dans le gestionnaire de secrets ; sans elle, notes médicales et secrets TOTP sont illisibles |
| Non-conformité données de santé | Minimisation, hébergement adapté, avis juridique avant la production |
| Dérive du périmètre | Périmètre explicite (section 0, ADR 0004) |
| Limitation de débit en mémoire | Suffisante pour une seule instance ; stockage partagé si plusieurs instances (Phase 11) |

---

## K. Coûts

Seul l'hébergement est à prévoir, pour environ 30 à 150 € par mois selon le fournisseur (haut de fourchette pour un hébergement HDS), plus un nom de domaine. Aucun coût par message ni par appel d'IA dans le périmètre actuel.

---

## L. Questions ouvertes

| # | Question | Bloque | Réponse par défaut |
|---|---|---|---|
| 1 | Pays des premiers cabinets clients ? | Phase 11 (production) | Aucune : hébergement, conservation et obligations en dépendent |
| 2 | Plusieurs praticiens par cabinet ? Faut-il gérer les fauteuils ou salles ? | Phase 4 | Plusieurs praticiens ; pas de gestion des fauteuils |
| 3 | Chiffre d'affaires = sommes encaissées ou montants facturés ? | Phase 7 | Encaissements, libellés « revenus encaissés » |
| 4 | Suivre les dépenses ? | Phase 7 | Non (option désactivée) |

Question O3 (logiciel métier existant), réponse du 2026-09-26 : inconnue, car le produit est un SaaS généraliste. D'où l'import de fichiers en Phase 3 et l'absence de dossier clinique complet.

---

## M. Extensions futures

Voir `docs/future/README.md` : conception de référence archivée, prérequis de chaque extension et fondations conservées dans le code (file de tâches et outbox, autorisation dans les services, acteurs d'audit, contacts E.164, chiffrement applicatif).
