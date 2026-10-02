# ADR 0011 — Journal d'audit consultable et revue de sécurité

- Statut : accepté (2026-09-27), Phase 9
- **Demande du porteur du projet :**
  - journal d'audit consultable selon les permissions, filtré par date, utilisateur, type d'action et élément ;
  - aucune donnée sensible inutile dans les journaux ;
  - revue de sécurité complète, avec tests négatifs d'autorisation, tests de fuite entre cabinets, tests de concurrence, tests réels dans Chromium et campagne de failles volontaires ;
  - documenter ce qui a été vérifié, comment, et ce qui reste hors périmètre, sans jamais conclure « sécurisé à 100 % ».
- **Fondations :**
  - isolation par RLS (ADR 0001) ;
  - authentification (ADR 0003) ;
  - journal d'audit en ajout seul, écrit dans la transaction métier (Phase 1) ;
  - permissions (`packages/shared/src/permissions.ts`).

## 1. Périmètre et méthode

La revue part du code et d'une base PostgreSQL réelle, pas de la documentation. Chaque risque identifié est d'abord reproduit par un test qui échoue, puis corrigé. Une campagne de failles volontaires vérifie ensuite que les tests détectent la régression.

| Domaine | Vérification | Moyen |
|---|---|---|
| Permissions serveur | Chaque route enregistrée : politique d'accès déclarée ; 403 pour chaque rôle sans la permission | Inventaire des routes par Fastify (`routeInventory`), matrice `security-matrix.int.test.ts` : 74 routes (plus 29 HEAD automatiques), 3 rôles |
| Sessions et étapes | 401 sans session sur toute route non publique ; 403 pendant une étape (mot de passe, double authentification) ; cookie `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax` | Même matrice ; `session-cookie.test.ts` ; tests existants d'expiration (Phase 2) |
| CSRF | Toute route modifiante (45) : jeton de session et origine exigés | Même matrice (jeton absent, jeton faux, origine étrangère) |
| Isolation entre cabinets | L'administrateur du cabinet A appelle toutes les routes avec les identifiants des données du cabinet B | `cross-clinic.int.test.ts` : aucune réponse ne contient une donnée de B, empreinte SQL de toutes les tables de B identique avant et après |
| RLS | Toute table : RLS activée, forcée, politique ; rôle applicatif sans privilège | `schema-catalog.int.test.ts`, tests RLS par domaine (Phases 1 à 8) |
| Limitation de débit | Connexion, code et mot de passe : 10 par minute et par adresse IP ; 300 pour le reste | Test existant ; limiteur en mémoire (une instance) |
| Tentatives d'authentification | Verrouillage face à des tentatives simultanées ; codes TOTP faux répétés | `auth-attempts.int.test.ts` |
| En-têtes | API : CSP, HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy` | Test existant ; vérifiés dans Chromium à travers le proxy |
| Journaux applicatifs | Aucune valeur saisie : erreurs SQL, violations de contrainte, JSON invalide, parcours complet au niveau `debug` | `logs.int.test.ts`, `logger.test.ts` ; journal réel de l'API après le parcours Chromium |
| Remontée des erreurs | Contenu exact de ce qui partirait vers Sentry | `error-reporter.test.ts`, `error-reporting.int.test.ts` (serveur d'ingestion local) |
| Secrets | Aucun secret dans le dépôt ni l'historique ; aucune valeur dans les erreurs de configuration | gitleaks (index et historique complet) ; `env.test.ts` |
| Chiffrement | Notes médicales et secrets TOTP chiffrés (AES-256-GCM, contexte lié à la ligne) | Tests existants (Phases 2 et 3) |
| Dépendances | Vulnérabilités connues, production et développement | `pnpm audit` |
| Conservation | Sessions terminées et brouillons d'import supprimés | `retention.int.test.ts` |

## 2. Constats et corrections

| # | Constat | Gravité | Preuve avant correction | Correction |
|---|---|---|---|---|
| F1 | **Verrouillage contourné par des tentatives simultanées** : toutes les requêtes lisaient le compteur avant qu'un échec soit enregistré | Élevée | 16 mots de passe faux en parallèle : 16 évalués, compte non verrouillé | Section 4 |
| F2 | **Codes TOTP en nombre illimité pour qui connaît le mot de passe** : 5 essais par session, et un mot de passe correct remettait le compteur du compte à zéro | Élevée | 40 codes faux en 8 sessions, sans verrouillage | Section 4 |
| F3 | **Données patient dans les journaux d'erreur** : drizzle recopie les paramètres SQL dans son message et dans `params` ; PostgreSQL cite la valeur fautive ; le `detail` d'une contrainte contient la clé | Moyenne | Un nom de patient apparaît 4 fois dans une seule erreur journalisée | Section 5 |
| F4 | Authentification vérifiée après l'analyse du corps de la requête | Faible | Requête non authentifiée à corps invalide : 400 au lieu de 401 | Contrôle d'accès en `preParsing` (après la limitation de débit, avant la lecture du corps) |
| F5 | Une route sans politique d'accès était ouverte à tout compte connecté (défense en profondeur : les services vérifient aussi) | Faible | Constat de lecture | Politique obligatoire sur toute route (`public`, `authenticated`, `allow`, `permission` ou `anyPermission`) ; démarrage refusé sinon |
| F6 | Lignes d'un import inconnu ou d'un autre cabinet : liste vide au lieu de 404 (aucune fuite, RLS) | Faible | Test de fuite entre cabinets | 404 comme les autres routes |
| F7 | Index du journal inutilisable : drizzle crée `DESC NULLS LAST`, alors que `ORDER BY … DESC` signifie `NULLS FIRST` ; PostgreSQL lisait toute la période puis triait | Performance | 280 ms par page sur 400 000 entrées, 56 000 lignes lues pour une page | Migration 0017 : index `(clinic_id, created_at DESC NULLS FIRST, id DESC NULLS FIRST)` ; 7 ms par page ; plan vérifié par test |
| F8 | Sessions jamais supprimées ; brouillons d'import supprimés seulement au prochain import du cabinet | Conservation | Constat de lecture (prévu en Phase 9) | Tâche nocturne, section 6 |
| F9 | esbuild ≤ 0.24 (GHSA-67mh-4wv8-2f99), dépendance de développement de drizzle-kit | Faible (outil de développement, serveur d'esbuild inutilisé) | `pnpm audit` | Version corrigée imposée (`pnpm-workspace.yaml`) ; drizzle-kit vérifié |

Deux autres index ont le même défaut d'ordre : les imports d'un cabinet et les notes d'un patient. L'effet est négligeable (quelques lignes par cabinet ou par patient). Ils sont laissés en l'état et consignés.

Observation sans faille : sans le contrôle de permission de la route, 16 routes répondent 400 au lieu de 403, car la route valide le corps avant d'appeler le service. Aucune ne répond 2xx. Les services gardent leur `authorize`, et le contrôle de route passe désormais avant toute lecture du corps.

## 3. Journal d'audit consultable

- **Catalogue fermé.**
  - `AUDIT_ACTIONS` et `AUDIT_ENTITY_TYPES` (`packages/shared/src/audit.ts`) listent les 47 actions et les 10 types d'élément.
  - `recordAudit` refuse toute autre valeur, et le typage l'impose déjà à la compilation.
  - Chaque entrée a donc un libellé français (`audit-labels.ts`). Le typage exige un libellé par action.
  - Les libellés ne sont chargés qu'avec la page « Journal ».
- **Lecture : `GET /api/audit-logs`, permission `audit.read` (administrateur).**
  - Filtres :
    - période en jours locaux du cabinet (`local-time.ts`), une année au plus ;
    - auteur ;
    - action ;
    - type d'élément et élément précis.
  - Tri : du plus récent au plus ancien, départagé par identifiant. C'est un ordre total, même pour des entrées écrites dans la même transaction.
  - Pages de 50 entrées (100 au plus). Le curseur est l'identifiant de la dernière entrée reçue ; la base en retrouve l'horodatage exact, à la microseconde, sans perte d'arrondi.
  - Un curseur inconnu ou d'un autre cabinet ne renvoie rien.
- **`GET /api/audit-logs/actors`.** Comptes du cabinet, actifs ou non, pour le filtre.
- **Contenu.**
  - L'élément est nommé selon les permissions du lecteur : nom du patient seulement avec `patient.read`, nom de fichier d'import seulement avec `data.import`.
  - Un rendez-vous, un acte ou un paiement renvoie vers la fiche de son patient.
  - Les modifications sont décrites par les noms de champs et des valeurs non saisies (statut, montant, horaire, rôle). Jamais un contenu libre : notes, motifs, libellés.
  - L'adresse IP est affichée : c'est une donnée utile à une enquête de sécurité.
- **La consultation du journal n'est pas elle-même tracée.** Le journal ne contient aucune donnée médicale, et l'administrateur a déjà accès à tout le cabinet. À revoir si un rôle d'auditeur externe est créé.
- **Performance.** 400 000 entrées par cabinet, deux cabinets :
  - 4 à 7 ms par page, pour tous les filtres, sur une année ;
  - 96 ms pour 20 pages successives ;
  - lecture dans l'ordre de l'index, vérifiée par le plan d'exécution.

## 4. Tentatives d'authentification

- **Sérialisation par adresse e-mail.**
  - Une tentative (mot de passe ou code) prend `pg_try_advisory_xact_lock` sur l'adresse, dans la transaction qui lit le compteur, vérifie le mot de passe et enregistre l'échec.
  - Une tentative simultanée sur la même adresse est refusée immédiatement (429), sans être évaluée.
  - Le verrou est pris même pour une adresse inconnue, et la vérification factice du mot de passe se fait sous le verrou. Ni la durée de réponse ni un refus pour tentative simultanée ne révèlent l'existence du compte.
  - Contrepartie : pendant la vérification Argon2 (quelques dizaines de millisecondes), la connexion à la base reste occupée.
- **Codes TOTP faux comptés pour le compte**, en plus de la session.
  - Le compteur est le même que celui des mots de passe : 10 échecs, puis 15 minutes de verrouillage.
  - Il ne repart à zéro qu'après une authentification complète : mot de passe seul pour un compte sans second facteur, sinon mot de passe et code.
  - Pendant le verrouillage, aucun code n'est évalué, même sur une session déjà ouverte.
- **Effet mesuré.**
  - Parallèle : au plus 10 évaluations par période de verrouillage.
  - Codes : au plus 10 essais par période de 15 minutes, au lieu d'un nombre illimité.

## 5. Journaux applicatifs et remontée des erreurs

- **Sérialiseur d'erreurs par liste blanche** (`config/logger.ts`, clés `err` et `error`).
  - Conservés :
    - type ;
    - message sans les valeurs citées (guillemets, adresses e-mail) ;
    - code ;
    - contrainte, table, colonne, gravité PostgreSQL ;
    - pile, sans son message brut ;
    - causes chaînées, 3 niveaux au plus.
  - Pour une erreur drizzle, le message devient `Failed query: <SQL>` : le SQL ne contient que des marqueurs `$1`.
  - `detail`, `where`, `hint`, `params` et toute autre propriété sont écartés.
- **Remontée vers Sentry sans SDK** (`lib/error-reporter.ts`).
  - L'événement est construit à partir de l'erreur déjà nettoyée. Seuls partent :
    - le type, le message et la pile ;
    - le code d'erreur ;
    - l'environnement (`APP_ENV` : development, staging, production) ;
    - la version (`SENTRY_RELEASE`) ;
    - le service (api ou worker) ;
    - l'identifiant de requête (aléatoire).
  - Aucune requête HTTP, aucun en-tête, cookie, corps, utilisateur, fil d'Ariane ni variable locale.
  - Seules les erreurs imprévues sont remontées : 500, échec d'une tâche, erreur de la file, exception non rattrapée. Les refus attendus (4xx) ne le sont pas.
  - La remontée est désactivée sans `SENTRY_DSN`. HTTPS est obligatoire en staging et production.
  - Envoi en 3 s au plus, abandonné si Sentry est indisponible. Pause sur 429.
  - Format : « envelope » Sentry (`POST /api/<projet>/envelope/`, en-tête `X-Sentry-Auth`).
- **Pourquoi pas le SDK officiel.**
  - `@sentry/node` 11 ajoute OpenTelemetry et une quarantaine de dépendances pour des fonctions inutiles ici (traces, instrumentation).
  - `@sentry/core` 11 ne fournit pas de client serveur.
  - Un émetteur minimal n'envoie par construction que ce qu'il construit. Il ne dépend pas d'un nettoyage a posteriori.
- **Limite de la vérification.**
  - Le format et le contenu sont vérifiés contre un serveur d'ingestion local.
  - L'environnement de développement refuse l'accès réseau à `*.sentry.io` (refus du proxy, vérifié en Phase 9 puis de nouveau en Phase 10). L'acceptation par le vrai Sentry **reste à vérifier en Phase 11**, avec un projet de staging. Le proxy n'a pas été contourné.
  - L'organisation Sentry du porteur du projet n'a aucun projet. Aucun n'a été créé, faute de pouvoir l'utiliser depuis cet environnement.
  - Commande prête : `APP_ENV=staging SENTRY_DSN=… pnpm --filter @dental/server sentry:check`.
    - Elle refuse tout autre environnement que staging et exige un DSN en HTTPS, lu dans l'environnement.
    - Elle envoie une erreur contrôlée dont les champs écartés (paramètres SQL, `detail`, cookie, en-tête d'autorisation, corps) portent une sentinelle fictive.
    - Elle affiche la réponse de Sentry, l'identifiant de l'événement et le corps exact envoyé.
    - La procédure de vérification est dans le rapport de la Phase 10.

## 6. Conservation des données

- **Tâche nocturne** (`jobs/retention.ts`, pg-boss, 3 h 17 UTC). Pour chaque cabinet, dans son propre contexte (`withTenant`), elle supprime :
  - les sessions terminées depuis plus de 30 jours (révoquées, expirées ou inactives). Adresse IP et navigateur sont des données personnelles ;
  - les brouillons d'import de plus de 24 h (lignes brutes). Le lot est marqué abandonné.
- **Droits minimaux** (migration 0018).
  - `app.maintenance_clinic_ids()` ne renvoie que les identifiants des cabinets. La table `clinics` reste invisible hors contexte.
  - Une politique réservée au rôle propriétaire permet cette fonction : la RLS est forcée, y compris pour le propriétaire.
  - Le rôle applicatif ne peut supprimer que des sessions de son cabinet terminées depuis plus de 30 jours. La règle est dans la politique RLS (horloge de la base) : même un `DELETE` sans condition ne supprime pas une session récente.
  - Les durées de la politique et de `SECURITY_POLICY` sont comparées par un test.
- **Le journal n'enregistre que des compteurs.**
- **Durée des sessions terminées : politique configurable** (validée le 2026-09-27 pour le MVP : 30 jours).
  - `SESSION_RETENTION_DAYS` (worker), 30 par défaut, de 30 à 3 650 jours. Une valeur hors de ces bornes empêche le démarrage.
  - 30 jours est aussi le plancher inscrit dans la politique RLS : allonger la durée ne demande qu'un changement de configuration ; la raccourcir demande une nouvelle migration (et le test qui compare la politique à `SECURITY_POLICY`).
  - La valeur définitive dépend de l'avis juridique (journaux de connexion : durée souvent recommandée entre 6 mois et 1 an). Elle pourra évoluer sans changer le code.

## 7. Préparation du déploiement (sans déploiement)

- **Railway** (documentation consultée, aucune action sur le projet `clever-blessing`).
  - La base PostgreSQL est l'image officielle, non gérée, avec un superutilisateur. Le bootstrap (rôles `dental_owner`, `dental_app`) et les extensions `btree_gist` et `pg_trgm` sont possibles.
  - Pas de restauration à un instant donné dans ce modèle (sauvegardes de volume). L'architecture la prévoit : à trancher en Phase 11.
  - Question de l'hébergement certifié HDS pour la France : toujours ouverte (ARCHITECTURE, section L).
- **En-têtes de l'interface web.**
  - L'API envoie ses en-têtes (helmet). Les fichiers de l'interface seront servis par l'hébergeur ou Caddy (Phase 11).
  - Ils devront porter au minimum : CSP (`default-src 'self'`, `frame-ancestors 'none'`), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
  - Rien n'est vérifiable avant le choix de l'hébergement.
  - Mise à jour du 2026-09-28 (audit pré-production) : ces en-têtes sont désormais définis dans `apps/web/security-headers.ts`, servis par la pile de bout en bout et vérifiés sur toutes les pages (aucune violation de la CSP). Il reste à les poser sur l'hébergement réel et à le vérifier avec `check:deployment`.
- **Autres points à régler en Phase 11.**
  - Le limiteur de débit est en mémoire (une seule instance d'API).
  - `API_TRUST_PROXY_HOPS` doit correspondre au nombre réel de proxys, sinon l'adresse IP (limitation, journal) est fausse.
  - Les secrets vont dans le gestionnaire de variables de l'hébergeur, jamais dans le dépôt.

## 8. Risques résiduels

| Risque | Gravité estimée | Pourquoi il reste | Parade prévue |
|---|---|---|---|
| Message d'erreur tiers contenant une donnée non citée entre guillemets | Faible | Le nettoyage retire les valeurs citées et les adresses e-mail, pas un texte libre arbitraire | Surveillance des erreurs en recette ; message tronqué à 500 caractères |
| Fonctionnement réel de la remontée vers Sentry non vérifié | Moyenne (visibilité des pannes) | Réseau bloqué | Recette avec un DSN de staging (erreur provoquée, événement lu) |
| Limiteur de débit en mémoire | Moyenne si plusieurs instances | Une instance au MVP | Stockage partagé avant toute mise à l'échelle |
| Attaque distribuée sur un compte connu | Faible | 10 essais par 15 minutes et par compte ; verrouillage exploitable pour bloquer un compte (déni de service ciblé) | Alerte sur `auth.account_locked` en production |
| Absence de restauration à un instant donné sur Railway | Élevée pour la disponibilité des données | Choix d'hébergement non fait | Phase 11 : service géré avec PITR ou sauvegardes externalisées testées |
| En-têtes de l'interface web | Moyenne | Hébergement des fichiers non choisi | Phase 11, vérification automatisée des en-têtes |
| Durées de conservation du journal d'audit, des patients inactifs, des paiements | Juridique | Dépendent du pays et d'un avis juridique | Question ouverte (ARCHITECTURE, sections G.2 et L) |
| Administrateur malveillant | Hors modèle | L'administrateur a tous les droits de son cabinet ; le journal est en ajout seul pour l'application mais modifiable par le rôle propriétaire | Séparation des accès à la base en production |

## 9. Hors périmètre (non vérifié)

- Test d'intrusion externe, analyse dynamique (DAST), fuzzing des entrées.
- Revue du code des dépendances au-delà des vulnérabilités publiées.
- Configuration réelle de l'hébergement : TLS, pare-feu, sauvegardes, supervision.
- Conformité RGPD et HDS, durées légales de conservation, procédure d'effacement d'un patient. Celle-ci entre en conflit avec l'obligation de conserver le dossier médical, et exige un avis juridique.
- Tests de charge (Phase 10), sauf les mesures de performance du journal et du tableau de bord.
- Sécurité du poste des utilisateurs et du navigateur (extensions, vol de session sur un poste compromis).

## 10. Options écartées

| Option | Raison |
|---|---|
| SDK `@sentry/node` avec nettoyage `beforeSend` | Dépendances lourdes ; nettoyage a posteriori d'un événement riche par défaut, plus fragile qu'une construction par liste blanche |
| Supabase (authentification, base) | Aucune raison technique : PostgreSQL, RLS, migrations et pg-boss restent la référence (consigne du porteur du projet) |
| Variable de contexte « maintenance » ouvrant la RLS | N'importe quel code du rôle applicatif pourrait la positionner |
| Purge des sessions à la connexion suivante du cabinet | Un cabinet inactif garderait indéfiniment ses données |
| Verrou de ligne `FOR UPDATE NOWAIT` sur le compte | Révélerait l'existence du compte (refus seulement pour une adresse connue) |
| Tracer chaque consultation du journal | Aucune donnée médicale dans le journal ; volume sans valeur d'enquête au MVP |
