# Loi 09-08 et CGI : vérification des éléments préliminaires

- **Date :** 2026-10-01.
- **Nature :** éléments préliminaires à faire valider par un juriste marocain. Rien ici n'est un avis juridique, et rien ne déclare le SaaS « conforme ».

## Limite de la vérification (à lire d'abord)

**Aucun texte officiel n'a pu être lu en entier depuis l'environnement de travail.** Les domaines suivants y sont refusés par la politique réseau :
- `cndp.ma` ;
- `tax.gov.ma` (CGI) ;
- `sgg.gov.ma` (Bulletin officiel) ;
- `adala.justice.gov.ma` ;
- les copies du texte (Bourse de Casablanca, WIPO Lex).

Ce qui suit vient donc de **résumés et d'extraits de pages renvoyés par un moteur de recherche**. Certains portent sur les pages officielles elles-mêmes, d'autres sur des sources secondaires (cabinets d'avocats, éditeurs, blogs). Un résumé de moteur de recherche peut déformer un article ; deux d'entre eux se contredisent sur l'article 22.

Statuts utilisés :
- **Concordant, texte non lu** : plusieurs sources vont dans le même sens, mais le texte officiel n'a pas été lu ;
- **Contradictoire** : les sources divergent ;
- **Non trouvé** : aucune source consultée ne répond.

Pour lever ces réserves : lire les textes officiels listés en fin de document. Le juriste peut le faire, ou le porteur du projet en ouvrant l'accès à ces domaines dans les réglages réseau de l'environnement.

## 1. Déclaration ou autorisation CNDP

| Élément | Ce que disent les sources consultées | Statut |
|---|---|---|
| Données de santé = données sensibles (article 1) | Les données « relatives à la santé » figurent dans la définition des données sensibles | Concordant, texte non lu |
| Régime général (article 12) | Déclaration préalable en règle générale, autorisation préalable pour certains traitements | Concordant, texte non lu |
| Données sensibles (article 21) | Autorisation préalable de la CNDP | Concordant, texte non lu |
| **Exception (article 22)** | Un extrait, cohérent avec votre note, la formule ainsi : par dérogation à l'article 21, un traitement de données de santé relève de la **déclaration** s'il a **pour seule finalité** la médecine préventive, le diagnostic, l'administration de soins ou de traitements ou la **gestion des services de santé**, et s'il est mis en œuvre par un praticien soumis au secret professionnel ou par une autre personne soumise à une obligation de secret. D'autres résumés (éditeurs de logiciels médicaux) affirment au contraire qu'une **autorisation** est requise pour toute donnée de santé | **Contradictoire** : le texte de l'article 22 est à lire |

### Notre fonctionnement entre-t-il dans l'exception ?

Analyse préliminaire, à valider, sous réserve que l'article 22 dise bien ce que rapporte l'extrait.

- **Arguments pour :**
  - le produit sert à l'agenda, au dossier patient, aux notes médicales, aux encaissements et au pilotage du cabinet ;
  - ces usages relèvent plausiblement de l'administration de soins et de la gestion des services de santé ;
  - le traitement est mis en œuvre par le cabinet, dont le praticien est soumis au secret ;
  - le périmètre exclut toute prospection, tout agent IA et toute messagerie (CLAUDE.md, `docs/future/`).
- **Points qui pourraient l'en faire sortir :**
  - **« pour seule finalité »** : le tableau de bord financier (revenus, encaissements par praticien) est-il de la « gestion des services de santé » ? Toute finalité ajoutée plus tard ferait sortir le traitement de l'exception : relances commerciales, statistiques entre cabinets, entraînement de modèles, messagerie ;
  - **« personne soumise à une obligation de secret »** : notre personnel (exploitation, support) n'est pas soumis au secret médical par la loi. Une obligation de confidentialité contractuelle suffit-elle ? Question pour le juriste ;
  - **le transfert à l'étranger** relève de formalités distinctes (section 3), même si l'exception s'applique.
- **Conclusion provisoire :** l'exception est plausible pour le traitement du cabinet, **pas acquise**. Aucune décision n'est prise dans le produit sur cette base.

### Qui déclare ?

D'après les sources consultées, la déclaration ou l'autorisation incombe au **responsable du traitement**, donc à chaque cabinet. Nous lui fournissons les éléments techniques : finalités, catégories de données, mesures de sécurité, sous-traitants, pays, durées. Une annexe type est à joindre au contrat.

## 2. Responsable du traitement et sous-traitant

| Élément | Sources consultées | Statut |
|---|---|---|
| Définitions (article 1) : le responsable détermine les finalités et les moyens ; le sous-traitant traite pour son compte | Concordant | Concordant, texte non lu |
| Article 23 : mesures techniques et organisationnelles ; choix d'un sous-traitant offrant des garanties suffisantes ; **contrat** qui lie le sous-traitant, qui n'agit **que sur instruction** du responsable et à qui les obligations de sécurité s'appliquent aussi | Concordant (texte de loi via moteur de recherche, sources secondaires) | Concordant, texte non lu |

### Répartition selon les usages réels (inventaire du code, `inventaire-et-ecarts.md`)

- **Cabinet = responsable** des dossiers patients, rendez-vous, notes, encaissements et du journal d'audit de son cabinet. Il décide des finalités ; nous n'utilisons pas ces données pour notre compte : aucune statistique entre cabinets, aucune réutilisation.
- **Notre entreprise = sous-traitant** pour ces traitements, à condition de n'agir que sur instruction, ce que le contrat doit écrire.
- **Zones grises à trancher :**
  - les **comptes du personnel** sont communs à la plateforme : un même compte peut appartenir à plusieurs cabinets (`users`, `clinic_memberships`), et nous gérons l'authentification. Pour ces données d'authentification, sommes-nous responsables du traitement ?
  - les **journaux techniques** (adresse IP des postes, `apps/server/src/config/logger.ts`) servent à la sécurité de la plateforme, qui est notre finalité propre ;
  - l'**exploitation** : sauvegardes, support, commandes d'administration.

## 3. Hébergement hors du Maroc

| Élément | Sources consultées | Statut |
|---|---|---|
| Article 43 : transfert seulement vers un État assurant un niveau de protection suffisant | Concordant | Concordant, texte non lu |
| Article 44 : dérogations, dont le **consentement exprès** de la personne et l'**autorisation** de la CNDP si des garanties suffisantes sont apportées. Selon une source secondaire, ces dérogations s'interprètent strictement : le consentement ne couvre pas raisonnablement un simple hébergement | Concordant pour le principe ; interprétation non vérifiée | Concordant, texte non lu |
| Liste des États assurant une protection suffisante : délibération CNDP n° 236-2015 du 18 décembre 2015 (modifiant la n° 465-2013). Selon le résumé, elle comprend notamment les **Pays-Bas**, l'**Allemagne** et la France, mais **pas les États-Unis** | Page CNDP via moteur de recherche | Concordant, texte non lu ; **mise à jour de la liste depuis 2015 non vérifiée** |
| Procédure CNDP : **formulaire de demande de transfert à l'étranger** ; l'autorisation n'est accordée que si le traitement sous-jacent a été déclaré ou autorisé. Selon la page CNDP, un hébergement sur des serveurs à l'étranger impose une demande de transfert. Pièces jointes : clauses contractuelles, références du récépissé ou de l'autorisation, etc. | Pages et formulaire CNDP via moteur de recherche | Concordant, texte non lu |
| « Accord exprès de la Commission » (votre note) | Cohérent avec la page CNDP : autorisation « expresse » pour un pays hors liste | Concordant, texte non lu |

Ce que cela implique pour nous, flux par flux : section « Transferts » de `inventaire-et-ecarts.md`. En résumé :
- hébergement principal aux Pays-Bas (pays de la liste) par une société américaine ;
- sauvegardes et journaux dont la localisation n'est pas vérifiée ;
- Sentry dans l'UE (sans donnée personnelle par conception) ;
- un accès de support depuis l'étranger serait aussi un transfert.

## 4. Conservation

| Élément | Sources consultées | Statut |
|---|---|---|
| Article 3 : données conservées sous une forme identifiante pendant une durée n'excédant pas celle nécessaire aux finalités | Concordant | Concordant, texte non lu |
| **Dossier médical d'un cabinet dentaire** : durée légale marocaine | Aucune source consultée n'en fixe une. Le code de déontologie des médecins dentistes (loi 07-05, décret d'application) n'a pas pu être lu. **La durée française de 20 ans n'est pas appliquée** | **Non trouvé** |
| **CGI, article 211** : conservation pendant **dix ans**, au lieu d'imposition, des doubles des factures de vente ou tickets de caisse, des pièces justificatives des dépenses et investissements et des documents comptables nécessaires au contrôle fiscal. Support électronique si la comptabilité est tenue électroniquement | Plusieurs sources secondaires concordantes (dont fiscamaroc.com) ; site de la DGI inaccessible | Concordant, texte non lu |
| Point de départ des dix ans | Non précisé dans les extraits | **Non trouvé** |
| Portée pour nous | L'obligation pèse sur le **cabinet contribuable**, pour ses documents comptables. Les actes et encaissements de l'application ne sont pas des factures. Rien ne justifie de conserver dix ans des **données bancaires** : l'application n'en enregistre aucune (mode de paiement et référence facultative seulement) | Analyse, à valider |
| Journaux techniques et d'audit | Aucune durée légale trouvée : durées à **justifier par leur finalité** (article 3), sans les présenter comme des obligations | Principe concordant |

## 5. Droits et information des personnes (pour la notice)

| Élément | Sources consultées | Statut |
|---|---|---|
| Article 5 : informer la personne lors de la collecte (identité du responsable, finalités, destinataires, caractère obligatoire ou facultatif des réponses, droits d'accès, de rectification et d'opposition) | Lignes directrices CNDP (sites web) et sources secondaires | Concordant, texte non lu |
| Article 7 : droit d'accès | Concordant | Concordant, texte non lu |
| Article 8 : rectification, effacement ou verrouillage des données non conformes ; correction gratuite **dans un délai de dix jours** | Une source secondaire | À vérifier |
| Article 9 : opposition pour motifs légitimes ; opposition sans frais à la prospection | Concordant | Concordant, texte non lu |
| Violation de données : obligation légale de notification | Non trouvée dans les sources consultées. Elle est prévue **contractuellement** dans le projet de contrat | Non trouvé |

## Textes à lire en priorité (liens officiels, inaccessibles depuis l'environnement)

1. Loi n° 09-08 :
   - [texte français, site de la CNDP](https://www.cndp.ma/wp-content/uploads/2023/11/Loi-09-08-Fr.pdf) ;
   - [texte, ministère de la Justice (Adala)](https://adala.justice.gov.ma/api/uploads/2024/04/30/Protection%20des%20personnes%20physiques-1714464099884.pdf).

   Articles 1, 3, 5, 7 à 9, 12, 21, 22, 23, 24, 43 et 44.
2. Décret n° 2-09-165 (application de la loi 09-08) : non localisé dans les résultats.
3. CNDP :
   - [Formalités](https://www.cndp.ma/formalites/) ;
   - [Notifier une demande de transfert à l'étranger](https://www.cndp.ma/notifier-une-demande-de-transfert-a-letranger/) ;
   - [formulaire de transfert](https://www.cndp.ma/wp-content/uploads/2023/12/CNDP-Transfert-Etranger.pdf) ;
   - [demande d'autorisation préalable (F113)](https://www.cndp.ma/wp-content/uploads/2025/09/CNDP-Autorisation-Prealable-Conformement-Decision-F113-20250910.pdf) ;
   - [procédure de notification des traitements](https://www.cndp.ma/wp-content/uploads/2025/07/CNDP_Procedure-de-Notification-des-traitements_20250724.pdf) ;
   - [délibération n° 236-2015 (pays)](https://www.cndp.ma/wp-content/uploads/2023/12/deliberation-n-236-2015-18-12-2015.pdf) ;
   - [Sécurité du SI](https://www.cndp.ma/securite-du-si/) ;
   - [infractions et sanctions](https://www.cndp.ma/wp-content/uploads/2024/03/CNDP-loi-09-08-Liste-des-infractions-sanctions-fr.pdf).
4. Code général des impôts, article 211 : édition en vigueur, sur le site de la DGI (tax.gov.ma). Copie secondaire consultée : [fiscamaroc.com](https://www.fiscamaroc.com/dispositions-communes-208/conservation-documents-comptables-316.htm).
5. Dossier médical : loi n° 07-05 relative à l'Ordre national des médecins dentistes et code de déontologie des médecins dentistes (Secrétariat général du gouvernement, [professions réglementées](https://www.sgg.gov.ma/ProfessionsReglementees.aspx)), ou position de l'Ordre.

Sources secondaires consultées (résumés, pour mémoire) :
- [tabibdoc.ma : loi 09-08 et données médicales](https://tabibdoc.ma/blog/reglementation-donnees-medicales-maroc-loi-09-08) ;
- [avocat-jawhari.com : transfert à l'étranger](https://avocat-jawhari.com/2023/01/30/transfert-des-donnees-a-caractere-personnel-du-maroc-a-letranger/) ;
- [village-justice.com : la CNDP](https://www.village-justice.com/articles/cadre-leadership-africain-cndp-comme-architecte-modele-marocain-gouvernance-des,55421.html) ;
- [LexisNexis Maroc : transfert non notifié](https://www.lexisma.info/2023/02/27/infraction-a-la-loi-n-09-08-communique-de-la-cndp-suite-a-labsence-de-notification-dun-transfert-de-donnees-personnelles-a-letranger/).
