# Phase 11 — Audit de sécurité pré-production (gate bloquant) : rapport

- **Date :** 2026-09-28.
- **Demande :** appliquer la checklist de sécurité pré-production du porteur du projet (20 contrôles et 4 contrôles propres à la Phase 11). Au préalable, livrer le correctif d'idempotence des rendez-vous recommandé à la fin de la Phase 10.
- **Verdict :** **MISE EN PRODUCTION BLOQUÉE** (section 8).

Un contrôle n'est déclaré conforme qu'avec une preuve exécutée. Les preuves des Phases 9 et 10 sont réutilisées quand le code concerné n'a pas changé. Les tests correspondants ont été réexécutés dans cet audit.

## Mise à jour du 2026-09-30 : préparation du staging, sans hébergement

Le porteur du projet a décidé de rester à 0 € : aucun hébergement payant, aucune suppression de projet. Le staging est préparé et vérifié sur une pile locale et en CI, mais jamais déployé (détail : [phase-11-staging.md](phase-11-staging.md)).

Statut « BLOQUÉ » : **NON VÉRIFIÉ — BLOQUÉ PAR ABSENCE D'HÉBERGEMENT GRATUIT DISPONIBLE**.

| # | Contrôle | Statut au 2026-09-28 | Statut au 2026-09-30 | Nouvelle preuve | Reste à faire sur l'hébergement |
|---|---|---|---|---|---|
| 1 | Secrets | PARTIEL | PARTIEL ; BLOQUÉ pour la partie hébergement | Secrets éphémères de la CI masqués et absents des journaux des conteneurs ; `.dockerignore` sans `.env` ; secrets Railway prévus en variables partagées scellées (`.railway/railway.ts`) | Secrets staging distincts de la production, dans le gestionnaire de Railway |
| 3 | Limitation de l'authentification | PARTIEL | PARTIEL ; BLOQUÉ | Pile locale derrière deux proxys : `X-Forwarded-For` et `X-Real-IP` usurpés sans effet ; deux postes distingués ; faille volontaire (proxy qui n'écrase pas `X-Real-IP`) détectée | `check:deployment --rate-limit --expect-ip` derrière le proxy de Railway |
| 4 | Isolation et RLS | PARTIEL | PARTIEL ; BLOQUÉ | `check-database` après chaque migration : un déploiement sur une base non conforme échoue | Journal de `migrate` sur le PostgreSQL de Railway ; suite d'intégration sur une base jetable de l'hébergeur |
| 8 | HTTPS | NON VÉRIFIÉ | BLOQUÉ | Pile locale : TLS 1.3, redirection 308, HSTS ; en CI avec les images de production | `check:deployment` sur le domaine réel |
| 9 | Sessions | PARTIEL | PARTIEL ; BLOQUÉ | Cookie `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax` servi au travers de Caddy en `APP_ENV=staging` ; déconnexion effective | Navigateur sur le domaine réel (expiration, changement d'utilisateur ou de cabinet, révocation) |
| 13 | CORS | PARTIEL | PARTIEL ; BLOQUÉ | Aucune autorisation pour une origine étrangère au travers des deux proxys | Proxy réel |
| 15 | Journaux | PARTIEL | PARTIEL ; BLOQUÉ ; Sentry NON VÉRIFIÉ | Caddy sans journal d'accès (recherches de patients) ; `terse` contrôlé à chaque déploiement ; journaux des conteneurs contrôlés en CI | Journaux de l'hébergeur ; Sentry (projet et secret GitHub à créer par le porteur du projet) |
| 16 | Messages d'authentification | PARTIEL (risque accepté) | inchangé | — | — |
| 19 | E-mails et invitations | PARTIEL | inchangé | — | — |
| 20 | Sauvegardes | NON VÉRIFIÉ | BLOQUÉ | Procédure et exercice écrits (`docs/operations/sauvegarde-restauration.md`) ; mécanismes de Railway documentés (sauvegardes du volume, restauration à un instant donné sur environ 4 semaines) | Exercice complet, RPO et RTO mesurés |
| P11 | En-têtes HTTP | NON VÉRIFIÉ | BLOQUÉ | En-têtes servis par le Caddy de production, générés depuis la source unique ; failles volontaires détectées | Domaine réel |
| P11 | Sentry | NON VÉRIFIÉ | NON VÉRIFIÉ | `sentry-check` dans l'image ; job CI à la demande | Projet `dental-staging`, secret GitHub, événement inspecté |
| P11 | `DATA_ENCRYPTION_KEY` | PARTIEL | PARTIEL ; BLOQUÉ | Procédure Railway (variable partagée scellée, copie au coffre, empreinte) | Coffre réel, exercice de restauration avec la clé du coffre |

**Défaut découvert et corrigé :** les noms en caractères arabes (ou tifinagh) étaient réduits à un texte vide par la normalisation. Conséquences : patient introuvable par son nom, faux homonymes, clés d'import confondues. Tests unitaire, d'intégration et de bout en bout ajoutés.

**Verdict inchangé : MISE EN PRODUCTION BLOQUÉE.** État du projet : prêt à être déployé, déploiement externe en attente de budget.

## 0. Environnement constaté

| Élément | Constat (2026-09-28) | Conséquence |
|---|---|---|
| Staging | **N'existe pas.** Le seul projet Railway accessible (`clever-blessing`, lecture par le MCP Railway) contient un service sans rapport, `tradingview-mcp`. Aucun hébergeur choisi (question HDS ouverte) | Aucune vérification « sur le staging réel » n'est possible |
| Réseau de cet environnement | Le proxy refuse toute sortie vers `*.railway.app`, `railway.com`, `sentry.io`, `*.ingest.de.sentry.io` (HTTP 403), et même `google.com` | Même un staging existant ne serait pas joignable d'ici. Les protections réseau n'ont pas été contournées |
| Sentry | Organisation `adam-oc` (région UE), **aucun projet** (MCP Sentry, lecture seule) | Test réel impossible |
| Données | Uniquement synthétiques (noms sentinelles des parcours, volume généré) | — |

Pour que les contrôles dépendant de l'hébergement deviennent exécutables dès qu'un staging existera, cet audit livre une commande de vérification : `pnpm --filter @dental/e2e check:deployment` (section 4). Elle est exercée en CI sur la pile locale.

## 1. Matrice des contrôles

Statuts possibles :
- CONFORME AVEC PREUVE ;
- PARTIEL ;
- ABSENT ;
- NON APPLICABLE AVEC JUSTIFICATION ;
- NON VÉRIFIÉ.

« Bloque » : bloque ou non la production tant que le point reste ouvert.

| # | Contrôle | Statut | Preuve | Fichiers / tests | Vérification staging | Limite | Bloque |
|---|---|---|---|---|---|---|---|
| 1 | Secrets et clés API | PARTIEL | gitleaks : index, arborescence, historique complet (21 commits), bundle de production : aucun secret. Seul constat de l'arborescence : `.env` local, ignoré par Git et jamais versionné (`git log --all -- .env` vide). Bundle : aucune valeur secrète de l'environnement ni motif de clé. Journaux : aucun secret (clé, mots de passe des rôles, cookie, en-tête d'authentification), vérifié à chaque exécution E2E | `.gitleaks.toml`, job CI gitleaks, `apps/web/scripts/check-secrets.mjs` (CI), `e2e/support/global-teardown.ts` | NON VÉRIFIÉ : secrets staging et production distincts, gestionnaire de secrets de l'hébergeur | Aucun environnement hébergé | Oui |
| 2 | Fichiers sensibles | CONFORME AVEC PREUVE | `.gitignore` : `.env*` (sauf `.env.example`), clés et certificats (`*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.crt`, `id_rsa*`, `*.kdbx`), sauvegardes (`*.dump`, `*.backup`, `*.bak`, `*.sql.gz`), `.data/`, `tmp/`, artefacts de test. Aucun fichier suivi concerné (`git ls-files -ci`). gitleaks sur l'index, le dépôt et l'historique : rien. Aucune clé n'a jamais été exposée : aucune révocation nécessaire | `.gitignore`, CI | — | `.env.example` contient des mots de passe de développement factices (`dev-…-change-me`), explicitement locaux | Non |
| 3 | Limitation des tentatives d'authentification | PARTIEL | Par adresse IP : connexion, code TOTP, mot de passe, et désormais création de compte et réinitialisation, à 10 par minute. Par compte : 10 échecs (mots de passe et codes) puis 15 minutes, tentatives simultanées sérialisées. Derrière un proxy : limite par client réel, `X-Forwarded-For` usurpé sans effet (nouveau test) ; `API_TRUST_PROXY_HOPS` obligatoire en staging et production (nouveau) | `auth-api.int.test.ts`, `auth-attempts.int.test.ts`, `env.test.ts` | NON VÉRIFIÉ : comportement derrière le proxy réel (`check:deployment --rate-limit`) | Limiteur **en mémoire** : une seule instance d'API. Pas de récupération de compte en libre-service, pas d'e-mail (voir 19) | Oui (vérification réelle) |
| 4 | Isolation multi-cabinet et RLS | PARTIEL | RLS activée et forcée avec politique sur toutes les tables. Rôles `dental_app` et `dental_owner` : ni superutilisateur, ni `BYPASSRLS` (nouveau test pour le propriétaire). Clés composites `(clinic_id, x_id)`. Toutes les routes appelées par un autre cabinet avec les identifiants du premier : 404, empreinte SQL inchangée. Tâches de fond cabinet par cabinet (`withTenant`). Clé d'idempotence propre à chaque cabinet (nouveau test) ; restauration : isolation intacte (E2E) | `schema-catalog.int.test.ts`, `cross-clinic.int.test.ts`, tests RLS par domaine, `03-roles-isolation`, `05-finance`, `10-backup-restore` | NON VÉRIFIÉ : mêmes tests sur le PostgreSQL déployé | Exports : n'existent pas encore (backlog) | Oui (vérification réelle) |
| 5 | Mots de passe | CONFORME AVEC PREUVE | Argon2id `m=19456, t=2, p=1` (OWASP), sel aléatoire par empreinte (`$argon2id$v=19$…`), seule l'empreinte est stockée, comparaison par la bibliothèque. 12 caractères au moins, différent de l'e-mail et de l'ancien. Changement : mot de passe actuel exigé, autres sessions fermées. **Nouveau :** un mot de passe temporaire expire après 72 heures (refus explicite, sans compter un essai) | `password.test.ts`, `auth.int.test.ts`, `users.int.test.ts` | — | Pas de second système d'authentification introduit (consigne) | Non |
| 6 | Autorisations serveur | CONFORME AVEC PREUVE | Matrice de **toutes** les routes enregistrées (74, plus les HEAD automatiques) : politique d'accès obligatoire, 401 avant lecture du corps, CSRF, 403 par rôle, étapes d'authentification. Accès aux ressources d'un autre cabinet : 404. Aucune nouvelle route dans cet audit | `security-matrix.int.test.ts`, `cross-clinic.int.test.ts`, `03-roles-isolation` (API appelée en contournant l'interface) | — | — | Non |
| 7 | Clés côté client | CONFORME AVEC PREUVE | L'interface ne lit aucune variable d'environnement. Bundle de production : gitleaks, plus recherche des valeurs secrètes de l'environnement (7 valeurs en local, les mots de passe en CI) et de motifs (URL PostgreSQL, clé privée, clé Stripe secrète, `service_role`, DSN Sentry). Faille volontaire (mot de passe injecté dans le build) détectée | `apps/web/scripts/check-secrets.mjs` (`pnpm check:bundle`, CI) | — | Aucun DSN Sentry côté navigateur (Sentry côté serveur seulement) | Non |
| 8 | HTTPS en production | NON VÉRIFIÉ | Code : `WEB_ORIGIN` HTTPS obligatoire, cookies `Secure` et `__Host-` en staging et production (test), HSTS sur l'API et dans les en-têtes de l'interface. **Pourquoi non vérifié :** aucun environnement hébergé, réseau sortant bloqué | `env.test.ts`, `session-cookie.test.ts`, `e2e/support/deployment-checks.ts` | À faire : `check:deployment --url https://…` (redirection HTTP vers HTTPS, TLS ≥ 1.2, certificat valide, cookies) | Redirection et TLS relèvent du proxy, encore à configurer | **Oui** |
| 9 | Sessions | PARTIEL | Inactivité 60 min, durée absolue 12 h, déconnexion, révocation, changement de mot de passe ou de rôle (sessions fermées), changement de cabinet (nouvelle session), session expirée (retour à la connexion). Conservation 30 jours configurable (`SESSION_RETENTION_DAYS`), purge nocturne. Cookie `HttpOnly`, `SameSite=Lax`, `Secure` et `__Host-` hors local ; jeton CSRF et contrôle de l'origine | `auth.int.test.ts`, `users.int.test.ts`, `retention.int.test.ts`, `session-cookie.test.ts`, `02-auth`, `check:deployment` (cookie, déconnexion) sur la pile locale | NON VÉRIFIÉ : attributs du cookie servis par l'hébergement réel | — | Oui (vérification réelle) |
| 10 | Validation des entrées | CONFORME AVEC PREUVE | Zod sur corps, chaîne de requête et paramètres de chaque route. **Nouveau :** entrées hostiles envoyées à toutes les routes par deux rôles : identifiants malformés, injection, chemins, octet nul, 300 caractères, corps de mauvais type, pollution de prototype, dates, montants, chaîne de requête incohérente. Résultat : jamais de 500, aucun détail technique, prototype intact. Requêtes SQL paramétrées : aucun `sql.raw`. Les seules requêtes construites sont celles du bootstrap d'administration (identifiants échappés, nom validé par expression régulière) | `security-matrix.int.test.ts` (faille volontaire : validation UUID retirée, détectée), tests des contrats | — | — | Non |
| 11 | Limites des imports | CONFORME AVEC PREUVE | Aucun fichier n'est envoyé au serveur (aucune route multipart), seulement des lignes JSON. Limites vérifiées par le serveur (nouveau test) : 20 000 lignes annoncées, 500 par envoi, pas plus que le nombre annoncé, longueur de chaque champ, 3 téléphones, corps de 5 Mo au plus pour les lignes (413 au-delà) et 1 Mo pour le reste | `patients-api.int.test.ts` | — | — | Non |
| 12 | Vérification des fichiers | CONFORME AVEC PREUVE | Le fichier est lu dans le navigateur ; le serveur ne l'exécute ni ne l'écrit : aucun chemin, aucune exécution possible côté serveur. Liste blanche `.csv`, `.txt`, `.xlsx`, 10 Mo au plus. **Nouveau :** contenu réel vérifié avant analyse (signature ZIP pour `.xlsx`, conteneur OLE `.xls` refusé, octets nuls refusés pour un CSV), sans se fier à l'extension ni au type annoncé. Fichier malformé : message clair | `import.test.ts` (5 cas), `06-patients-import` (XLSX réel) | — | Un classeur piégé (bombe de décompression) n'affecterait que l'onglet du navigateur de l'utilisateur | Non |
| 13 | CORS | PARTIEL | Aucun module CORS : l'API n'émet aucun en-tête `Access-Control-Allow-*`. Pré-vol et GET depuis une origine étrangère : aucune autorisation, jamais `*` avec credentials (outil exécuté sur la pile locale). Requêtes modifiantes : origine et jeton CSRF vérifiés | `security-matrix.int.test.ts` (CSRF), `00-stack` (`check:deployment` local) | NON VÉRIFIÉ : réponse du proxy réel | Un proxy mal configuré pourrait ajouter des en-têtes CORS | Oui (vérification réelle) |
| 14 | Erreurs en production | CONFORME AVEC PREUVE | Format d'erreur unique : code, message fonctionnel, `requestId`. Jamais de pile, de SQL ou de chemin : le gestionnaire ne dépend pas de l'environnement. Entrées hostiles sur toutes les routes : aucun détail renvoyé. 500 générique, détails dans les journaux par liste blanche | `error-handler.ts`, `security-matrix.int.test.ts`, `error-reporting.int.test.ts`, `logs.int.test.ts` | Pages d'erreur du proxy (502, 504) : à contrôler avec `check:deployment` | — | Non |
| 15 | Journaux | PARTIEL | API et worker : aucune donnée saisie ni secret (contrôle final de chaque exécution E2E). Journal d'audit et file de tâches : aucune donnée saisie ni motif libre (102 288 lignes contrôlées). **Constat et correction :** le journal du serveur PostgreSQL citait les valeurs en conflit (`DETAIL: Key (email)=(…) already exists`) ; `log_error_verbosity = terse` est désormais posé par le bootstrap, vérifié par un test et par une violation réelle provoquée (ligne `DETAIL` disparue). Événements de sécurité conservés (connexions refusées, verrouillages, expiration d'un mot de passe temporaire) | `global-teardown.ts`, `schema-catalog.int.test.ts`, `logs.int.test.ts`, `bootstrap.ts` | NON VÉRIFIÉ : Sentry (événement réel), réglage PostgreSQL chez l'hébergeur (le bootstrap avertit s'il est refusé), chaîne de journaux de l'hébergeur | Sur un PostgreSQL géré sans droit superutilisateur, le réglage se fait dans la configuration de l'hébergeur | Oui (Sentry, réglage réel) |
| 16 | Messages d'authentification | PARTIEL | Connexion : même message et même durée pour une adresse inconnue ou un mauvais mot de passe (empreinte factice), même refus pendant le verrouillage, 429 identique pour une tentative simultanée. Expiration d'un mot de passe temporaire révélée seulement après le bon mot de passe. Aucune récupération en libre-service | `auth-attempts.int.test.ts`, `auth.int.test.ts`, `02-auth` | — | **Résiduel :** un administrateur peut savoir si une adresse existe déjà sur la plateforme (création de compte : 409, e-mail unique). Atténué par la nouvelle limite (10 par minute). La vraie correction suppose des invitations par e-mail, non construites (consigne) | Non (risque accepté à documenter) |
| 17 | Webhooks | NON APPLICABLE AVEC JUSTIFICATION | Inventaire des routes : 5 routes publiques seulement (santé ×4, connexion), aucun webhook | `security-matrix.int.test.ts` (inventaire) | — | À vérifier si la Phase 11 en introduit | Non |
| 18 | Dépendances | CONFORME AVEC PREUVE | `pnpm audit` (production et développement) : aucune vulnérabilité. Installation au lockfile figé (`--frozen-lockfile`, vérifiée hors ligne). `pnpm outdated` : seules des dépendances de développement ont des versions plus récentes (Playwright figé sur le Chromium de l'environnement, TypeScript 7, types) ; aucune mise à jour majeure à l'aveugle | Job CI « Audit des dépendances » | — | — | Non |
| 19 | E-mails et invitations | PARTIEL | Aucun e-mail n'est envoyé (pas de Resend) : confirmation, changement d'adresse et renvoi d'e-mail sont non applicables. Invitation = compte créé par l'administrateur, avec un mot de passe temporaire affiché une fois : **expiration à 72 h (nouveau)**, changement obligatoire au premier usage, double authentification pour administrateur et dentiste | `auth.int.test.ts`, `users.int.test.ts` | — | Non-énumération : voir 16 | Non |
| 20 | Sauvegardes | NON VÉRIFIÉ | Localement : `pg_dump`, puis restauration dans une base neuve ; lignes, RLS, politiques, droits, propriétaires, migrations comparés (CI, à chaque exécution). **Pourquoi non vérifié :** aucun hébergement, donc ni sauvegarde réelle, ni emplacement, fréquence, rétention, chiffrement, copie hors site, restauration à un instant donné | `10-backup-restore` | À faire sur le staging (checklist de la Phase 10, étape 9) | Une sauvegarde non restaurée sur l'hébergement réel est non validée | **Oui** |

### Contrôles propres à la Phase 11

| Contrôle | Statut | Preuve | Limite | Bloque |
|---|---|---|---|---|
| En-têtes HTTP (CSP, HSTS, `frame-ancestors`, Referrer-Policy, Permissions-Policy, X-Content-Type-Options) | NON VÉRIFIÉ sur staging | **Nouveau :** en-têtes de l'interface définis à un seul endroit (`apps/web/security-headers.ts`) et servis par la pile E2E. CSP stricte : ni `unsafe-inline`, ni `unsafe-eval`, `frame-ancestors 'none'`. Chaque page principale de chaque rôle, en trois formats d'écran, est ouverte sous cette CSP : **aucune violation**. Un défaut réel a été trouvé et corrigé : Zod testait `new Function` à chaque chargement. En-têtes de l'API (helmet) vérifiés | Le proxy de production doit reprendre ces en-têtes à l'identique : `check:deployment` les compare | Oui |
| Sentry (projet de staging, erreur contrôlée, contenu inspecté) | NON VÉRIFIÉ | Organisation sans projet ; réseau refusé (403). Commande `sentry:check` prête, vérifiée contre un serveur d'ingestion local (marqueur absent de tout l'envoi) | Visibilité des pannes en production | Oui |
| `DATA_ENCRYPTION_KEY` | PARTIEL | Hors de Git (gitleaks, `.env` ignoré). Variable secrète, taille vérifiée au démarrage. Absente des journaux (contrôle final). **Simulation (nouveau, E2E) :** la sauvegarde `pg_dump` ne contient pas la clé ; une note médicale d'une base restaurée se déchiffre avec la clé conservée à part, et une autre clé échoue (chiffrement authentifié). Procédure écrite : `docs/operations/cle-de-chiffrement.md` | Coffre réel, second exemplaire et exercice sur l'hébergement non vérifiés ; **aucune rotation de clé outillée** (risque) | Oui (coffre et exercice réels) |
| Idempotence des rendez-vous | CONFORME AVEC PREUVE | Double clic (une seule requête), double requête simultanée (une seule ligne, 200 et 201), réponse perdue puis nouvel essai (« Rendez-vous enregistré. », une ligne), même clé avec une autre demande (409), nouvelle clé légitime (contrôlée normalement), clé propre à chaque cabinet. 5 failles volontaires détectées | — | Non |

## 2. Corrections réalisées

| # | Constat | Gravité | Correction | Test de non-régression |
|---|---|---|---|---|
| 1 | Réponse perdue lors de la prise de rendez-vous : nouvel essai refusé avec un message trompeur | Moyenne (risque de doublon par erreur humaine) | Clé d'idempotence (ADR 0007, section 11, migration 0019) | Service, HTTP, interface, E2E ; 5 mutations |
| 2 | **Journal du serveur PostgreSQL avec valeurs en conflit** (e-mail, téléphone, numéro de dossier) | Moyenne (données personnelles dans des journaux d'exploitation) | `log_error_verbosity = terse` posé par le bootstrap, avertissement si l'hébergeur le refuse | `schema-catalog.int.test.ts` ; vérification réelle sur le journal local ; mutation |
| 3 | **Mots de passe temporaires sans expiration** | Moyenne (identifiant transmis hors application, valable indéfiniment) | Expiration à 72 h (`TEMPORARY_PASSWORD_HOURS`), refus explicite après le bon mot de passe seulement, sans compter un essai ; durée affichée à l'administrateur et par `create-admin` | `auth.int.test.ts` ; 2 mutations |
| 4 | **Énumération d'adresses entre cabinets** par la création de compte (409), sans limite | Faible (compte administrateur requis) | Même limite que la connexion sur la création de compte et la réinitialisation | `auth-api.int.test.ts` ; mutation ; risque résiduel documenté |
| 5 | `API_TRUST_PROXY_HOPS` à 0 par défaut, même en production | Moyenne en production (tous les postes derrière une seule IP : limitation globale, journal faux) | Obligatoire en staging et production (démarrage refusé sinon) | `env.test.ts`, test proxy dans `auth-api.int.test.ts` ; 2 mutations |
| 6 | En-têtes de sécurité de l'interface non définis | Moyenne | Jeu d'en-têtes unique, CSP stricte, vérifiés sur toutes les pages | `00-stack`, `08-responsive-a11y`, `check:deployment` ; mutation |
| 7 | **Zod tentait `new Function`** dans le navigateur (violation de CSP à chaque chargement) | Faible (fonctionnel), bloquant pour une CSP stricte | Zod sans évaluation de code dans l'interface (alias vers `src/lib/zod.ts`) | Parcours sous CSP (aucune violation) |
| 8 | Contenu des fichiers importés non vérifié (extension seule) | Faible (lecture dans le navigateur) | Signatures ZIP et OLE, octets nuls | `import.test.ts` ; 2 mutations |
| 9 | Aucun contrôle automatique des secrets dans le build de l'interface | Prévention | `check-secrets.mjs` dans `check:bundle` | Faille volontaire détectée |
| 10 | Contrôle final E2E limité aux données saisies | Prévention | Ajout des secrets (clé, mots de passe des rôles) et des jetons (cookie, en-têtes) | Faille volontaire détectée |
| 11 | Pas d'outil pour les vérifications sur un hébergement | Prévention | `e2e/support/deployment-checks.ts` et `check:deployment` (9 contrôles), exercés en CI sur la pile locale | `00-stack` ; mutation |
| 12 | Fichiers `ignore` : certificats, sauvegardes `.backup` / `.bak`, clés SSH, `tmp/` non couverts | Prévention | `.gitignore` complété ; `e2e/artifacts` exclu du lint | `git ls-files -ci` vide |
| 13 | **Contrôle d'un encaissement quadratique sans statistiques** (trouvé par la CI) : le déclencheur `payments_guard` somme les paiements du montant dû, et sur une table jamais analysée le planificateur passait par l'index (cabinet, date), donc lisait tous les paiements du cabinet à chaque ligne. En CI, 10 000 paiements insérés en une requête ont dépassé le `statement_timeout` de 15 s | Faible en production (un paiement par requête, statistiques tenues par l'autovacuum) ; bloquant pour la CI | Index (cabinet, montant dû) à la place de l'index sur le seul montant dû (migration 0020) : 5,6 s → 0,49 s pour 10 320 paiements en local | `schema-catalog.int.test.ts` (plan générique de la requête du déclencheur) ; mutation sans l'index détectée |
| 14 | Test de bout en bout « réponse perdue » instable (trouvé par la CI) : après le second clic, l'alerte du premier envoi reste affichée jusqu'au rendu suivant (TanStack Query le diffère par `setTimeout(0)`) ; le test la lisait comme l'issue du second envoi | Test seulement ; aucun défaut de l'application | Le test attend la réponse du second envoi (et vérifie qu'elle est un rejeu, 200) avant de lire l'écran | Échec de la CI reproduit en local en retardant les minuteries de la page : ancienne version en échec (même erreur), nouvelle version verte |

## 3. Tests exécutés (résultats réels, 2026-09-28)

| Commande | Résultat |
|---|---|
| `pnpm format:check && pnpm lint && pnpm typecheck` | Sans erreur |
| `pnpm test` | shared 80, serveur 410, web 135 : tous verts |
| `pnpm build && pnpm check:bundle` | 146,6 ko compressés (budget 160) ; secrets du build : 34 fichiers, 7 valeurs et 5 motifs cherchés, rien trouvé |
| `pnpm --filter @dental/server db:generate` | Aucune dérive (migrations 0019 et 0020 incluses) |
| Parcours de bout en bout (`pnpm e2e`) | **55 sur 55** en 4 min 48 s (après les corrections 13 et 14) ; contrôle final : 102 262 lignes (audit, tâches) et journaux sans donnée saisie ni secret |
| `pnpm audit` et `pnpm audit --prod` | Aucune vulnérabilité connue |
| gitleaks : historique complet, arborescence, bundle, index | Aucun secret versionné (seul le `.env` local, non suivi, apparaît dans l'arborescence) |
| Failles volontaires | 15 sur 15 au niveau unitaire et intégration (script hors dépôt, validation UUID retirée comprise) ; 3 au niveau bout en bout et outils, toutes détectées : en-têtes de l'interface retirés (parcours et `check:deployment`), secret et cookie injectés dans un journal (contrôle final), secret injecté dans le build (`check-secrets`) |
| Journal PostgreSQL réel | Violation d'unicité provoquée : `DETAIL` avec la valeur sans le réglage, aucune ligne `DETAIL` avec `terse` |
| CI GitHub | Premier passage (commit `40875a6`) : **deux échecs**, un par job de tests. Causes établies et corrigées (corrections 13 et 14), chacune reproduite en local avant correction. Passage suivant : voir le résumé de fin de phase |

## 4. Vérifications staging

**Aucune n'a pu être faite : aucun staging n'existe, et ce réseau ne peut pas en joindre un.**

Commande prête, à lancer depuis un poste qui atteint le staging, avec un compte de test synthétique (secrétaire, sans double authentification) :

```bash
CHECK_PASSWORD='…' pnpm --filter @dental/e2e check:deployment \
  --url https://staging.<domaine> --email secretaire-test@<domaine> --rate-limit
```

| Contrôle de l'outil | Ce qu'il prouve |
|---|---|
| HTTPS, redirection HTTP → HTTPS, TLS | 301/308 vers `https://`, TLS 1.2 ou 1.3, certificat valide plus de 14 jours |
| En-têtes de l'interface | Les 7 en-têtes de `security-headers.ts`, CSP identique, HSTS ≥ 180 jours |
| En-têtes de l'API | CSP, HSTS, `nosniff`, `X-Frame-Options`, Referrer-Policy ; 401 au format standard |
| CORS | Aucune autorisation pour une origine étrangère (pré-vol et GET), jamais `*` avec credentials |
| Erreurs | 400 et 404 au format standard, sans pile, SQL ni chemin |
| Cookie de session | `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, sans `Domain` ; déconnexion effective |
| Limitation derrière le proxy | 429 atteint malgré un `X-Forwarded-For` usurpé à chaque essai |

Restent hors de l'outil :
- Sentry : `sentry:check`, puis lecture de l'événement avec le MCP Sentry (`search_events`) ;
- sauvegarde et restauration réelles ;
- tests RLS et isolation sur le PostgreSQL déployé : suite d'intégration avec `TEST_DATABASE_ADMIN_URL` pointant sur une base de staging jetable.

## 5. Éléments non vérifiés et impact

| Élément | Pourquoi | Ce qu'il faut faire | Risque | Bloque |
|---|---|---|---|---|
| HTTPS, TLS, redirection (8) | Pas d'hébergement ; réseau bloqué | Choisir l'hébergeur, déployer le staging, `check:deployment` | Session ou données en clair | Oui |
| En-têtes réels de l'interface et de l'API | Idem | Configurer le proxy à partir de `security-headers.ts`, `check:deployment` | Clickjacking, injection de scripts moins contenue | Oui |
| CORS et erreurs du proxy (13, 14) | Idem | `check:deployment` | Proxy qui ajouterait des en-têtes CORS permissifs ou des pages d'erreur bavardes | Oui |
| Cookies réels (9) | Idem | `check:deployment --email …` | Cookie sans `Secure` si `APP_ENV` est mal réglé (le code l'empêche en staging et production) | Oui |
| Limitation derrière le proxy réel (3) | Idem | `check:deployment --rate-limit` ; une seule instance d'API | Contournement du verrouillage par usurpation d'IP si le réglage est faux | Oui |
| Secrets distincts staging/production (1) | Aucun environnement | Deux jeux de secrets dans le gestionnaire de l'hébergeur ; comparer les empreintes | Une fuite du staging ouvrirait la production | Oui |
| RLS et rôles sur le PostgreSQL déployé (4) | Idem | Suite d'intégration sur une base de staging jetable, bootstrap par la commande de production | Service géré qui accorderait des droits différents (par exemple `BYPASSRLS`) | Oui |
| Journal PostgreSQL de l'hébergeur (15) | Idem | Vérifier l'avertissement du bootstrap, régler `log_error_verbosity=terse` sinon | Données personnelles dans les journaux de l'hébergeur | Oui |
| Sentry (15) | Aucun projet ; réseau bloqué | Créer `dental-staging` (UE), `sentry:check` depuis le staging, inspecter l'événement | Pannes invisibles, ou données envoyées par erreur | Oui |
| Sauvegardes (20) | Aucun hébergement | Sauvegarde, emplacement, modification volontaire de données synthétiques, restauration, comparaison (données, migrations, RLS, rôles, droits) ; fréquence, rétention, chiffrement, accès, copie hors site, restauration à un instant donné | Perte de données | Oui |
| Clé de chiffrement dans un vrai coffre | Aucun hébergement | Procédure `docs/operations/cle-de-chiffrement.md` sur le staging | Perte définitive des notes médicales | Oui |

## 6. Risques résiduels (après correction)

| Risque | Gravité estimée | Parade |
|---|---|---|
| Énumération d'adresses entre cabinets par un administrateur (création de compte) | Faible | Limite de 10 par minute ; à terme, invitations par e-mail avec acceptation |
| Aucune rotation outillée de `DATA_ENCRYPTION_KEY` (format à une seule clé) | Moyenne en cas de fuite | Commande de rechiffrement et identifiant de clé, à prévoir avant un premier incident |
| Limiteur de débit en mémoire | Moyenne si plusieurs instances | Une instance ; stockage partagé avant toute mise à l'échelle horizontale |
| Mot de passe temporaire réutilisable pendant 72 h tant qu'il n'est pas changé | Faible (chaque usage impose le changement) | Délai court ; réinitialisation par l'administrateur |
| Contrôles d'accessibilité et de CSP faits dans Chromium seulement | Moyenne (iPad Safari) | Recette sur appareils réels |
| Aucun test d'intrusion externe, aucun DAST | Inconnue | Test d'intrusion sur le staging avant la production |
| Administrateur malveillant ou rôle propriétaire de la base | Hors modèle | Séparation des accès à la base, journal d'audit en ajout seul pour l'application |

## 7. Décisions juridiques restant à prendre

1. **Pays des premiers cabinets** et, pour la France, **hébergeur certifié HDS** : conditionne le choix de l'hébergement, donc toutes les vérifications non faites.
2. **Durées de conservation :**
   - journal d'audit ;
   - patients inactifs ;
   - paiements (durée comptable) ;
   - journaux applicatifs ;
   - sessions terminées (30 jours au MVP, configurable).
3. **Procédure d'effacement** d'un patient (en conflit avec la conservation du dossier médical).
4. **Contrat de sous-traitance** avec les cabinets, **registre des traitements**, **analyse d'impact (AIPD)** pour des données de santé.
5. **Sous-traitants ultérieurs :** hébergeur, Sentry (localisation UE, contenu déjà réduit par liste blanche).

## 8. Verdict

**MISE EN PRODUCTION BLOQUÉE**

Raisons :
- Les contrôles 8 (HTTPS) et 20 (sauvegardes) sont **non vérifiés**.
- Les contrôles propres à la Phase 11 (en-têtes sur le staging, Sentry, clé de chiffrement dans un vrai coffre) sont **non vérifiés**.
- Plusieurs contrôles restent **partiels** faute d'environnement hébergé : 1, 3, 4, 9, 13, 15.

Aucun de ces points ne peut être levé depuis cet environnement : il n'existe pas de staging, et le réseau est bloqué.

Tout ce qui dépendait du code a été corrigé et testé. Pour lever le blocage :
- choisir l'hébergeur ;
- créer le staging ;
- lancer `check:deployment`, `sentry:check`, l'exercice de sauvegarde et restauration, et la suite d'intégration sur le PostgreSQL déployé ;
- revenir à cette matrice.

Même une fois la matrice satisfaite, le produit ne sera ni « sécurisé à 100 % », ni certifié, ni juridiquement conforme : cette checklist est un minimum de sécurité pré-production.
