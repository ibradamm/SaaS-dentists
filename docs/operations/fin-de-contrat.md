# Fin de contrat d'un cabinet : restitution, suppression, sauvegardes, litiges

- **Statut :** procédure prête, **jamais exécutée sur un hébergement** : aucun staging n'existe. Les commandes ont été exécutées sur la base locale et, en CI, avec les images de production.
- **Décisions :** [ADR 0014](../adr/0014-conservation-restitution-suppression.md).
- **Durées :** [tableau de conservation](../conformite/tableau-de-conservation.md).
- **Clauses contractuelles :** [projet de contrat](../conformite/contrat-sous-traitance-projet.md), article 10.

Règles :
- **Rien n'est supprimé sans instruction écrite du cabinet** (ou décision de justice), ni à cause d'une durée non validée.
- **Aucune donnée patient** dans le registre, un ticket, une messagerie ou un journal. Le fichier d'export ne transite que chiffré.
- Chaque étape est inscrite au **registre d'exploitation** (section 6).

## 1. Commandes

| Commande | Où (Railway) | Accès PostgreSQL | Effet |
|---|---|---|---|
| `node dist/clinic-lifecycle.js --clinic <id> --action suspend` | service `migrate` | propriétaire | Connexion refusée, sessions révoquées à la requête suivante ; données intactes |
| `… --action reactivate` | `migrate` | propriétaire | Annule la suspension |
| `… --action hold` / `--action release` | `migrate` | propriétaire | Pose ou lève la conservation pour litige : aucune suppression tant qu'elle est posée |
| `node dist/export-clinic.js --clinic <id> --out -` | service `api` | applicatif (RLS) + clé de chiffrement | Export JSON complet (`dental-export/1`) ; volumes sur la sortie d'erreur |
| `node dist/retention-report.js` | `api` ou `worker` | applicatif | Revue de conservation, sans suppression |
| `node dist/purge-clinic.js --clinic <id> --confirm "<nom exact>" [--execute]` | `migrate` | administrateur | Simulation, ou suppression définitive |

Pour exécuter une commande dans le service `migrate` (qui s'arrête après ses migrations), procéder comme pour la création d'un cabinet ([deploiement-staging.md](deploiement-staging.md), section 6) : commande de démarrage temporaire `sleep 3600`, puis `railway ssh --service migrate`, puis rétablissement de la commande.

Pour l'export, la sortie standard est redirigée vers un fichier sur le poste de l'opérateur, par exemple :

```bash
railway ssh --service api -- node dist/export-clinic.js --clinic <id> --out - > export.json
```

Cette forme de `railway ssh` (commande passée en argument) **n'a pas été vérifiée** : la tester d'abord sur le staging, avec un cabinet fictif.

## 2. Résiliation : chronologie

1. **Instruction écrite** du cabinet : date de fin, demande de restitution, éventuel litige en cours. L'inscrire au registre.
2. **Litige ?** Si le cabinet ou un tiers le signale, poser la conservation pour litige (`--action hold`) et passer à la section 5.
3. **Date de fin : suspension** (`--action suspend`). Les données restent intactes et inaccessibles.
4. **Restitution :**
   1. Export (`export-clinic`), redirigé vers un fichier sur un poste chiffré.
   2. Contrôle des volumes (sortie d'erreur) et calcul de l'empreinte : `sha256sum export.json`.
   3. Chiffrement du fichier, par exemple archive AES-256 avec une phrase de passe transmise **par un autre canal**.
   4. Remise au cabinet, accusé de réception mentionnant l'empreinte.
   5. **Suppression de notre copie** (fichier et archive), inscrite au registre.

   Le format est du JSON, une table par clé, documenté dans `apps/server/src/db/admin/clinic-data.ts`. Le fichier contient les notes médicales **en clair** : il est aussi sensible que les dossiers. Il ne contient ni les sessions ni les secrets d'authentification.
5. **Délai contractuel** de [N] jours : le cabinet peut demander une nouvelle restitution ; les données restent suspendues.
6. **Purge**, à l'échéance, sauf conservation pour litige :
   1. Simulation : `purge-clinic --clinic <id> --confirm "<nom exact>"`. Elle affiche les volumes ; rien n'est supprimé.
   2. Purge définitive : même commande avec `--execute`.
   3. Récapitulatif (identifiant, nom du cabinet, date, volumes) au registre.

   La commande refuse un cabinet non suspendu, un cabinet sous conservation pour litige, ou une confirmation qui ne reproduit pas exactement le nom. Une seule transaction ; les comptes du personnel rattachés à ce seul cabinet sont supprimés, les autres perdent leur rattachement.
7. **Sauvegardes** : section 4.
8. **Attestation** de suppression au cabinet. Elle indique la date de purge et la date à laquelle la dernière sauvegarde contenant ses données aura expiré.

## 3. Ce que la purge ne supprime pas

- **Sauvegardes et restauration à un instant donné** : elles expirent seules (section 4).
- **Journaux de l'hébergeur** : adresses IP des postes et chemins des requêtes, sans donnée patient ; durée fixée par l'hébergeur, non vérifiée.
- **Sentry** : erreurs sans donnée personnelle par conception.
- **Registre d'exploitation** : aucune donnée patient.
- **Fichiers d'export** : supprimés à la remise (étape 4).

## 4. Sauvegardes

- Une purge ne touche pas les sauvegardes. Les données du cabinet y restent jusqu'à leur expiration :
  - instantanés du volume : quotidiens 6 jours, hebdomadaires 27 jours, **mensuels 89 jours** ;
  - restauration à un instant donné : environ 4 semaines.

  Source : documentation Railway, [sauvegarde-restauration.md](sauvegarde-restauration.md). À confirmer sur l'offre souscrite.
- Le contrat doit l'annoncer : **suppression effective des sauvegardes au plus tard [89] jours après la purge**.
- **Après toute restauration** d'une sauvegarde antérieure à une purge, **rejouer les purges du registre** postérieures à la date de la sauvegarde, avant de rouvrir le service. Sinon, un cabinet supprimé réapparaîtrait. Cette étape figure dans [sauvegarde-restauration.md](sauvegarde-restauration.md).
- Aucune sauvegarde n'est supprimée à la main pour un seul cabinet : elle contient tous les cabinets.

## 5. Litige (conservation pour litige)

- **Poser** : `--action hold`, sur instruction écrite du cabinet, d'un avocat ou sur décision de justice ; l'inscrire au registre. Effets :
  - la purge nocturne (sessions, brouillons d'import) est suspendue pour ce cabinet ;
  - `purge-clinic` est refusée.
- **Sauvegardes** : elles continuent d'expirer. Si le litige porte sur une période passée, faire un **export dédié** (`export-clinic`), chiffré, conservé dans le coffre de l'équipe et inscrit au registre. L'export reflète l'état actuel ; une version antérieure ne se retrouve qu'en restaurant une sauvegarde **dans un service séparé** ([sauvegarde-restauration.md](sauvegarde-restauration.md)), avant son expiration.
- **Lever** : `--action release`, sur instruction écrite ; la date de pose disparaît. Reprendre ensuite la chronologie là où elle s'était arrêtée.

## 6. Registre d'exploitation

Hors de la base (sinon une restauration l'effacerait), dans l'espace documentaire de l'équipe ou le coffre. Une ligne par action :
- date ;
- opérateur ;
- action : suspension, export, remise, suppression de notre copie, conservation pour litige, purge, restauration ;
- identifiant et nom du cabinet ;
- référence de l'instruction ;
- volumes et empreinte de l'export.

**Jamais** de nom de patient, de contenu, de mot de passe ni de clé.

## 7. Vérifications

- Tests d'intégration (`apps/server/src/db/__tests__/clinic-data.int.test.ts`) :
  - toute table du schéma est classée ;
  - l'export est complet, ne contient aucun secret, et la RLS en exclut les autres cabinets ;
  - le rôle applicatif ne peut ni suspendre ni poser une conservation pour litige ;
  - la purge est refusée dans les quatre cas prévus ;
  - la simulation ne supprime rien ;
  - l'autre cabinet reste intact ;
  - le compte partagé est conservé.
- Conservation pour litige dans la purge nocturne : `retention.int.test.ts`.
- **CI**, pile staging locale (images de production) : création, export, revue, purge refusée sur un cabinet actif, suspension, purge, absence du cabinet.
- **À faire sur le staging** :
  - toute la chronologie avec un cabinet fictif, dont `railway ssh` avec une commande en argument ;
  - restauration d'une sauvegarde antérieure, puis rejeu de la purge.
