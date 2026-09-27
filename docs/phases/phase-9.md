# Phase 9 — Journal d'audit consultable et revue de sécurité : rapport

Date : 2026-09-27. Statut : **code et tests locaux terminés** ; résultat de la CI GitHub consigné dans le résumé de fin de phase. En attente de validation avant la Phase 10.

L'analyse, les constats et les décisions sont dans l'ADR 0011. Ce rapport dit ce qui a été livré, vérifié et comment.

## Réponses du porteur du projet (validation de la Phase 8)

| # | Réponse | Où c'est consigné |
|---|---|---|
| 1 | Mention « sans facturation » : un rendez-vous gratuit n'est pas un oubli d'encaissement | ADR 0010, section 10 ; livré avec la validation de la Phase 8 |
| 2 | Pas d'objectifs chiffrés au MVP ; export CSV des statistiques et revenus au backlog | `docs/future/README.md` |
| 3 | Occupation du planning : honorés et absents occupent le planning, annulés non ; jamais plus de 100 % ; taux d'occupation, d'absence et de présence distincts | ADR 0010, sections 4 et 10 |

## Livré

| Élément | Emplacement |
|---|---|
| Catalogue fermé des 47 actions et 10 types d'élément ; libellés dans un module chargé avec la page seulement | `packages/shared/src/audit.ts`, `audit-labels.ts` ; `recordAudit` refuse toute autre valeur |
| `GET /api/audit-logs` (filtres, jours locaux du cabinet, curseur exact) et `GET /api/audit-logs/actors`, permission `audit.read` | `modules/audit/audit-log.service.ts`, `api/routes/audit.ts` |
| Index de lecture du journal (migration 0017) | `db/migrations/0017_audit_log_reading_index.sql` |
| Page « Journal » : filtres dans l'adresse (partageables), historique d'un élément, lien vers la fiche patient, pages suivantes, heures dans le fuseau du cabinet | `apps/web/src/pages/audit/` |
| Contrôle d'accès avant la lecture du corps ; politique d'accès obligatoire sur toute route ; inventaire des routes | `api/auth-plugin.ts` |
| Tentatives d'authentification sérialisées par adresse ; codes TOTP faux comptés pour le compte | `modules/auth/auth.service.ts` |
| Sérialiseur d'erreurs par liste blanche | `config/logger.ts` |
| Remontée des erreurs vers Sentry sans SDK, désactivée sans `SENTRY_DSN`, environnements distincts | `lib/error-reporter.ts`, `config/env.ts`, `.env.example` |
| Tâche nocturne de conservation (sessions terminées, brouillons d'import), droits minimaux (migration 0018) | `jobs/retention.ts`, `db/migrations/0018_retention_security.sql` |
| Lignes d'un import inconnu : 404 | `modules/imports/imports.service.ts` |
| esbuild corrigé pour drizzle-kit | `pnpm-workspace.yaml` |
| Analyse et décisions | `docs/adr/0011-journal-audit-et-revue-securite.md` |

## Vérifications exécutées

| Commande | Résultat |
|---|---|
| `pnpm format:check && pnpm lint && pnpm typecheck` | Sans erreur |
| `pnpm test` | shared 80, serveur 388 (unitaires et intégration, base PostgreSQL 16 réelle), web 126 : tous verts |
| `pnpm build && pnpm check:bundle` | Chargement initial 146,2 ko compressés (budget 160 ko) |
| `pnpm --filter @dental/server db:generate` | Aucune dérive entre le schéma et les migrations |
| `pnpm audit` (production et développement) | Aucune vulnérabilité connue |
| gitleaks (index, puis historique complet) | Aucun secret |

### Tests ajoutés

| Test | Ce qu'il prouve |
|---|---|
| `api/__tests__/security-matrix.int.test.ts` | Pour les 74 routes (plus 29 HEAD) : routes publiques connues ; démarrage refusé pour une route sans politique ; 401 sans session **avant la lecture du corps** ; CSRF (jeton absent, faux, origine étrangère) sur les 45 routes modifiantes ; 403 pour chaque rôle sans la permission ; 403 pendant une étape d'authentification. Une nouvelle route entre automatiquement dans la matrice |
| `api/__tests__/cross-clinic.int.test.ts` | Toutes les routes appelées par l'administrateur de A avec les identifiants de 11 ressources de B : 404 partout, aucune donnée de B dans les réponses (listes et journal compris), empreinte SQL de toutes les tables de B inchangée |
| `modules/auth/__tests__/auth-attempts.int.test.ts` | Tentatives simultanées : au plus 10 évaluations, verrouillage exactement au seuil ; même refus pour une adresse inconnue ; codes TOTP faux limités à 10 par verrouillage ; bon code refusé pendant le verrouillage ; reprise normale après le délai |
| `api/__tests__/logs.int.test.ts`, `config/__tests__/logger.test.ts` | Erreur SQL avec un nom de patient, violation d'unicité, JSON invalide, parcours complet au niveau `debug` : aucune valeur saisie dans les journaux ; le code PostgreSQL et le SQL sans valeurs restent |
| `modules/audit/__tests__/audit-log.int.test.ts` | Droits, jours locaux (minuit à Paris), filtres, pagination exacte à horodatage identique (avec et sans filtre d'élément), ordre total dans la requête SQL, libellés et lien patient d'un vrai parcours, isolation, requêtes invalides |
| `modules/audit/__tests__/audit-log-performance.int.test.ts` | 400 000 entrées par cabinet : 4 à 7 ms par page quel que soit le filtre, 96 ms pour 20 pages ; plan d'exécution sans tri |
| `jobs/__tests__/retention.int.test.ts` | Durées de la politique SQL = `SECURITY_POLICY` ; `DELETE` sans condition du rôle applicatif : seules les sessions terminées depuis 30 jours ; purge par cabinet, brouillons de plus de 24 h seulement ; journal sans donnée ; planification et exécution réelles par pg-boss |
| `lib/__tests__/error-reporter.test.ts`, `api/__tests__/error-reporting.int.test.ts` | Événement par liste blanche ; envoi réel à un serveur d'ingestion local (format, authentification, contenu) ; 4xx jamais remontés, 500 oui ; échec d'une tâche remonté ; Sentry injoignable sans effet sur la requête |
| `api/__tests__/session-cookie.test.ts` | Cookie de production : `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, sans `Domain` ; un cookie sans préfixe est ignoré |
| `config/__tests__/env.test.ts` | DSN facultatif, HTTPS exigé en staging et production, jamais la clé dans l'erreur |
| `pages/audit/audit.test.tsx`, `packages/shared/src/audit.test.ts` | Page, filtres, historique, pages suivantes, rôles sans accès, mise en forme ; contrat de la requête et catalogue |

### Campagne de failles volontaires

24 failles injectées une à une (script hors dépôt), avec restauration du code après chaque exécution.

| Faille | Détectée par |
|---|---|
| P1 authentification après l'analyse du corps | matrice (401 avant lecture du corps) |
| P2 route sans politique acceptée | matrice (démarrage) |
| P3 jeton CSRF non comparé | matrice (CSRF) |
| P4 permission de route ignorée | matrice (16 routes répondent 400 au lieu de 403, aucune 2xx) |
| P5 `authorize` retiré du service du journal | test du service |
| A1 tentatives non sérialisées | tentatives simultanées |
| A2 code faux non compté pour le compte | codes TOTP répétés |
| A3 compteur remis à zéro par le mot de passe | codes TOTP répétés |
| A4 code évalué pendant le verrouillage | codes TOTP répétés |
| L1 sérialiseur retiré | journaux (3 tests) |
| L2 `detail` PostgreSQL journalisé | journaux, liste blanche |
| J1 catalogue ouvert | audit |
| J2 tri sans départage par identifiant | **non détectée au premier passage** : voir ci-dessous |
| J3 curseur inclusif | pagination |
| J4 période en jours UTC | jours locaux |
| J5 index en `NULLS LAST` | plan d'exécution |
| R1 politique de suppression sans durée | conservation, RLS des sessions |
| R2 brouillons non purgés | conservation |
| I1 lignes d'import d'un lot inconnu | fuite entre cabinets |
| E1 4xx remontés à Sentry | **non détectée au premier passage** : voir ci-dessous |
| E2 requête ajoutée à l'événement Sentry | liste blanche, bout en bout |
| H1 en-têtes de sécurité retirés | API |
| W1 lien « Journal » pour tous | menus, page |
| W2 heure du navigateur | page |

- **Premier passage : 22 sur 24.**
- **J2.** Avec les index actuels, PostgreSQL rend déjà les ex æquo dans l'ordre des identifiants : la pagination restait juste par hasard.
  - Ajouté : pagination filtrée sur un élément, et contrôle de la clause `ORDER BY` réellement envoyée.
- **E1.** Le test n'envoyait que des 401 et 404, qui ne passent pas par la branche modifiée.
  - Ajouté : 400 (JSON invalide) et 413 (corps trop volumineux).
- **Second passage : 24 sur 24.**

### Parcours réels dans Chromium

Base PostgreSQL locale recréée (19 migrations), API et interface de développement. Navigateur réglé à New York pour vérifier le fuseau du cabinet (Paris). Résultats comparés à des requêtes SQL indépendantes (superutilisateur, sans RLS).

| Parcours | Résultat |
|---|---|
| Secrétaire : fiche patient créée puis modifiée 55 fois ; pas de lien « Journal » ; page refusée ; API 403 | Conforme |
| Deux connexions refusées sur le compte du dentiste ; dentiste (tablette) : pas de lien, page refusée, API 403 | Conforme |
| Administrateur : période par défaut (7 jours), 50 entrées ; heure de la plus récente = PostgreSQL dans le fuseau de Paris | Conforme |
| Pages suivantes jusqu'à la fin : 74 entrées affichées = 74 en base ; API au curseur : 74 identifiants distincts | Conforme |
| Filtre utilisateur (secrétaire) : 50 affichées sur 58 en base, toutes de la secrétaire ; filtre action « connexion refusée » : 2 = 2 en base | Conforme |
| Historique de la fiche : uniquement « Durand Léa », sans le contenu saisi ; lien vers la fiche patient | Conforme |
| Période invalide : message, aucune requête ; tablette et téléphone : aucun défilement horizontal | Conforme |
| En-têtes de l'API vus par le navigateur : CSP, HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy` | Présents |
| Journal réel de l'API après le parcours (388 lignes) : ni nom, ni téléphone, ni note | Conforme |

Captures : journal sur ordinateur, historique d'un élément, tablette, téléphone.

## Défauts trouvés et corrigés pendant la phase

- **Dans l'application** : constats F1 à F9 de l'ADR 0011, chacun reproduit par un test avant correction.
- **Test de fuite entre cabinets aveugle (dans le test lui-même).**
  - L'empreinte de B était lue par le rôle propriétaire sans contexte. La RLS étant forcée pour lui aussi, elle ne voyait aucune ligne : l'empreinte était constante.
  - Détecté parce qu'une modification de B entre deux mesures ne changeait rien.
  - Corrigé : lecture dans le contexte de B, contrôle que l'empreinte voit les données, mutation vérifiée.
  - Les autres lectures du rôle propriétaire dans les tests portent sur `pg_stat_activity` et `pg_locks`, non concernées.
- **Script Chromium** : une lecture de la liste avant le rendu du filtre donnait un faux échec. Le script attend désormais la réponse du serveur ; le filtre était correct.
- **Ancien test** « le rôle applicatif ne peut pas supprimer de session » : remplacé par la nouvelle garantie. Aucune session active ou récente n'est supprimable, même par un `DELETE` sans condition, et le test vérifie qu'il existe des sessions à protéger.

## MCP utilisés

| Service | Usage | Valeur |
|---|---|---|
| GitHub | État de la CI | Nécessaire |
| Sentry | Lecture seule : organisation `adam-oc` (région UE), aucun projet | A orienté le choix : intégration prête mais désactivée. L'accès réseau à `*.sentry.io` est refusé par l'environnement, aucun projet créé |
| Railway | Documentation seulement ; aucune action sur le projet | Contraintes PostgreSQL et sauvegardes identifiées pour la Phase 11 |
| Supabase, Stripe | Absents de l'environnement | Non concernés (consignes : ne pas remplacer l'architecture ; Stripe réservé à la facturation future du SaaS) |
| Resend | Non utilisé | Aucune fonction d'e-mail dans cette phase |

## Écarts par rapport au plan

- Aucune procédure d'effacement d'un patient : elle dépend d'un avis juridique (obligation de conservation du dossier médical). Consignée comme question ouverte.
- Remontée Sentry non vérifiée contre le vrai service (réseau). À faire en recette.

## Ce qui doit absolument être fait avant la production

1. Choisir l'hébergement : certification HDS si le cabinet est en France, restauration à un instant donné, sauvegardes testées.
2. Faire valider les durées de conservation par un juriste : journal d'audit, patients inactifs, paiements, sessions (30 jours proposés). Définir la procédure d'effacement.
3. Servir l'interface avec ses en-têtes de sécurité (CSP, HSTS, `frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`) et les vérifier automatiquement.
4. Créer un projet Sentry de staging, puis vérifier la réception d'une erreur provoquée et son contenu (aucune donnée saisie).
5. Régler `API_TRUST_PROXY_HOPS` selon l'architecture réseau réelle ; une seule instance d'API tant que le limiteur de débit est en mémoire.
6. Mettre les secrets (`DATA_ENCRYPTION_KEY`, mots de passe des rôles, DSN) dans le gestionnaire de l'hébergeur ; sauvegarder la clé de chiffrement hors de la base.
7. Surveiller `auth.account_locked` : une série de verrouillages signale une attaque.
8. Faire un test d'intrusion externe sur l'environnement de staging (hors périmètre de cette revue).

## Questions ouvertes

1. Pays des premiers cabinets clients (hébergement, conservation) : inchangée.
2. Durée de conservation du journal d'audit : à fixer avec un juriste.
