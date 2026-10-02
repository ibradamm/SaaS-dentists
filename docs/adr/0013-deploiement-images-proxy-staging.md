# ADR 0013 — Déploiement : images, proxy, staging

- Statut : accepté (2026-09-30), Phase 11. Staging préparé, **jamais déployé** : aucun budget d'hébergement (décision du porteur du projet : 0 €, aucun service payant).
- **Demande du porteur du projet :** un staging réellement séparé de la production (interface, API, worker, PostgreSQL, secrets dédiés), vérifié par de vraies requêtes ; rien en production sans son accord. Premiers cabinets au **Maroc**.

## 1. Contexte

- Railway est le seul hébergeur pilotable depuis l'environnement de développement (MCP). Son offre gratuite ne permet pas de créer le projet (limite atteinte, 0,5 Go de RAM par service).
- Le format `railway.json` est déprécié ; son remplaçant est `.railway/railway.ts`.
- Le proxy de Railway termine TLS, redirige HTTP vers HTTPS et fournit l'adresse du client dans `X-Real-IP`. Sa documentation ne dit pas d'où vient son trafic, ni s'il écrase un `X-Real-IP` envoyé par le client.

## 2. Décision

| Élément | Choix | Raison |
|---|---|---|
| Images | Une image serveur (API, worker, bootstrap, migrations, commandes d'administration : seule la commande change) ; une image d'interface (Caddy officiel). Bases figées par empreinte, utilisateur sans droits | Un seul build testé pour tous les rôles ; pas de dépendance ajoutée |
| En-têtes de l'interface | Générés au build depuis `apps/web/security-headers.ts` (`caddy-headers.mjs`) | Une seule source, comme l'exige CLAUDE.md |
| Chemin de l'adresse du client | Proxy de l'hébergeur → Caddy (`trusted_proxies` = proxy de l'hébergeur, `client_ip_headers X-Real-IP`) → API (`X-Forwarded-For` réécrit avec la seule adresse retenue, `API_TRUST_PROXY_HOPS=1`) | Un en-tête fourni par le client n'atteint jamais l'API |
| Exposition | Seul le service `web` est public ; `/api` est relayé (même origine : cookies `__Host-`, CSRF inchangés). API, worker et base : réseau privé | Surface minimale |
| Migrations | Service `migrate` à exécution unique : `bootstrap`, `migrate`, puis `check-database`. Seul service qui détient les accès propriétaire et administrateur de PostgreSQL | L'API compromise n'aurait jamais le rôle propriétaire. Un déploiement sur une base non conforme (RLS, rôles, journal) échoue |
| Instances | Une seule API | Le limiteur de débit est en mémoire (ADR 0003) |
| Secrets | Variables partagées **scellées** de l'environnement, créées à la main avant le premier `apply`. Jamais dans `.railway/railway.ts` ni dans Git | Le générateur de secrets du format Railway n'est pas documenté : pas utilisé |
| Déploiement | `github()` avec `checkSuites: true` : Railway attend la CI verte du commit | Aucun commit rouge en staging ; commit identifiable (`SENTRY_RELEASE`) |
| Région | Europe de l'Ouest (Amsterdam) | La plus proche du Maroc parmi les régions Railway |
| Journaux d'accès | Aucun dans Caddy | Les adresses contiennent des recherches de patients |

**Pile staging locale** (`infra/staging-local`) : les mêmes images derrière un proxy de périmètre simulé (Caddy : TLS, redirection, `X-Real-IP` écrasé), en `APP_ENV=staging`. La CI l'exécute à chaque commit :
- `check:deployment` : 10 contrôles, aucun ignoré ;
- journaux des conteneurs sans secret.

## 3. Alternatives écartées

- **API qui sert aussi l'interface** : un service de moins, mais dépendance de fichiers statiques dans l'API. Et le plan (ARCHITECTURE, B) prévoyait Caddy.
- **Migrations en pré-déploiement de l'API** : idiome de Railway, mais les accès propriétaire seraient dans l'environnement de l'API.
- **`railway.json`** : déprécié, plus lu après le 1er décembre 2026.
- **Hébergements gratuits** (Render, Koyeb, Northflank) : durée limitée de la base, service unique, ou carte bancaire. Évaluation dans `docs/phases/phase-11-staging.md`.

## 4. Conséquences

- Tant qu'aucun staging n'existe, les contrôles propres à l'hébergement restent **NON VÉRIFIÉS — BLOQUÉS PAR ABSENCE D'HÉBERGEMENT GRATUIT DISPONIBLE**.
- La pile locale prouve la configuration (images, Caddy, cookies, en-têtes, adresse du client, limitation) contre un proxy qui se comporte comme celui de Railway est **documenté**. Elle ne prouve pas que le vrai proxy se comporte ainsi. C'est le premier contrôle à faire sur le staging : `check:deployment --rate-limit --expect-ip <adresse du poste>`.
- Procédure : `docs/operations/deploiement-staging.md`. Sauvegardes : `docs/operations/sauvegarde-restauration.md`.
