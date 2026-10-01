# Déploiement du staging (Railway)

**État au 2026-09-30 : prêt, jamais déployé.** Aucun budget d'hébergement : la décision du porteur du projet est « 0 €, aucun service payant ». Tout ce qui suit est à exécuter par une personne habilitée, une fois le budget décidé.

Règles :
- **Aucune production.** Ce document ne concerne que le staging, avec des données synthétiques uniquement.
- **Aucun secret** dans Git, la documentation, un ticket ou une messagerie.
- **Une seule instance d'API** : le limiteur de débit est en mémoire.

Décisions et raisons : [ADR 0013](../adr/0013-deploiement-images-proxy-staging.md).

## 1. Architecture

```
Internet ──HTTPS──▶ proxy Railway (TLS, HTTP→HTTPS, X-Real-IP)
                        │
                        ▼
                 web (Caddy, public)  ── fichiers de l'interface + en-têtes de sécurité
                        │ /api/*  (X-Forwarded-For = adresse du client)
                        ▼
                 api (Fastify, privé, 1 instance) ──▶ postgres (privé, volume, sauvegardes)
                 worker (pg-boss, privé)          ──▶ postgres
                 migrate (exécution unique : bootstrap, migrate, check-database)
```

| Service | Image | Commande | Accès PostgreSQL |
|---|---|---|---|
| `web` | `infra/docker/web.Dockerfile` | Caddy (`infra/caddy/Caddyfile`) | aucun |
| `api` | `infra/docker/server.Dockerfile` | `node dist/main-api.js` | `dental_app` |
| `worker` | idem | `node dist/main-worker.js` | `dental_app` |
| `migrate` | idem | `bootstrap`, `migrate`, `check-database` | administrateur, `dental_owner` |
| `postgres` | modèle Railway (PostgreSQL 16) | | |

Région : Europe de l'Ouest (`europe-west4-drams3a`, Amsterdam). Description complète : `.railway/railway.ts`.

## 2. Coût minimal estimé

Sources :
- tarifs officiels de Railway (`docs.railway.com/pricing/plans`, lus le 2026-09-30) : offre Hobby à 5 $ par mois, dont 5 $ d'usage inclus ; RAM 10 $/Go/mois ; CPU 20 $/vCPU/mois ; volume 0,15 $/Go/mois ; bucket 0,015 $/Go/mois ;
- consommation estimée (**confiance moyenne**) : environ 0,4 Go de RAM au repos (API environ 120 Mo, worker environ 100 Mo, Caddy environ 30 Mo, PostgreSQL environ 150 Mo), CPU presque nul au repos, 1 Go de volume.

| Poste | Estimation par mois |
|---|---|
| Abonnement Hobby (usage inclus : 5 $) | 5 $ |
| RAM environ 0,4 Go | environ 4 $ |
| CPU au repos | environ 1 $ |
| Volume, sauvegardes, archive de restauration à un instant donné | moins de 0,5 $ |
| **Facture attendue** | **5 à 7 $** |

Ce qui ferait monter la facture :
- des tests de charge prolongés ;
- des images reconstruites très souvent (le build est gratuit, mais les déploiements consomment) ;
- un deuxième environnement.

Fixer une limite de dépense dans Railway (« Usage limits ») avant le premier déploiement.

## 3. Prérequis

- [ ] Budget accepté par le porteur du projet ; espace Railway en Hobby (tableau de bord → Workspace → Plan).
- [ ] Compte GitHub relié à Railway ; accès de Railway au dépôt `ibradamm/SaaS-dentists`.
- [ ] Poste de l'opérateur : Node 22, pnpm 10, OpenSSL, [CLI Railway](https://docs.railway.com/cli) (`railway login`).
- [ ] Coffre des secrets de l'équipe (gestionnaire de mots de passe, deux personnes habilitées) : copie indépendante de `DATA_ENCRYPTION_KEY` ([cle-de-chiffrement.md](cle-de-chiffrement.md)).
- [ ] Commit à déployer, avec sa CI verte (les 5 jobs, dont « Pile staging locale »).

## 4. Mise en place (une fois)

1. **Projet.** Créer le projet `dental-saas` (tableau de bord ou `railway init`). Renommer son environnement en `staging` : aucun environnement « production » dans ce projet.

2. **Secrets.** Sur le poste de l'opérateur, générer chaque valeur :
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"   # mots de passe des rôles
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"      # DATA_ENCRYPTION_KEY
   ```
   Créer les variables partagées de l'environnement `staging`, puis les **sceller** (tableau de bord → Variables → Shared). Les valeurs vont directement de la génération au gestionnaire de secrets de Railway :
   - `DATABASE_OWNER_PASSWORD` et `DATABASE_APP_PASSWORD` : base64url, donc aucun caractère à échapper dans une URL ;
   - `DATA_ENCRYPTION_KEY` : copiée **aussi** dans le coffre de l'équipe ; noter son empreinte (`printf %s "$CLE" | sha256sum | cut -c1-16`) dans le registre d'exploitation ;
   - `SENTRY_DSN` : DSN du projet Sentry `dental-staging` (organisation UE), ou vide.

   Ces secrets sont propres au staging et ne serviront jamais à la production.

3. **Services.** Depuis la racine du dépôt :
   ```bash
   pnpm install
   railway link                 # projet dental-saas, environnement staging
   railway config plan          # relire : postgres, migrate, api, worker, web ; aucune suppression
   railway config apply
   railway domain --service web # domaine *.up.railway.app, HTTPS géré par Railway
   railway redeploy --service api   # WEB_ORIGIN dépend du domaine public de web
   ```
   Tant que le domaine n'existe pas, l'API refuse de démarrer (`WEB_ORIGIN` invalide) : c'est attendu.

4. **Sauvegardes** (service `postgres` → Backups) :
   - activer les sauvegardes quotidiennes et hebdomadaires ;
   - activer la restauration à un instant donné (« Enable PITR ») ;
   - procédure et exercice : [sauvegarde-restauration.md](sauvegarde-restauration.md).

## 5. Déploiement et commit déployé

1. `migrate` d'abord. Son journal doit se terminer par :
   - `Migrations : … appliquée(s)` ;
   - `Base conforme : RLS forcée partout, rôles sans privilège de contournement, journal terse.`

   Sinon le service échoue et rien d'autre ne doit être déployé.
2. Puis `api` (vérification de santé `/health/ready`), `worker` et `web`.
3. **Commit déployé** : la page du déploiement Railway affiche le commit. La CI du même commit doit être verte, ce que `checkSuites` impose. `SENTRY_RELEASE` vaut ce commit. Le noter dans le registre d'exploitation.
4. **Retour arrière** : redéployer le déploiement précédent depuis Railway. Les migrations ne se défont pas (ADR 0002) : un retour arrière du code n'est sûr que si la migration du déploiement annulé est compatible avec l'ancien code.

## 6. Cabinet et comptes de test (synthétiques)

Les commandes d'administration affichent un mot de passe temporaire : les exécuter dans un terminal, **jamais** comme commande de démarrage (le journal de Railway le conserverait).

1. Passer temporairement la commande de démarrage de `migrate` à `sleep 3600`, puis la redéployer.
2. Dans le conteneur :
   ```bash
   railway ssh --service migrate
   node dist/create-clinic.js --name "Cabinet Test Casablanca" --timezone Africa/Casablanca --locale fr-MA --currency MAD --country MA
   node dist/create-admin.js --clinic <id> --email admin.test@<domaine-de-test> --name "Admin Test"
   ```
3. Rétablir la commande de `migrate` (section 4, `.railway/railway.ts`), puis `railway config apply`.
4. Sur le poste de l'opérateur :
   ```bash
   ADMIN_TEMPORARY_PASSWORD='…' pnpm --filter @dental/e2e staging:accounts \
     --url https://<domaine> --admin-email admin.test@<domaine-de-test> --out ~/comptes-staging.json
   ```
   Le fichier (droits 600) contient les identifiants de l'administrateur et de la secrétaire de test. Il reste sur le poste de l'opérateur.

## 7. Vérifications à faire aussitôt (dans l'ordre)

| # | Vérification | Commande ou geste | Réussite |
|---|---|---|---|
| 1 | Invariants de la base hébergée | Journal de `migrate` | « Base conforme » |
| 2 | HTTPS, redirection, TLS, en-têtes, CORS, erreurs, cookie, adresse du client, limitation derrière le proxy | `pnpm --filter @dental/e2e check:deployment --url https://<domaine> --accounts ~/comptes-staging.json --rate-limit --expect-ip "$(curl -s https://api.ipify.org)"` | **10 OK, aucun IGNORÉ**. Si « Adresse du client » échoue, corriger `CADDY_TRUSTED_PROXIES` avec les adresses réelles du proxy de Railway (journal de Caddy), puis relancer |
| 3 | Sentry réel | `railway ssh --service api` puis `node dist/sentry-check.js` (APP_ENV et SENTRY_DSN viennent du service) ; lire l'événement (MCP Sentry, `search_events`) | Événement reçu ; ni nom, téléphone, note, cookie, jeton, mot de passe, secret ou valeur SQL |
| 4 | Cookies et sessions dans le navigateur | Outils de développement : cookie `__Host-dental_session` (Secure, HttpOnly, SameSite=Lax, expiration) ; déconnexion ; changement d'utilisateur ; changement de cabinet ; révocation par l'administrateur | Session fermée à chaque fois |
| 5 | Plusieurs postes derrière le proxy | Deux connexions depuis deux réseaux différents (poste et téléphone en 4G), puis le journal d'audit | Deux adresses publiques distinctes enregistrées |
| 6 | Suite d'intégration sur un PostgreSQL de l'hébergeur | Service `pg-test` jetable (modèle PostgreSQL), proxy TCP le temps du test, `TEST_DATABASE_ADMIN_URL=… pnpm --filter @dental/server test`, puis suppression de `pg-test` | Tous les tests verts |
| 7 | Sauvegarde et restauration | [sauvegarde-restauration.md](sauvegarde-restauration.md) | Données, rendez-vous, paiements, migrations, RLS, rôles, droits, audit et note médicale relue avec la clé du coffre |
| 8 | Performances | `pnpm --filter @dental/e2e staging:timings --url https://<domaine> --accounts ~/comptes-staging.json`, d'abord avec les limites normales (nombre de 429), puis `API_RATE_LIMIT_PER_MINUTE` relevé le temps de la mesure de charge et remis ensuite | Comparer aux mesures locales (docs/phases/phase-11-staging.md) ; aucune erreur serveur |

Tant qu'une ligne n'est pas verte, le contrôle correspondant de `docs/phases/phase-11-audit-preproduction.md` reste NON VÉRIFIÉ.

## 8. Arrêt du staging

Pour ne plus rien payer :
- supprimer le projet `dental-saas` (tableau de bord → Settings → Danger) ;
- les sauvegardes du volume disparaissent avec lui ;
- supprimer aussi le bucket de restauration à un instant donné ;
- les secrets du staging deviennent inutiles : les retirer du coffre.
