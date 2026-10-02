# Écarts E9 à E20 et purges techniques : décisions à prendre

> **À faire valider par un juriste marocain avant utilisation.** Aucun changement de produit n'est fait tant que le besoin juridique n'est pas établi ou que vous n'avez pas décidé.

- **Date :** 2026-10-01.
- Les écarts E1 à E8 sont traités dans [inventaire-et-ecarts.md](inventaire-et-ecarts.md).
- Statuts juridiques : voir [sources.md](sources.md) (TEXTE OFFICIEL VÉRIFIÉ, SOURCE SECONDAIRE, INTERPRÉTATION, NON VÉRIFIÉ).

## 1. Écarts un par un

### E9 — Clé d'identité des lignes d'un import validé

- **En clair :** après un import validé, la copie du fichier est effacée, mais il reste pour chaque ligne une clé « nom normalisé, prénom normalisé, date de naissance » et la référence de l'ancien logiciel, sans limite de durée.
- **Risque :** faible. Si la fiche est corrigée plus tard, l'ancienne version du nom subsiste dans cette clé, visible seulement en base.
- **Obligation juridique :** inconnue. Le principe de conservation limitée (article 3, SOURCE SECONDAIRE) plaide pour l'effacement ; aucune durée n'est imposée.
- **Possible techniquement :** effacer clé et référence après la fenêtre d'annulation de l'import (proposition : 30 jours) ; les volumes sont déjà mesurés par `retention-report`.
- **Votre choix :** durée de la fenêtre d'annulation ; accepter ou non qu'un import ne soit plus annulable au-delà.
- **Juriste :** non nécessaire, sauf s'il fixe une règle générale de conservation.

### E10 — Effacement d'une fiche sur demande

- **En clair :** une fiche saisie à la main ne peut pas être supprimée dans l'application, seulement archivée. C'est voulu, pour protéger le dossier médical.
- **Risque :** moyen. Un patient demande l'effacement (fiche créée par erreur, doublon, contestation) et le cabinet ne peut pas le faire.
- **Obligation juridique :**
  - article 8 : effacement des données non conformes (SOURCE SECONDAIRE) ;
  - articulation avec une éventuelle durée de conservation du dossier : **NON VÉRIFIÉ**.
- **Possible techniquement :** une commande d'administration « effacer une fiche » sur instruction écrite du cabinet, sur le modèle de `purge-clinic` (simulation, confirmation, registre). Ou une action réservée à l'administrateur dans l'interface, avec audit et parcours de bout en bout.
- **Votre choix :** commande d'exploitation (rare, plus simple) ou fonction dans l'interface (autonomie des cabinets).
- **Juriste :** **oui**. Quand un cabinet peut-il, ou doit-il, effacer un dossier médical à la demande du patient ?

### E11 — Droit d'accès d'un patient

- **En clair :** l'application n'a pas d'export « par patient ». Le cabinet peut montrer la fiche : coordonnées, rendez-vous, encaissements, et notes pour le dentiste et l'administrateur.
- **Risque :** faible. La réponse à une demande d'accès est plus lente ou manuelle.
- **Obligation juridique :**
  - article 7, droit d'accès : SOURCE SECONDAIRE ;
  - forme et délai de la réponse : NON VÉRIFIÉ.
- **Possible techniquement :** un export PDF ou JSON d'une fiche, avec audit.
- **Votre choix :** utile ou non pour les premiers cabinets.
- **Juriste :** forme et délai de réponse, si vous voulez une procédure.

### E12 — Textes libres en clair

- **En clair :** seules les notes médicales sont chiffrées par l'application. La note de rendez-vous, la note administrative et le libellé des actes sont en clair dans la base et peuvent contenir des informations de santé.
- **Risque :** moyen en cas de fuite de la base ou d'une sauvegarde. Il dépend du chiffrement au repos chez l'hébergeur, non vérifié pour les volumes Railway.
- **Obligation juridique :**
  - article 24, mesures appropriées pour les données de santé : SOURCE SECONDAIRE ;
  - exigence de chiffrement champ par champ : **NON VÉRIFIÉ** (aucun texte trouvé).
- **Possible techniquement :** chiffrer ces champs comme les notes. Coût : la recherche ne pourrait plus porter sur leur contenu, ce qu'elle ne fait pas aujourd'hui. Sinon, consigne aux cabinets : le médical va dans les notes médicales.
- **Votre choix :** chiffrer ou former. Attendre d'abord la réponse de l'hébergeur sur le chiffrement au repos.
- **Juriste :** non bloquant.

### E13 — Adresse IP des postes dans les journaux de l'API

- **En clair :** chaque requête journalisée contient l'adresse IP du poste du cabinet, conservée chez l'hébergeur 7 jours (Hobby) ou 30 jours (Pro). DOC. FOURNISSEUR LUE.
- **Risque :** faible. C'est une donnée du personnel, pas des patients.
- **Obligation juridique :** inconnue ; la finalité de sécurité est plausible (INTERPRÉTATION).
- **Possible techniquement :** retirer l'adresse IP de nos journaux. Elle reste dans les sessions et l'audit, et l'hébergeur la garde de toute façon dans ses journaux HTTP (E19).
- **Votre choix :** garder (diagnostic de sécurité) ou retirer.
- **Juriste :** non nécessaire.

### E14 — Accès de l'exploitant non tracés dans le journal du cabinet

- **En clair :** quand nous lançons une commande d'administration (export, suspension, purge), le journal d'audit du cabinet n'en garde pas trace. Seul le registre d'exploitation, tenu à la main, en garde trace.
- **Risque :** moyen. Il faut prouver au cabinet qui a accédé à ses données et quand.
- **Obligation juridique :** inconnue. Le projet de contrat (article 5) prévoit un registre.
- **Possible techniquement :** chaque commande inscrit une ligne au journal d'audit du cabinet (acteur « exploitation », action, sans contenu). Cela demande une nouvelle action d'audit et son libellé.
- **Votre choix :** trace automatique, ou registre manuel seulement.
- **Juriste :** non bloquant.

### E15 — Information du personnel et comptes désactivés

- **En clair :**
  - le personnel des cabinets n'a pas de notice sur ses propres données : compte, connexions, actions, adresse IP ;
  - un compte désactivé est gardé sans limite.
- **Risque :** faible.
- **Obligation juridique :** article 5, information de toute personne concernée : SOURCE SECONDAIRE ; durée pour les comptes : NON VÉRIFIÉ.
- **Possible techniquement :** notice « personnel » sur le modèle de la notice patients ; durée de revue pour les comptes désactivés.
- **Votre choix :** rédiger la notice personnel maintenant ou après la relecture de la notice patients.
- **Juriste :** relire avec la notice patients.

### E16 — Comptes communs à plusieurs cabinets

- **En clair :** un même compte (e-mail, mot de passe) peut travailler pour plusieurs cabinets. L'authentification est gérée par nous, pour tous.
- **Risque :** faible. Qualification juridique floue.
- **Obligation juridique :** **NON VÉRIFIÉ**. Sommes-nous responsable du traitement pour ces données d'authentification ?
- **Possible techniquement :** rien à changer tant que la qualification n'est pas tranchée.
- **Votre choix :** aucun pour l'instant.
- **Juriste :** **oui** (question 6 du dossier).

### E17 — Notification d'une violation de données

- **En clair :** aucune procédure écrite pour prévenir un cabinet en cas de fuite ou d'intrusion.
- **Risque :** moyen. Réaction lente ou désordonnée le jour où cela arrive.
- **Obligation juridique :** obligation légale de notification **NON VÉRIFIÉ** (rien trouvé dans la loi 09-08). Le projet de contrat prévoit 48 heures, durée à décider.
- **Possible techniquement :** une procédure d'incident d'une page (détection, qualification, information du cabinet, preuves, mesures).
- **Votre choix :** délai contractuel ; qui prévient le cabinet.
- **Juriste :** confirmer s'il existe une obligation légale de notification (CNDP, loi 05-20 pour les entités concernées).

### E18 — Le rôle Administrateur lit les notes médicales *(trouvé lors de cette relecture)*

> **Décidé et appliqué le 2026-10-02 (choix le plus restrictif pour le MVP)** : notes réservées au rôle Dentiste et à l'administrateur dont le compte est lié à un praticien **actif** du cabinet. La secrétaire et l'administrateur non soignant n'y ont pas accès. La question 9 au juriste reste ouverte.

- **En clair :** l'administrateur du cabinet a toutes les permissions, dont la lecture et l'écriture des notes médicales (`packages/shared/src/permissions.ts`). Nos documents précédents disaient « réservées au dentiste » : c'était **faux**, ils sont corrigés.
- **Risque :** moyen si l'administrateur n'est pas soignant (gérant, assistant). Il lit des notes de santé.
- **Obligation juridique :**
  - **NON VÉRIFIÉ** ;
  - l'article 26 imposerait le secret à toute personne ayant connaissance des données (SOURCE SECONDAIRE) ;
  - l'accès d'un non-soignant aux notes médicales reste une question de déontologie et de loi.
- **Possible techniquement :**
  - réserver les notes aux dentistes, mais un dentiste-gérant qui a le rôle Administrateur perdrait l'accès ;
  - ou n'autoriser l'administrateur que s'il est lui-même praticien (compte relié à un praticien) ;
  - dans les deux cas : modification des permissions, de leurs tests et des parcours de bout en bout.
- **Votre choix :** **oui**. Qui gère vos cabinets types : un dentiste ou un gérant ?
- **Juriste :** **oui**. Un administrateur non soignant peut-il lire les notes médicales ?

### E19 — Journaux HTTP de l'hébergeur *(trouvé lors de cette relecture)*

> **Corrigé le 2026-10-02** : `POST /api/patients/search` et `POST /api/patients/duplicates`, texte dans le corps ; la recherche rapide passe le terme à la page Patients par l'état de navigation. Tests : HTTP (anciennes formes GET refusées, journaux sans le texte), interface, et parcours de bout en bout (aucune adresse demandée ne contient un nom saisi).

- **En clair :** le proxy de Railway journalise chaque requête : adresse IP, navigateur, chemin (DOC. FOURNISSEUR LUE). Notre recherche de patients passe le texte cherché dans l'adresse (`?q=…`). Si Railway enregistre cette partie de l'adresse (**NON VÉRIFIÉ**, question posée), des noms de patients seraient dans ses journaux pendant 7 à 30 jours. Nous avions supprimé le journal d'accès de Caddy précisément pour cette raison.
- **Risque :** moyen à élevé si c'est le cas. Des données de santé (« X est patient du cabinet ») finiraient dans des journaux d'un tiers, hors de notre contrôle.
- **Obligation juridique :** pas de texte précis trouvé ; principes de sécurité (articles 23 et 24) et de minimisation : SOURCE SECONDAIRE et INTERPRÉTATION.
- **Possible techniquement :** faire passer le texte cherché dans le corps d'une requête POST, ou dans un en-tête, au lieu de l'adresse. Cela modifie l'API, l'interface et leurs tests. Le changement est utile **quel que soit l'hébergeur**.
- **Votre choix :** **oui**. Corriger maintenant par précaution, ou attendre la réponse de Railway.
- **Juriste :** non nécessaire pour décider de la correction.

### E20 — Sous-traitant de l'hébergeur pour l'archive de restauration *(trouvé lors de cette relecture)*

- **En clair :** l'archive de restauration à un instant donné est écrite dans un « bucket » Railway, opéré par **Tigris** (DOC. FOURNISSEUR LUE). Tigris n'apparaissait pas dans notre liste de sous-traitants.
- **Risque :** faible. C'est un oubli documentaire : la région du bucket se choisit à sa création.
- **Obligation juridique :** article 23, choix et encadrement des sous-traitants (SOURCE SECONDAIRE).
- **Possible techniquement :** ajouté à l'annexe 4 du contrat et à l'inventaire. Choisir une région UE à la création du bucket (procédure de déploiement).
- **Votre choix :** aucun.
- **Juriste :** non.

## 2. Purges techniques en place

| Règle | En place depuis | Nature | Obligation juridique | Appréciation |
|---|---|---|---|---|
| **Sessions terminées supprimées après 30 jours** (adresse IP, navigateur, horodatages) | Phase 9 ; plancher de 30 jours inscrit dans la sécurité de la base (migration 0018) | **Purement technique** : sécurité (enquête sur une connexion suspecte récente) et minimisation | Aucune durée imposée trouvée (NON VÉRIFIÉ) ; seul le principe de l'article 3 s'applique (SOURCE SECONDAIRE) | **Arbitraire mais raisonnable.** Assez long pour enquêter sur un incident signalé dans le mois, assez court pour ne pas garder l'historique des connexions du personnel |
| **Brouillons d'import supprimés après 24 heures** (copie complète d'un fichier analysé mais jamais validé) | Phase 3 | **Purement technique** : minimisation d'une copie qui n'est jamais entrée dans le dossier | Aucune (NON VÉRIFIÉ) | **Arbitraire mais raisonnable**, et protecteur : la donnée la plus volumineuse et la moins utile disparaît vite |

Aucune des deux n'est une obligation légale, et aucune n'est modifiée. La conservation pour litige les suspend déjà. Vous pouvez demander de les désactiver ou d'en changer la durée ; la durée des sessions ne peut pas descendre sous 30 jours sans nouvelle migration.
