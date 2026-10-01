# Loi 09-08, CNDP, CGI : statut de chaque affirmation

> **À faire valider par un juriste marocain avant utilisation.** Ce document n'est pas un avis juridique.

- **Mise à jour :** 2026-10-01, seconde passe.
- **Statuts utilisés**, pour chaque affirmation juridique :
  - **TEXTE OFFICIEL VÉRIFIÉ** : texte officiel lu directement ;
  - **SOURCE SECONDAIRE** : extrait renvoyé par un moteur de recherche (d'une page officielle ou d'un site tiers) ou site tiers. Le texte peut être reformulé ou déformé ;
  - **INTERPRÉTATION** : raisonnement de notre part, à faire confirmer ;
  - **NON VÉRIFIÉ** : introuvable, contradictoire ou inconnu.
- Pour les faits techniques sur un fournisseur, deux statuts distincts :
  - **DOC. FOURNISSEUR LUE** : documentation lue directement ;
  - **DOC. FOURNISSEUR (RECHERCHE)** : documentation connue par un extrait de recherche.

## Limite de cette passe

**Aucune affirmation n'a le statut TEXTE OFFICIEL VÉRIFIÉ.** Les domaines `cndp.ma`, `tax.gov.ma`, `sgg.gov.ma`, `adala.justice.gov.ma`, `dgssi.gov.ma` et les copies du texte restent refusés par la politique réseau de l'environnement (vérifié le 2026-10-01). Pour lever cette limite : ouvrir l'accès à ces domaines, ou faire lire les textes de la section « À lire en priorité » par le juriste.

## 1. Article 22 : déclaration ou autorisation pour les données de santé

| Affirmation | Statut | Source |
|---|---|---|
| Les données relatives à la santé sont des données sensibles (article 1) | SOURCE SECONDAIRE | Extrait du texte publié sur cndp.ma ; sites tiers concordants |
| Le traitement de données sensibles relève de l'autorisation préalable (articles 12 et 21) | SOURCE SECONDAIRE | Extraits concordants |
| **Article 22** : par dérogation à l'article 21, un traitement de données de santé relève de la **déclaration** s'il a **pour seule finalité** la médecine préventive, les diagnostics médicaux, l'administration de soins ou de traitements ou la gestion des services de santé, **et** s'il est mis en œuvre par un praticien soumis au secret professionnel ou par une autre personne soumise à une obligation de secret | SOURCE SECONDAIRE | Extrait du texte de cndp.ma, deux recherches concordantes. Des éditeurs de logiciels médicaux affirment au contraire qu'une autorisation est toujours requise : **contradiction non tranchée** |
| La CNDP a adopté le **28/11/2025** la délibération **D-941-2025**, « modèle de demande d'autorisation type pour les traitements de suivi des patients » (formulaire F-113 ; pièces : documents de collecte avec mentions types, modèle de lettre de consentement aux patients) | SOURCE SECONDAIRE | Page « La CNDP publie de nouvelles délibérations » (cndp.ma), via recherche ; texte de la délibération non lu |
| D-941-2025 ferait relever le suivi des patients d'un cabinet d'une **autorisation** (modèle type) plutôt que de la déclaration de l'article 22 | **NON VÉRIFIÉ** | Contenu et champ (« suivi des patients ») inconnus : question 1 du [dossier juriste](dossier-juriste.md) |
| Notre SaaS entre dans l'exception de l'article 22 | **INTERPRÉTATION**, non tranchée | Pour : agenda, dossier et encaissements relèvent plausiblement de l'administration des soins et de la gestion des services de santé. Contre, ou incertain : « pour seule finalité » (tableau de bord financier ?) ; l'éditeur et l'hébergeur sont-ils des « personnes soumises à une obligation de secret » ? |
| La formalité incombe au cabinet (responsable du traitement), pas à l'éditeur | INTERPRÉTATION | Logique des articles 12 et 23 ; à confirmer |

## 2. Article 23 (et 24, 26) : sous-traitant

| Affirmation | Statut | Source |
|---|---|---|
| Article 23 : le responsable met en œuvre les mesures techniques et organisationnelles appropriées ; il choisit un sous-traitant offrant des garanties suffisantes et veille à leur respect | SOURCE SECONDAIRE | Extrait du texte publié sur cndp.ma |
| Article 23 : la sous-traitance est régie par un **contrat ou acte juridique** qui lie le sous-traitant au responsable et prévoit **notamment** que le sous-traitant **n'agit que sur instruction** et que les obligations de sécurité lui incombent aussi | SOURCE SECONDAIRE | Idem |
| Contenu « nécessaire » du contrat au-delà de ces deux points | **NON VÉRIFIÉ** | La loi dit « notamment ». La CNDP publie des **mentions types de sous-traitance** (sécurité, instructions, pas de sous-traitant ultérieur sans autorisation expresse et contrat validé), page cndp.ma non lue intégralement |
| Article 24 : mesures particulières pour les données sensibles et de santé, dont l'interdiction d'accès aux installations à toute personne non autorisée | SOURCE SECONDAIRE | Extrait du texte publié sur cndp.ma |
| Article 26 : secret professionnel du responsable et des personnes qui, dans l'exercice de leurs fonctions, ont connaissance des données traitées, même après la fin de leurs fonctions | SOURCE SECONDAIRE | Idem |
| Article 26 suffit à faire de notre personnel des « personnes soumises à une obligation de secret » au sens de l'article 22 | **INTERPRÉTATION**, à confirmer | Raisonnement : l'article 26 viserait toute personne ayant connaissance des données ; question 2 du dossier juriste |

## 3. Transfert hors du Maroc

| Affirmation | Statut | Source |
|---|---|---|
| Article 43 : transfert vers un État étranger seulement s'il assure un niveau de protection suffisant | SOURCE SECONDAIRE | Extraits concordants |
| Article 44 : dérogations, dont le **consentement exprès** de la personne, et l'**autorisation expresse** de la CNDP si le traitement garantit une protection suffisante | SOURCE SECONDAIRE | Pages cndp.ma via recherche |
| Le consentement ne couvre pas raisonnablement un hébergement à l'étranger | INTERPRÉTATION (d'un avocat, site tiers) | avocat-jawhari.com |
| Procédure : **formulaire de demande de transfert à l'étranger** ; transfert autorisé seulement après **accord explicite** (récépissé de transfert) ; la CNDP n'examine la demande qu'après avoir autorisé ou reçu la déclaration du traitement de base | SOURCE SECONDAIRE | Pages cndp.ma « Transfert de données à l'étranger », « Notifier une demande de transfert » |
| Une demande de transfert est requise en cas d'**hébergement ou de stockage sur des serveurs situés hors du territoire national** | SOURCE SECONDAIRE | Idem |
| Pays assurant une protection suffisante : délibération CNDP n° 236-2015 du 18/12/2015 (modifiant la n° 465-2013). Liste citée par le résumé : une trentaine d'États européens (dont les **Pays-Bas**, l'**Allemagne** et la France ; aussi Norvège, Islande, Liechtenstein, Royaume-Uni, Suisse) et le Canada ; **pas les États-Unis** | SOURCE SECONDAIRE | Résumé de la délibération ; **mise à jour depuis 2015 non vérifiée** |
| Sauvegardes, journaux et accès technique à distance (support) à l'étranger sont des transferts au même titre que l'hébergement principal | **INTERPRÉTATION** | Raisonnement : « hébergement ou stockage » couvre les sauvegardes et les journaux. Un accès à distance pour lire des données hébergées au Maroc reste à qualifier (question 4) |
| Le **décret n° 2-24-921** (22/10/2024) impose aux « entités » et aux infrastructures d'importance vitale (IIV) des prestataires cloud qualifiés par la DGSSI. Niveau 2 pour les « données sensibles » au sens de la loi 05-20 : hébergement au Maroc, prestataire de droit marocain à capitaux majoritairement marocains | SOURCE SECONDAIRE | Pages dgssi.gov.ma, anrt.ma, sgg.gov.ma via recherche |
| Dans la loi 05-20, « entité » désigne les administrations de l'État, les collectivités territoriales, les établissements et entreprises publics et toute personne morale de droit public | SOURCE SECONDAIRE | Sites tiers |
| Un cabinet dentaire privé n'est ni une « entité » ni une IIV, donc le décret 2-24-921 ne s'applique pas à lui | **INTERPRÉTATION** | Les IIV sont désignées par l'État ; un cabinet privé n'en fait vraisemblablement pas partie. Un site tiers affirme au contraire que les lois 09-08 et 05-20 interdiraient tout hébergement de données sensibles hors du Maroc. C'est incompatible avec la procédure de transfert de la CNDP : question 5 |
| Aucun prestataire cloud n'est encore qualifié par la DGSSI | SOURCE SECONDAIRE | Résumé de la page dgssi.gov.ma « prestations et produits réglementés » |

## 4. Durées de conservation

| Donnée | Affirmation | Statut |
|---|---|---|
| Toutes | Article 3 : conservation sous forme identifiante pendant une durée n'excédant pas celle nécessaire aux finalités | SOURCE SECONDAIRE |
| Dossier patient (dentaire) | Aucune durée marocaine trouvée. Loi 07-05 (Ordre des médecins dentistes) et code de déontologie : non lus. La durée française de 20 ans n'est pas une source marocaine | **NON VÉRIFIÉ** |
| Données administratives (identité, contacts) | Pas de durée propre trouvée ; elles suivent vraisemblablement celle du dossier | INTERPRÉTATION |
| Données financières | CGI, article 211 (ci-dessous) | SOURCE SECONDAIRE |
| Journaux d'audit, journaux techniques | Aucune durée légale trouvée : durées à justifier par la finalité (article 3) | NON VÉRIFIÉ (absence de texte) ; nos durées sont des **propositions** |
| Sessions | Aucune durée légale trouvée ; 30 jours est un choix technique | NON VÉRIFIÉ (absence de texte) |

## 5. CGI, article 211

| Affirmation | Statut | Source |
|---|---|---|
| Durée : **dix ans**, au lieu d'imposition | SOURCE SECONDAIRE | fiscamaroc.com et plusieurs cabinets comptables concordants |
| Documents : doubles des factures de vente ou tickets de caisse ; pièces justificatives des dépenses et investissements ; documents comptables nécessaires au contrôle fiscal (livres, grand livre, livre d'inventaire, inventaires détaillés) ; support électronique si la comptabilité est électronique | SOURCE SECONDAIRE | Idem |
| Débiteurs de l'obligation : les contribuables et les personnes chargées de la retenue à la source, soit **le cabinet**, pas l'éditeur | SOURCE SECONDAIRE (texte) ; INTERPRÉTATION (application au cabinet) | Idem |
| **Point de départ** des dix ans | **NON VÉRIFIÉ** | Aucun extrait marocain trouvé. Les extraits « à compter de la clôture de l'exercice » viennent du droit français et ne valent pas pour le Maroc |
| Documents de notre SaaS concernés | **INTERPRÉTATION** | L'application ne produit ni facture ni ticket de caisse et ne tient pas la comptabilité. Elle enregistre des actes et des encaissements (montant, mode, référence facultative, sans donnée bancaire). Ce sont au mieux des éléments de suivi qui peuvent servir de justificatif ; la qualification revient au juriste ou à l'expert-comptable (question 8) |

## À lire en priorité (liens officiels, inaccessibles depuis l'environnement)

1. Loi 09-08, articles 1, 3, 5, 7 à 9, 12, 21 à 24, 26, 43, 44 :
   - [texte sur cndp.ma](https://www.cndp.ma/wp-content/uploads/2023/11/Loi-09-08-Fr.pdf) ;
   - [texte sur adala.justice.gov.ma](https://adala.justice.gov.ma/api/uploads/2024/04/30/Protection%20des%20personnes%20physiques-1714464099884.pdf).
2. Délibération CNDP D-941-2025 (suivi des patients) : [annonce des nouvelles délibérations](https://www.cndp.ma/la-cndp-publie-de-nouvelles-deliberations/), [nouvelles délibérations](https://www.cndp.ma/nouvelles-deliberations-1/).
3. CNDP, mentions types de sous-traitance : [page](https://cndp.ma/fr/responsabilites/mentions-types/sous-traitance.html).
4. CNDP, transfert à l'étranger :
   - [présentation](https://www.cndp.ma/transfert-de-donnees-a-letranger/) ;
   - [formulaire](https://www.cndp.ma/wp-content/uploads/2023/12/CNDP-Transfert-Etranger.pdf) ;
   - [délibération 236-2015](https://www.cndp.ma/wp-content/uploads/2023/12/deliberation-n-236-2015-18-12-2015.pdf).
5. Décret 2-24-921 : [texte (DGSSI)](https://www.dgssi.gov.ma/sites/default/files/legislative/brochure/2025-04/DECREE%202.24.921%20FR%20.pdf). Loi 05-20 : [texte (DGSSI)](https://www.dgssi.gov.ma/sites/default/files/legislative/brochure/2023-03/loi%2005-20.pdf).
6. CGI, article 211 : édition en vigueur sur tax.gov.ma ; copie secondaire : [fiscamaroc.com](https://www.fiscamaroc.com/dispositions-communes-208/conservation-documents-comptables-316.htm).
7. Loi 07-05 et code de déontologie des médecins dentistes : [SGG, professions réglementées](https://www.sgg.gov.ma/ProfessionsReglementees.aspx).

Sites tiers consultés (statut SOURCE SECONDAIRE) :
- [tabibdoc.ma (guide cabinets médicaux)](https://tabibdoc.ma/blog/guide-complet-conformite-cndp-cabinet-medical) ;
- [avocat-jawhari.com (transfert)](https://avocat-jawhari.com/2023/01/30/transfert-des-donnees-a-caractere-personnel-du-maroc-a-letranger/) ;
- [village-justice.com (décret 2-24-921)](https://www.village-justice.com/articles/hebergement-local-cloud-international-lecture-decret-921-sur-les-prestataires,53000.html) ;
- [nindohost.ma (référentiel cloud)](https://nindohost.ma/blog/referentiel-qualification-cloud-maroc/).
