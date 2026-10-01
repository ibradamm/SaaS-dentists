# Phase 11 — Préparation du staging, sans hébergement : rapport

- **Date :** 2026-09-30. Point de départ : commit `391db02` (rapport d'audit validé, verdict « mise en production bloquée »).
- **Demande :** passer à un vrai staging, puis lever les contrôles NON VÉRIFIÉS.
- **Décision du porteur du projet en cours d'étape :**
  - 0 € : aucun coût, aucun service payant, aucune suppression de projet sans son accord ;
  - tout préparer, marquer ce qui dépend d'un hébergement comme **NON VÉRIFIÉ — BLOQUÉ PAR ABSENCE D'HÉBERGEMENT GRATUIT DISPONIBLE** ;
  - premiers cabinets au **Maroc**.
- **État :** **projet prêt à être déployé, déploiement externe en attente de budget.** Aucune production, aucun staging hébergé.

## 1. Inventaire des outils (vérifié par appel, pas supposé)

| Outil | Type | Accessible | Constat | Utile ici |
|---|---|---|---|---|
| Railway | MCP (connecteur) | Oui | Compte `ibradamm`, espace personnel, projets `clever-blessing` et `tokens-max-mcp`. **Création de projet refusée** : « Free plan resource provision limit exceeded ». Documentation lisible | Documentation, préparation. Aucune ressource créée |
| Sentry | MCP | Oui | Organisation `adam-oc` (région UE), 0 projet. Création de projet et de DSN possible ; offre de l'organisation invisible | Non utilisé pour créer : coût non vérifiable, et un envoi réel demande un secret GitHub à ajouter par le porteur du projet |
| GitHub | MCP | Oui | Compte `ibradamm`, dépôt public, CI, journaux des jobs | CI, preuves |
| Resend | MCP | Oui | Aucun domaine | Aucun e-mail dans le produit : non utilisé |
| Supabase | Connecteur | **Non** | Installé, connexion incomplète | — |
| Stripe | — | **Non** | Aucun outil installé | Hors périmètre de toute façon |
| OmniRoute | MCP | Répond (santé, v3.8.50) | **0 fournisseur, 0 combinaison, 0 modèle** : aucun routage possible | Non |
| Ponytail | MCP | Oui | Règles « full » | Garde-fou contre le sur-développement, revue du diff |
| Agent Skills | MCP | Oui | 25 méthodes (addyosmani/agent-skills) | Méthode : livraison, CI, plan, ADR, revue |
| Graphify | MCP | Oui | Aucun graphe au départ ; dépôt indexé (2 352 nœuds, commit `391db02`) | Analyse d'impact avant les changements d'en-têtes, de cookies et de configuration |
| Clerk, Gmail, Drive, etc. | Connecteurs | Oui | Sans rapport ; Clerk écarté (aucun second système d'authentification) | Non |
| Poste de développement | Local | — | Node 22.22.2, pnpm 10.33, PostgreSQL 16, Docker (client sans démon) ; ni CLI Railway ni `gh`. **Réseau** : Railway, Sentry, Resend, Render et Neon refusés par le proxy ; GitHub, npm et Docker Hub autorisés | Construction, tests, pile locale |
| Hooks, greffons | Claude Code | — | Un hook d'arrêt (modifications non commitées) ; aucun greffon activé | — |

## 2. Ce qui est prêt

| Élément | Fichiers |
|---|---|
| Images de production : serveur (API, worker, bootstrap, migrations, contrôle de la base, commandes d'administration, test Sentry) et interface (Caddy) | `infra/docker/*.Dockerfile`, `.dockerignore` |
| Proxy de l'interface : en-têtes générés depuis la source unique, `/api` relayé, adresse du client sûre, cache correct après déploiement, aucun journal d'accès | `infra/caddy/`, `apps/web/scripts/caddy-headers.mjs` |
| Staging Railway en Infrastructure as Code (services, région UE, une seule API, secrets scellés, attente de la CI) | `.railway/railway.ts` |
| Contrôle des invariants de la base à chaque déploiement (RLS, rôles, journal `terse`) | `apps/server/src/db/check-database.ts` |
| Pile staging locale : mêmes images, proxy de périmètre simulé, `APP_ENV=staging` ; exécutée par la CI | `infra/staging-local/` |
| Outils de vérification d'un hébergement : `check:deployment` (10 contrôles), `staging:accounts`, `staging:timings` | `e2e/scripts/`, `e2e/support/` |
| Test Sentry réel à la demande (secret GitHub) et depuis le conteneur (`node dist/sentry-check.js`) | `.github/workflows/ci.yml`, build |
| Procédures | `docs/operations/deploiement-staging.md`, `sauvegarde-restauration.md`, `cle-de-chiffrement.md`, ADR 0013 |

## 3. Ce qui a été vérifié (résultats réels)

| Vérification | Résultat |
|---|---|
| Pile staging locale, **en local** : API et worker compilés en `APP_ENV=staging`, Caddy de production, proxy de périmètre en TLS 1.3, cabinet marocain créé par les commandes de production | `check:deployment` : **10 OK, aucun IGNORÉ** |
| Failles volontaires sur la pile locale | Toutes détectées : proxy qui n'écrase pas `X-Real-IP` (limitation contournée), redirection HTTP absente, en-tête `Permissions-Policy` retiré, cookies non sécurisés (`APP_ENV=test`), journal PostgreSQL non `terse` (`check-database`) |
| Deux postes derrière le même proxy | Poste A bloqué (429) après 10 essais ; poste B, même proxy et `X-Real-IP` usurpé, non bloqué |
| Adresse du client dans le journal d'audit | Celle du poste, jamais celle d'un proxy |
| Images Docker construites et lancées **en CI** | Premier passage (`253a94f`) : attente sans l'autorité de test (défaut du script). Deuxième (`1ba8218`) : job vert **à tort** — `check:deployment` avait échoué (adresse attendue vide), code masqué par `\| tee`. Corrigé dans `d321c97` ; résultat en section 9 |
| `check-database` sur la base staging locale | « Base conforme » ; test d'intégration (base conforme, table sans RLS signalée) |
| `.railway/railway.ts` | Typage contre le SDK officiel `railway` 3.12.0 ; lint. **Jamais planifié ni appliqué** (aucun projet Railway) |
| Cabinet marocain | Création `Africa/Casablanca`, `fr-MA`, `MAD`, `MA` acceptée ; changements d'heure du ramadan 2026 testés (15 février et 22 mars) ; **retour du Maroc à GMT (UTC+0) le 20 septembre 2026** testé (données de fuseau 2026c, Node 22.23.3, voir « Heure légale marocaine » ci-dessous) ; montants en dirhams à deux décimales ; numéros +212 déjà couverts |
| **Noms en arabe (défaut découvert et corrigé)** | Un nom en caractères arabes ou tifinagh était réduit à un texte vide par la normalisation : patient introuvable par son nom, faux homonymes entre tous les patients arabophones, clé d'identité de l'import réduite à la date de naissance. Corrigé : lettres de tous les alphabets conservées, voyelles brèves, hamza et tatwil ignorées. Tests unitaire, d'intégration et de bout en bout, tous en échec sur l'ancien code |
| Temps de réponse à travers les deux proxys (pile locale, base presque vide) | Médianes de 7 à 22 ms selon la page. Charge depuis un seul poste : limitée à 300 requêtes par minute, le reste en 429 (voir risques) |

### Corrections issues des revues (Ponytail, revue de sécurité du diff)

| Constat | Correction |
|---|---|
| Contrôle « adresse du client » : connexion, double authentification et lecture du journal codées à la main | Client HTTP de session partagé (`e2e/support/http-session.ts`), 18 lignes de moins |
| Caddy compressait aussi les réponses de l'API (jeton CSRF) | Compression limitée aux fichiers de l'interface |
| `staging:accounts` : droits 600 posés seulement à la création du fichier | `chmod` explicite |
| Procédure : l'API ne démarre pas tant que le domaine public n'existe pas (`WEB_ORIGIN`) | Redéploiement de l'API après `railway domain`, écrit dans la procédure |
| Test d'intégration de l'import instable (ordre des contacts sans `ORDER BY`, échec observé une fois sous charge) | Ordre explicite, celui du service |

### Heure légale marocaine et heures ambiguës (défauts découverts le 2026-10-01)

Découverts par la CI de la PR #1, rouge depuis `d321c97` à l'étape des tests ; je ne lisais que les runs « push », verts.

| Constat | Correction | Preuve |
|---|---|---|
| **Le Maroc est revenu à GMT (UTC+0) le 20 septembre 2026** ([IANA](https://lists.iana.org/hyperkitty/list/tz@iana.org/message/OICICWYCOLRJSRJWO5O2SU3AADR5GAUJ/), données de fuseau 2026c). L'image de production (Node 22.22.2, données 2025c) le croyait encore à UTC+1 : chaque heure saisie par un cabinet marocain aurait été décalée d'une heure | Node 22.23.3 (données 2026c) épinglé partout : `.nvmrc` (CI), images Docker (empreinte de l'index). Le test Casablanca vérifie l'heure légale actuelle : il échoue avec des données de fuseau antérieures à 2026c | Test en échec sous Node 22.22.2, vert sous 22.23.3 |
| `.nvmrc` valait `22` : chaque runner prenait une version différente (22.23.2 ou 22.23.3), donc des données de fuseau différentes | Version exacte, identique à celle des images | Échec reproduit en local avec Node 22.23.3 (somme SHA-256 vérifiée) |
| **Heure ambiguë résolue selon la date du calcul.** Luxon choisit l'occurrence d'après le décalage du fuseau au moment présent : à Paris, « 25 octobre 2026, 2 h 30 » donnait 00:30Z si on le calculait en été, 01:30Z en hiver. Le test de Paris serait devenu rouge le 25 octobre | Première occurrence choisie explicitement (`local-time.ts`, `getPossibleOffsets`) | Nouveau test (calcul « en janvier » et « en juillet »), en échec sur l'ancien code |

### Résultats de la vérification complète (2026-10-01)

| Commande | Résultat |
|---|---|
| `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm check:bundle` | shared 80, serveur 414, web 135 : tous verts ; 146,6 ko compressés ; aucun secret dans le build |
| `pnpm --filter @dental/server db:generate` | Aucune dérive |
| `pnpm audit`, `pnpm audit --prod` | Aucune vulnérabilité connue |
| Parcours de bout en bout | **56 sur 56** en 5,0 min ; contrôle final : 102 050 lignes, aucune donnée saisie |

## 4. Ce qui reste NON VÉRIFIÉ

**NON VÉRIFIÉ — BLOQUÉ PAR ABSENCE D'HÉBERGEMENT GRATUIT DISPONIBLE :**
1. HTTPS, TLS et redirection du vrai proxy de l'hébergeur ; en-têtes servis par l'hébergement.
2. Comportement du proxy de Railway : écrasement de `X-Real-IP`, adresses sources (`CADDY_TRUSTED_PROXIES`), limitation derrière lui.
3. Cookies et sessions sur le domaine réel, dans un navigateur.
4. CORS et pages d'erreur du proxy réel.
5. PostgreSQL de l'hébergeur : suite d'intégration, RLS, rôles, journal `terse` (le contrôle s'exécutera au premier déploiement).
6. Journaux de l'hébergeur (API, PostgreSQL).
7. Sauvegardes, restauration à un instant donné, restauration réelle, RPO et RTO mesurés.
8. `DATA_ENCRYPTION_KEY` dans le gestionnaire de secrets de l'hébergeur et dans le coffre de l'équipe ; secrets de staging distincts de ceux de production.
9. Parcours de bout en bout et performances sur l'infrastructure hébergée.

**NON VÉRIFIÉ, pour une autre raison :**
- **Sentry réel.** Il faut un projet `dental-staging` et un secret GitHub `SENTRY_DSN_STAGING`, deux actions du porteur du projet. Aucun hébergement n'est nécessaire.

## 5. Procédure pour déployer plus tard

[`docs/operations/deploiement-staging.md`](../operations/deploiement-staging.md), en résumé :
1. Passer en Hobby et fixer une limite de dépense.
2. Créer le projet `dental-saas` avec un environnement `staging`.
3. Créer les secrets scellés : clé de chiffrement copiée au coffre, empreinte notée.
4. `railway config plan`, puis `railway config apply`, puis `railway domain`.
5. Activer les sauvegardes et la restauration à un instant donné.
6. Déployer `migrate` (« Base conforme »), puis API, worker et interface.
7. Créer le cabinet de test par `railway ssh`, puis `staging:accounts`.
8. `check:deployment`, avec `--expect-ip`.

## 6. Coût minimal estimé

Pour un staging Railway en Hobby : **environ 5 à 7 $ par mois** (confiance moyenne), dont 5 $ d'abonnement qui incluent 5 $ d'usage. Détail : procédure, section 2. Pour la production, une offre Pro (20 $ par mois, dont 20 $ d'usage) donnerait davantage de ressources et le travail en équipe. À chiffrer avec les volumes réels.

## 7. Alternatives réellement gratuites

Sources : résultats de recherche (les pages officielles sont bloquées par le proxy de cet environnement), donc **confiance moyenne**, à confirmer sur les sites.

| Option | Coût, carte | Compatibilité | Compromis |
|---|---|---|---|
| Railway, offre gratuite | 0 € | Non | Limite atteinte ; il faudrait supprimer un projet (interdit) ; 0,5 Go de RAM par service |
| Render, offre gratuite | 0 € | Partielle | Service endormi après 15 min ; **PostgreSQL supprimé après 30 jours** ; pas de worker gratuit, donc tâches de fond arrêtées ; pas de sauvegarde |
| Koyeb, offre Hobby | 0 €, sans carte | Faible | **Un seul service**, donc fusion interface + API + worker (changement d'architecture) ; base limitée en heures actives et à 1 Go |
| Northflank Sandbox | 0 €, **carte exigée** | Bonne (2 services, 2 bases) | Carte bancaire ; 3 services nécessaires |
| **Neon Free** (base seule) | 0 €, sans carte | Bonne pour PostgreSQL | 0,5 Go ; restauration à un instant donné sur 6 h. Permet, depuis GitHub Actions : suite d'intégration sur un PostgreSQL géré, `check-database` (qui ferait apparaître le cas « `terse` refusé ») et un vrai exercice de restauration. Ce n'est pas l'hébergeur final |
| Pile locale en CI (déjà en place) | 0 € | Totale | Aucun proxy d'hébergeur réel, aucune sauvegarde gérée |

**Recommandation** (confiance moyenne). Aucune option gratuite ne remplace un vrai staging Railway sans changer d'architecture ni exiger de carte. La seule qui apporte une preuve nouvelle sans compromis d'architecture est **Neon Free pour les contrôles PostgreSQL et la restauration à un instant donné**. Il faudrait :
- un compte, créé par le porteur du projet ;
- un secret GitHub ;
- un job CI de plus.

À décider par le porteur du projet.

## 8. À exécuter dès qu'un staging existe

Dans l'ordre (détail et critères : procédure, section 7) :
1. Journal de `migrate` : « Base conforme ».
2. `check:deployment --rate-limit --expect-ip <adresse publique du poste>` : 10 OK, aucun ignoré. En cas d'échec de « Adresse du client », régler `CADDY_TRUSTED_PROXIES`.
3. Sentry depuis le conteneur (`node dist/sentry-check.js`), puis lecture de l'événement par le MCP Sentry.
4. Cookies et sessions dans le navigateur.
5. Deux postes sur deux réseaux.
6. Suite d'intégration sur un PostgreSQL jetable de l'hébergeur.
7. Exercice de sauvegarde et de restauration complet, avec la clé tirée du coffre.
8. `staging:timings`, avec `API_RATE_LIMIT_PER_MINUTE` relevé pendant la mesure.

## 9. CI

- `253a94f` : pile staging locale en échec (défaut du script d'attente).
- `1ba8218` : pile staging locale verte à tort (voir section 3) ; job Sentry déclenché par erreur (marqueur cité dans le message).
- `d321c97` : corrections (`pipefail`, passerelle du réseau fixée, `--expect-ip 172.28.0.1`). Tous les jobs verts, Sentry ignoré comme prévu. Journal de la pile staging lu : 10 OK, dont « adresse du poste enregistrée (172.28.0.1) » ; « Aucun échec » ; 182 lignes de journaux sans secret ni jeton.
- `c7c863e` (noms en arabe, revues) : runs « push » : tous les jobs verts, Sentry ignoré comme prévu. Pile staging locale : 10 OK, « Aucun échec ». Parcours de bout en bout : 56 sur 56 en 4,3 min, dont le parcours des noms en arabe ; contrôle final de 101 978 lignes sans donnée saisie.
- Runs « pull_request » (PR #1) de `d321c97`, `c7c863e` et `648797b` : **rouges** à l'étape des tests (Casablanca), non vus sur le moment. Cause et correction : section 3, « Heure légale marocaine ».

## 10. Risques relevés pendant cette étape

| Risque | Gravité | Parade |
|---|---|---|
| **Limitation par adresse IP partagée** : tous les postes d'un cabinet sortent souvent par une seule adresse publique ; ils partagent alors 300 requêtes par minute (`API_RATE_LIMIT_PER_MINUTE`) et 10 tentatives de connexion par minute | Moyenne pour un cabinet de plus de 5 à 10 postes actifs | Mesurer sur le staging le nombre de requêtes par écran ; relever la limite globale par cabinet si nécessaire. Les limites sensibles (connexion) restent basses |
| Comportement réel du proxy de Railway (`X-Real-IP` écrasé ? adresses sources ?) | Élevée si faux (contournement de la limitation, journal d'audit faux) | Premier contrôle sur le staging : `check:deployment --rate-limit --expect-ip` |
| Chiffrement au repos et localisation des sauvegardes Railway non documentés | Moyenne | Trust Center de Railway avant toute production |
| Aucun rechiffrement outillé de `DATA_ENCRYPTION_KEY` (déjà consigné) | Moyenne en cas de fuite | Commande de rechiffrement avant un premier incident |
| **Données de fuseau du navigateur antérieures au retour du Maroc à GMT** : l'interface affiche les heures avec les données du navigateur ; un navigateur qui n'a pas reçu la mise à jour de 2026 afficherait les rendez-vous d'un cabinet marocain une heure trop tard | **Élevée** pour les cabinets marocains | Avant toute production au Maroc : contrôle dans l'interface (décalage du fuseau selon le navigateur comparé à celui du serveur, alerte si différent), puis navigateurs à jour. Versions de navigateur concernées non vérifiées |

## 11. Cadre marocain (à valider par un juriste ; confiance moyenne)

- **Loi 09-08** (protection des données personnelles), autorité **CNDP** :
  - les données de santé sont des données sensibles, avec autorisation préalable probable pour le traitement ;
  - un transfert hors du Maroc, par exemple un hébergement dans l'UE, est encadré : pays offrant une protection adéquate, ou autorisation.
- La certification **HDS** est française : elle ne s'impose pas pour des patients marocains soignés au Maroc. Un hébergeur sérieux reste nécessaire (contrat, DPA, sauvegardes, localisation).
- Décisions à prendre :
  - déclaration ou autorisation CNDP ;
  - localisation acceptable ;
  - durées de conservation (dossier médical, paiements, journaux) ;
  - contrat de sous-traitance avec les cabinets ;
  - langue : interface en français seulement. Les noms en caractères arabes et tifinagh sont pris en charge pour la saisie, la recherche et les doublons (section 3) ; la lisibilité d'un écran mêlant français et arabe n'a pas été relue par un utilisateur.
