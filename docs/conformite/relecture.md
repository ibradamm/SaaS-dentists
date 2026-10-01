# Relecture des documents de conformité (2026-10-01)

> **À faire valider par un juriste marocain avant utilisation.** Tous les documents de ce dossier sont des **projets**, pas des documents juridiques définitifs.

**Périmètre :**
- `contrat-sous-traitance-projet.md` ;
- `notice-information-patients-projet.md` ;
- `tableau-de-conservation.md` ;
- `inventaire-et-ecarts.md` ;
- `../operations/fin-de-contrat.md` ;
- `sources.md`.

**Méthode :** chaque affirmation confrontée au code (permissions, journaux, recherche) et à la documentation de l'hébergeur lue directement.

## 1. Erreurs et contradictions corrigées

| # | Constat | Où | Correction |
|---|---|---|---|
| R1 | « Notes médicales réservées au dentiste » est **faux** : le rôle administrateur a toutes les permissions, dont les notes (`packages/shared/src/permissions.ts`) | Contrat (annexe 2), notice, inventaire | Texte rectifié ; arbitrage ouvert (écart E18) |
| R2 | Les journaux de l'hébergeur étaient dits « sans donnée patient ». Le proxy de Railway journalise le chemin des requêtes, et le texte des recherches (`?q=nom`) y figure peut-être | Contrat (article 10.7), fin de contrat (section 3), tableau (ligne 8) | « Sans donnée patient » retiré ; point marqué NON VÉRIFIÉ ; question posée à Railway (écart E19) |
| R3 | Sous-traitant **Tigris** (archive de restauration de Railway) absent des listes | Contrat (annexe 4), inventaire | Ajouté |
| R4 | Annexe 2 : « Mesures en place, chacune vérifiée par des tests » couvrait aussi les sauvegardes de l'hébergeur, non vérifiées | Contrat | Annexe scindée : mesures du logiciel (testées) et mesures de l'hébergement (non vérifiées) |
| R5 | « Le cabinet n'enregistre aucun numéro de carte » : nous ne savons pas ce que le cabinet garde ailleurs | Notice | « Le logiciel du cabinet n'enregistre… » |
| R6 | Hébergement au Maroc « sans d'autres obligations » : affirmation trop forte (décret 2-24-921, accès de support) | Inventaire (E4) | Reformulé, renvoi aux questions 4 et 5 |
| R7 | La notice ne citait que l'hébergement principal, pas les sauvegardes ni les journaux | Notice | Ajoutés, lieux à confirmer |
| R8 | Durées de journaux « non vérifiées » alors que la documentation de Railway les donne | Tableau, inventaire | 7 jours (Hobby), 30 jours (Pro), DOC. FOURNISSEUR LUE |

## 2. Affirmations juridiques non vérifiées, désormais signalées

Statuts dans [sources.md](sources.md). Aucune n'a le statut TEXTE OFFICIEL VÉRIFIÉ.

| Affirmation | Document | Marquage ajouté |
|---|---|---|
| Données de santé = données sensibles | Contrat (article 3) | SOURCE SECONDAIRE, à vérifier |
| Les formalités CNDP incombent au cabinet | Contrat (article 8.2) | INTERPRÉTATION, à valider |
| Personnel de l'éditeur = « personne soumise à une obligation de secret » | Contrat (article 5) | Note au juriste, question 2 |
| Dix ans au titre de l'article 211, appliqués aux actes et encaissements | Tableau (ligne 2) | SOURCE SECONDAIRE pour la durée, INTERPRÉTATION pour l'application |
| Mentions de l'article 5 | Notice | Note au juriste |
| Délai de rectification de dix jours | Contrat (article 9) | Déjà « à confirmer » |
| Obligation de notifier une violation | Contrat (article 12) | Déjà « non trouvée, à vérifier » |

## 3. Clauses potentiellement trop affirmatives (à arbitrer par le juriste)

- **Article 7 (sous-traitants ultérieurs)** : autorisation **générale** avec préavis. Les mentions types de la CNDP prévoiraient une autorisation **expresse** pour chaque sous-traitant (SOURCE SECONDAIRE). Note ajoutée dans l'article.
- **Article 10.4** : suppression « de toutes les données » [30] jours après la remise. Elle exclut les sauvegardes, traitées au 10.5. Le juriste doit vérifier que cette formulation n'engage pas au-delà de ce que l'hébergement permet.
- **Article 10.5** : « au plus tard [89] jours ». Ce délai dépend des paramètres de l'hébergeur ; à confirmer par écrit (question 11 à Railway).
- **Article 11** : « le Sous-traitant réalise sur demande un export dédié » : coût et délai non fixés.
- **Article 12** : « dans les [48] heures » : délai à fixer selon ce que l'équipe peut réellement tenir.

## 4. Informations manquantes

- Identité de l'éditeur (raison sociale, RC, IF, ICE, adresse) et nom commercial du service.
- Lieu d'où l'équipe de l'éditeur accède aux données (Maroc ou non).
- Réponses de Railway et de Sentry ([demandes-fournisseurs.md](demandes-fournisseurs.md)).
- Contenu de la délibération CNDP D-941-2025 (suivi des patients) et, le cas échéant, son modèle de lettre de consentement.
- Notice pour le personnel des cabinets (écart E15).
- Procédure d'incident (écart E17).

## 5. Champs entre crochets restant à remplir

| Document | Qui remplit | Champs |
|---|---|---|
| Contrat | Éditeur | Raison sociale, forme, adresse, RC, IF, ICE, nom du service, date de l'annexe 2 |
| Contrat | Cabinet | Raison sociale, forme, adresse, représentant |
| Contrat | Vous, puis juriste | Délais : préavis des sous-traitants [30], restitution [15], suppression [30], sauvegardes [89], violation [48] ; conséquence d'une opposition ; frais (litige, audit) ; audit sur place |
| Contrat | Juriste | Article 14 (responsabilité), juridiction (article 15), portée de l'article 211 |
| Notice | Cabinet | Nom, adresse, téléphone, praticien, contact pour les droits, délai de réponse, caractère obligatoire des réponses, durée du dossier, numéro de déclaration ou d'autorisation CNDP |
| Notice | Juriste | Traduction arabe, mentions de l'article 5, lettre de consentement éventuelle |
| Tableau, fin de contrat | Vous, puis juriste | Délai [N] entre la fin du contrat et la suppression |
