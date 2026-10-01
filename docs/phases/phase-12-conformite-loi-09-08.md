# Étape « loi 09-08 » (préparation) : rapport

- **Date :** 2026-10-01.
- **Demande du porteur du projet :** vérifier des éléments préliminaires (CNDP, loi 09-08, CGI), inspecter le projet, corriger ce qui est techniquement justifié, préparer les documents à faire relire, prévoir la fin de contrat.
- **Le SaaS n'est pas déclaré conforme.** Les mesures techniques ne remplacent ni les formalités CNDP, ni les contrats signés, ni l'information effective des patients, ni des durées validées.

## 1. Éléments vérifiés

**Limite majeure :** aucun texte officiel n'a pu être lu. `cndp.ma`, `tax.gov.ma`, `sgg.gov.ma`, `adala.justice.gov.ma` et les copies du texte sont refusés par la politique réseau de l'environnement. Les vérifications reposent sur des extraits renvoyés par un moteur de recherche. Détail et liens : [sources.md](../conformite/sources.md).

| Élément de la note du porteur du projet | Résultat |
|---|---|
| Données de santé sensibles ; régime de l'article 22 (déclaration pour les traitements de soins par des personnes soumises au secret) | **Contradictoire** : un extrait confirme la formulation, d'autres sources affirment qu'une autorisation est toujours requise. Exception **plausible, non acquise** : « pour seule finalité » et « obligation de secret » de notre personnel à trancher |
| Cabinet responsable, éditeur sous-traitant ; contrat exigé par l'article 23 | Concordant, texte non lu. Répartition confirmée par les usages réels, avec trois zones grises : comptes communs à plusieurs cabinets, journaux de sécurité, exploitation |
| Hébergement dans l'UE insuffisant ; formulaire de transfert ; accord exprès de la CNDP | Concordant (pages CNDP via moteur de recherche). Liste des pays (délibération 236-2015) : Pays-Bas oui, États-Unis non ; mise à jour depuis 2015 non vérifiée |
| Dossier médical : aucune durée marocaine confirmée ; pas de 20 ans automatiques | Confirmé : aucune source trouvée ; aucune durée appliquée |
| CGI, article 211 : dix ans pour les pièces concernées, pas pour toutes les données bancaires | Concordant (sources secondaires), texte non lu ; point de départ non trouvé. L'application **n'enregistre aucune donnée bancaire** |
| Journaux : durées justifiées par la finalité, pas présentées comme légales | Appliqué dans le tableau de conservation (statut « proposition technique ») |

**Corrigé en cours de route :** j'avais d'abord noté que la copie des lignes d'import restait sans limite après validation (écart E9). C'était faux : elle est effacée à la validation (`imports.service.ts`). Restent seulement la clé d'identité et la référence externe. L'écart et le plan d'architecture ont été corrigés.

## 2. Changements réalisés

| Changement | Fichiers | Vérification |
|---|---|---|
| **Catalogue des tables** d'un cabinet (16 tables) et des tables globales (3) ; un test refuse toute table non classée | `apps/server/src/db/admin/clinic-data.ts` | Test d'intégration |
| **Export de restitution** `export-clinic` : JSON complet, notes déchiffrées, ni sessions ni secrets ; rôle applicatif et RLS ; refuse d'écraser un fichier ; droits 600 | `clinic-data.ts`, `db/cli/export-clinic.ts` | Test : complet, aucun secret, autre cabinet absent, date de naissance intacte |
| **Suspension et conservation pour litige** `clinic-lifecycle` ; colonne `legal_hold_since` (migration 0021), lisible mais non modifiable par l'application | `db/admin/clinics.ts`, `db/cli/clinic-lifecycle.ts`, migration 0021 | Test : le rôle applicatif ne peut ni suspendre ni poser une conservation pour litige |
| **Purge nocturne suspendue** pour un cabinet sous conservation pour litige | `jobs/retention.ts` | Test : rien n'est supprimé tant qu'elle est posée, tout l'est après sa levée |
| **Purge sur instruction** `purge-clinic` : connexion administrateur, cabinet suspendu, pas de litige, nom exact, simulation par défaut, une transaction, comptes partagés conservés | `clinic-data.ts`, `db/cli/purge-clinic.ts` | Tests : 4 refus, simulation sans effet, autre cabinet intact, compte partagé conservé |
| **Durées de revue configurables, sans suppression** (`RETENTION_REVIEW_*`), commande `retention-report` | `jobs/retention.ts`, `config/env.ts`, `db/cli/retention-report.ts`, `.env.example` | Test : volumes et dépassements exacts, rien de supprimé |
| CI : fin de contrat jouée avec les **images de production** (pile staging locale) | `.github/workflows/ci.yml` | Résultat : voir le run du commit |

Les tests ont été mis à l'épreuve par cinq failles injectées volontairement, toutes détectées :
- une table oubliée dans le catalogue ;
- une purge du journal d'audit sans filtre par cabinet ;
- la conservation pour litige ignorée par la purge ;
- les comptes exportés en entier, avec l'empreinte du mot de passe ;
- la conservation pour litige ignorée par la tâche nocturne.

Les commandes compilées ont été exécutées sur la base locale, avec un cabinet fictif :
- export de 17 tables, droits 600, réécriture refusée ;
- rapport de conservation ;
- purge refusée tant que le cabinet est actif, puis sous conservation pour litige ;
- simulation ;
- purge effectuée ;
- cabinet introuvable ensuite.

Vérification complète sous Node 22.23.3 : shared 80, web 135, serveur 423 tests ; build de 146,6 ko ; aucune dérive du schéma.

Documents préparés, **à faire relire** :
- [contrat de sous-traitance](../conformite/contrat-sous-traitance-projet.md) avec ses 5 annexes ;
- [notice patients](../conformite/notice-information-patients-projet.md) ;
- [tableau de conservation](../conformite/tableau-de-conservation.md) (12 lignes : durée, point de départ, justification, statut) ;
- [inventaire et écarts](../conformite/inventaire-et-ecarts.md) (E1 à E17) ;
- [procédure de fin de contrat](../operations/fin-de-contrat.md) ;
- [ADR 0014](../adr/0014-conservation-restitution-suppression.md).

## 3. Points restant à valider

**Par un juriste ou la CNDP :**
1. Lecture des textes officiels (liste dans [sources.md](../conformite/sources.md)), d'abord l'article 22.
2. Régime CNDP : déclaration ou autorisation. Notre personnel et notre hébergeur sont-ils des « personnes soumises à une obligation de secret » ?
3. Qualification des comptes communs à plusieurs cabinets et des journaux de sécurité.
4. Transferts : formulaire par cabinet, pays de la liste, accès techniques depuis les États-Unis (support de l'hébergeur), validité du consentement comme base.
5. Durée du dossier dentaire et son point de départ ; portée et point de départ de l'article 211 du CGI.
6. Contrat (délais en crochets, responsabilité, audits), notice (dont la version arabe), obligation de notifier une violation.

**Par le porteur du projet :**
1. Hébergeur : Railway (Pays-Bas, société américaine) ou hébergeur au Maroc (supprime le transfert ; coût et architecture à évaluer).
2. Auprès de Railway et Sentry : DPA, localisation des sauvegardes, des journaux et du bucket, chiffrement au repos, durée des journaux.
3. Écarts E9 à E17 marqués « à décider ».
4. Désactivation ou maintien des deux purges techniques existantes (sessions 30 jours, brouillons 24 heures).

**Par chaque cabinet :** formalités CNDP, durées de conservation, affichage de la notice.

**Sur le staging, dès qu'il existe :** toute la procédure de fin de contrat, dont `railway ssh` avec une commande en argument, et le rejeu d'une purge après restauration d'une sauvegarde.
