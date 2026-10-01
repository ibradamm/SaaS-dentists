# Dossier pour avis juridique : logiciel de gestion de cabinet dentaire (Maroc)

> **À faire valider par un juriste marocain avant utilisation.** Ce dossier décrit le fonctionnement réel du logiciel. Il ne contient aucune conclusion juridique : les questions sont en fin de document.

- **Éditeur :** [raison sociale, contact].
- **Date :** 2026-10-01.
- **État :** produit développé et testé. **Aucun cabinet réel, aucune donnée réelle, aucune mise en production.**

## 1. Le logiciel en une page

**Ce que c'est.** Un logiciel en ligne (SaaS) pour gérer un cabinet dentaire. Le personnel du cabinet s'en sert depuis un navigateur. Aucun patient ne s'y connecte.

**Ce qu'il fait :**
- agenda et rendez-vous des praticiens ;
- fiche patient : identité, téléphones, e-mail, date de naissance ;
- **notes médicales** du praticien, chiffrées dans le logiciel ;
- actes réalisés et encaissements (montant, mode de paiement). Pas de facture, pas de comptabilité, pas de paiement en ligne, aucune donnée de carte bancaire ;
- tableau de bord du cabinet (activité, revenus) ;
- import d'une liste de patients depuis un ancien logiciel (fichier Excel ou CSV) ;
- comptes du personnel avec trois rôles : administrateur, dentiste, secrétaire ;
- journal de traçabilité : qui a fait quoi, quand, depuis quelle adresse IP.

**Ce qu'il ne fait pas :** ni messagerie (SMS, WhatsApp, e-mail), ni intelligence artificielle, ni partage entre cabinets, ni vente ou exploitation des données par l'éditeur.

**Plusieurs cabinets, une base.** Chaque cabinet ne voit que ses propres données. La séparation est appliquée par la base de données elle-même et vérifiée par des tests automatiques.

## 2. Architecture des données

```
Poste du cabinet (navigateur)
        │ HTTPS
        ▼
Hébergeur : proxy d'entrée ──► interface web ──► API (logique, contrôles d'accès)
                                                      │
                                                      ▼
                                             Base PostgreSQL unique
                                             (séparation par cabinet)
                                                      │
                                         Sauvegardes chez l'hébergeur
Remontée d'erreurs (Sentry, facultative) : erreurs techniques sans donnée personnelle
```

## 3. Données personnelles traitées

| Personnes | Données |
|---|---|
| Patients | Nom, prénom, date de naissance, e-mail, téléphones (le sien ou celui d'un proche), note administrative, rendez-vous, actes, encaissements |
| Proches d'un patient | Téléphone et lien (tuteur, autre) |
| Personnel du cabinet | Nom, e-mail, rôle, mot de passe (sous forme d'empreinte), double authentification, adresse IP et navigateur des connexions, actions tracées |

## 4. Données de santé traitées

- **Notes médicales** du praticien : chiffrées dans le logiciel. Lisibles par les rôles **dentiste** et **administrateur** ; chaque lecture est tracée.
- **Données qui révèlent un soin**, même sans note : le fait d'être patient du cabinet, le type de rendez-vous, le libellé des actes, les notes libres de rendez-vous. En clair dans la base, protégées par la séparation entre cabinets et les contrôles d'accès.

## 5. Rôles envisagés

- **Le cabinet** décide pourquoi les données sont traitées (soins, gestion du cabinet). Il serait **responsable du traitement**.
- **L'éditeur** fournit et héberge le logiciel pour le compte du cabinet, sans utiliser les données pour lui-même. Il serait **sous-traitant**. Un projet de contrat de sous-traitance est joint.
- **Cas à qualifier :**
  - un même compte du personnel peut travailler pour plusieurs cabinets, et l'éditeur gère l'authentification ;
  - l'éditeur conserve des journaux techniques (adresses IP) pour la sécurité du service.

## 6. Hébergement envisagé

Deux voies, **aucune n'est choisie**.

| Voie | Lieu des données | Société |
|---|---|---|
| Railway (prêt techniquement) | Pays-Bas (Amsterdam). Sauvegardes, archive de restauration et journaux : lieux exacts demandés au fournisseur | Railway Corporation (États-Unis) |
| Hébergeur au Maroc (à l'étude) | Maroc. Pistes : Oracle Cloud Casablanca, inwi, OVHcloud Local Zone Maroc | Selon l'option |

Pour les mêmes raisons, l'équipe de l'éditeur (exploitation, support) devrait accéder aux données depuis le Maroc ; à confirmer.

## 7. Sous-traitants envisagés (de l'éditeur)

| Sous-traitant | Rôle | Données | Pays |
|---|---|---|---|
| Railway Corporation (si retenu) | Hébergement : calcul, base, sauvegardes, journaux | Toutes | Pays-Bas ; siège aux États-Unis |
| Tigris (via Railway) | Stockage de l'archive de restauration | Toutes (archive de la base) | Région choisie à la création (UE prévue) |
| Functional Software Inc. (Sentry), facultatif | Erreurs techniques | Aucune donnée personnelle par conception | Allemagne (Francfort) ; certaines métadonnées de compte aux États-Unis |
| GitHub (Microsoft) | Code source et tests | **Aucune donnée réelle** (données fictives uniquement) | États-Unis |

## 8. Conservation actuelle

- **Rien n'est supprimé automatiquement sur la base d'une durée non validée.** Les durées envisagées sont seulement **mesurées** : un rapport indique ce qui les dépasse.
- Deux suppressions automatiques existent, toutes deux techniques, sans lien avec une obligation légale :
  - **sessions de connexion terminées** (adresse IP, navigateur) : supprimées après 30 jours ;
  - **fichiers d'import analysés mais jamais validés** : supprimés après 24 heures.
- Dossier patient : **aucune durée** n'est fixée, faute de règle marocaine identifiée.
- Actes et encaissements : la durée de dix ans de l'article 211 du CGI pourrait concerner le cabinet ; portée à confirmer.
- Sauvegardes chez l'hébergeur (Railway) : 6, 27 et 89 jours selon le type ; archive de restauration environ 4 semaines.
- Journaux de l'hébergeur : 7 ou 30 jours selon l'offre.
- **Gel pour litige** : sur instruction écrite ou décision de justice, toute suppression des données d'un cabinet est suspendue.

## 9. Fin de contrat : restitution et suppression

1. **Suspension** à la date de fin : plus aucun accès, données intactes.
2. **Restitution** : export complet du cabinet (fichier JSON lisible par un autre logiciel, notes médicales déchiffrées). Il est remis chiffré, avec accusé de réception ; l'éditeur supprime ensuite sa propre copie.
3. **Suppression** sur instruction, après un délai contractuel à fixer. Elle est refusée tant qu'un gel pour litige est posé.
4. **Sauvegardes** : les données y restent jusqu'à leur expiration (89 jours au plus) ; elles ne sont plus consultées. Après toute restauration d'urgence, la suppression est rejouée.
5. **Attestation** de suppression remise au cabinet.

## 10. Questions bloquantes

1. **Formalité CNDP du cabinet.** Pour ce traitement, chaque cabinet doit-il faire une **déclaration** (article 22) ou une **demande d'autorisation** (articles 12 et 21) ? La délibération CNDP D-941-2025 du 28/11/2025, « modèle de demande d'autorisation type pour les traitements de suivi des patients », s'applique-t-elle à un cabinet dentaire qui utilise ce logiciel ?
2. **Exception de l'article 22.** Si elle est envisageable : le tableau de bord financier et le journal de traçabilité sont-ils compatibles avec la condition « pour seule finalité » ? L'éditeur et l'hébergeur, liés par une clause de confidentialité et par l'article 26, sont-ils des « personnes soumises à une obligation de secret » ?
3. **Hébergement aux Pays-Bas.** Une demande de transfert à l'étranger est-elle nécessaire pour **chaque cabinet** ? Le projet de contrat suffit-il comme pièce, ou faut-il d'autres garanties ? Un consentement des patients est-il requis ou utile ?
4. **Flux annexes.** Les éléments suivants sont-ils des transferts distincts à déclarer, et un accès depuis un pays hors de la liste de la CNDP peut-il être autorisé ?
   - sauvegardes et journaux stockés hors du Maroc ;
   - accès technique de l'hébergeur depuis les États-Unis ;
   - un éventuel accès de l'équipe de l'éditeur depuis l'étranger.
5. **Hébergement au Maroc obligatoire ?** Le décret n° 2-24-921 (prestataires cloud qualifiés par la DGSSI) et la loi 05-20 s'appliquent-ils à un cabinet dentaire privé ou à l'éditeur, au point d'imposer un hébergement au Maroc ?
6. **Qualification des rôles.** Pour les comptes du personnel communs à plusieurs cabinets et pour les journaux techniques de sécurité, l'éditeur est-il responsable du traitement ? Si oui, quelles formalités pour l'éditeur lui-même ?
7. **Dossier dentaire.** Quelle durée de conservation et quel point de départ au Maroc ? Le cabinet peut-il, ou doit-il, effacer un dossier à la demande d'un patient (article 8) ?
8. **Article 211 du CGI.** Quel est le point de départ des dix ans ? Les actes et encaissements enregistrés dans le logiciel sont-ils des documents visés par cet article, ou suffit-il que le cabinet conserve l'export remis en fin de contrat ?
9. **Accès aux notes médicales.** Un administrateur du cabinet **qui n'est pas soignant** (gérant, assistant) peut-il accéder aux notes médicales ?
10. **Documents joints.** Le projet de contrat de sous-traitance et la notice d'information des patients sont-ils suffisants au regard de l'article 23, des mentions types de sous-traitance de la CNDP et de l'article 5 ? Existe-t-il une obligation de notifier une violation de données (au cabinet, à la CNDP) et dans quel délai ?

## Pièces jointes

- [Projet de contrat de sous-traitance](contrat-sous-traitance-projet.md).
- [Modèle de notice patients](notice-information-patients-projet.md).
- [Tableau de conservation](tableau-de-conservation.md).
- [Sources consultées et leur statut](sources.md).
- [Comparaison des hébergeurs](hebergement-maroc.md), si le juriste souhaite le contexte.
