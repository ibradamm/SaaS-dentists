# Contrat de sous-traitance de données à caractère personnel

> **PROJET À FAIRE RELIRE PAR UN JURISTE MAROCAIN.** Rédigé à partir du fonctionnement réel du service et d'éléments préliminaires sur la loi 09-08 ([sources.md](sources.md)). Les textes officiels n'ont pas pu être lus pendant la rédaction. Les références d'articles sont à vérifier. Les crochets `[…]` sont à compléter ou à décider.

**Entre**
- [Raison sociale du cabinet], [forme], [adresse], représenté par [Dr …], ci-après « **le Responsable** » ;
- [Raison sociale de l'éditeur], [forme], [adresse], [RC, IF, ICE], représentée par [ …], ci-après « **le Sous-traitant** ».

## Article 1 — Objet

Le Responsable utilise le service [nom du service] du Sous-traitant pour gérer son cabinet. Le présent contrat encadre les traitements de données à caractère personnel effectués par le Sous-traitant pour le compte du Responsable, conformément à la loi n° 09-08, notamment son article 23 [à vérifier].

## Article 2 — Durée

Le contrat suit la durée du contrat de service. Les articles 5 (confidentialité), 10 (fin du contrat), 11 (litiges) et 12 (violations) continuent de s'appliquer après son terme, jusqu'à la suppression effective des données, sauvegardes comprises.

## Article 3 — Description des traitements

Voir l'annexe 1 : finalités, catégories de personnes et de données, opérations, durées. Les données de santé sont des **données sensibles** au sens de la loi 09-08.

## Article 4 — Instructions

1. Le Sous-traitant ne traite les données **que sur instruction documentée** du Responsable. Valent instructions :
   - le présent contrat ;
   - l'utilisation du service par le personnel du Responsable ;
   - les demandes écrites du Responsable.
2. Le Sous-traitant n'utilise pas les données pour son propre compte. En particulier, il ne s'en sert ni pour des statistiques entre cabinets, ni pour de la prospection, ni pour entraîner des modèles, et ne les cède pas.
3. Le Sous-traitant informe sans délai le Responsable s'il estime qu'une instruction enfreint la loi.

## Article 5 — Confidentialité

1. Seules les personnes habilitées par le Sous-traitant accèdent aux données, et seulement quand c'est nécessaire : exploitation, incident, demande du Responsable.
2. Chacune est soumise à une **obligation écrite de secret**, qui survit à ses fonctions. La liste des personnes habilitées est tenue à jour et communiquée sur demande.
3. Tout accès aux données d'un cabinet par le Sous-traitant est inscrit à un registre d'exploitation : date, personne, motif, sans donnée patient.

*[Note pour le juriste : l'article 22 réserve, d'après une source secondaire, le régime déclaratif aux traitements mis en œuvre par une personne « soumise à une obligation de secret ». Cette clause suffit-elle ?]*

## Article 6 — Sécurité

Le Sous-traitant met en œuvre les mesures de l'**annexe 2** et les maintient pendant toute la durée du contrat. Il n'en réduit aucune sans en informer le Responsable.

## Article 7 — Sous-traitants ultérieurs

1. Le Responsable autorise le recours aux sous-traitants ultérieurs de l'**annexe 4**.
2. Tout ajout ou remplacement est notifié **[30] jours** à l'avance ; le Responsable peut s'y opposer pour un motif légitime. [Conséquence de l'opposition : à décider.]
3. Le Sous-traitant impose à chacun des obligations au moins équivalentes et reste responsable de leur exécution.

## Article 8 — Transferts hors du Maroc

1. Les données sont hébergées dans les pays de l'**annexe 4**. Aucun autre pays sans information préalable du Responsable dans les conditions de l'article 7.
2. Les formalités auprès de la CNDP, y compris la **demande de transfert à l'étranger**, incombent au Responsable. Le Sous-traitant lui fournit les éléments de l'**annexe 5** et toute information utile.
3. [À décider avec le juriste : traitement des accès techniques depuis un pays ne figurant pas sur la liste de la CNDP, par exemple le support de l'hébergeur.]

## Article 9 — Assistance

Le Sous-traitant aide le Responsable, dans des délais compatibles avec ses obligations légales :
- à répondre aux **demandes des personnes** : accès, rectification, opposition, effacement des données non conformes (articles 7 à 9 [à vérifier ; délai de rectification de 10 jours à confirmer]). Le service permet la consultation et la rectification des fiches. Un export du cabinet est fourni sur demande ;
- à accomplir les **formalités** auprès de la CNDP ;
- lors d'un **contrôle** de la CNDP.

## Article 10 — Fin du contrat : restitution et suppression

1. **Suspension.** À la date de fin, l'accès au service est fermé. Les données restent intactes.
2. **Restitution.** Dans les **[15] jours** suivant la fin, ou à toute demande écrite, le Sous-traitant remet au Responsable un **export complet** des données du cabinet :
   - format : JSON documenté, une table par rubrique, notes médicales déchiffrées ;
   - remise : fichier chiffré, phrase de passe transmise séparément, accusé de réception mentionnant l'empreinte du fichier ;
   - exclusions : les sessions de connexion et les secrets d'authentification.

   Le Sous-traitant supprime sa propre copie de l'export dès la remise confirmée.
3. **Obligations de conservation du Responsable.** Il appartient au Responsable de conserver l'export pour ses propres obligations : dossier médical, documents comptables (article 211 du Code général des impôts, [portée à confirmer]).
4. **Suppression.** **[30] jours** après la remise de l'export, sauf instruction écrite contraire ou conservation pour litige (article 11), le Sous-traitant supprime toutes les données du cabinet de sa base de production.
5. **Sauvegardes.** Les données subsistent dans les sauvegardes jusqu'à leur expiration, **au plus tard [89] jours** après la suppression. Elles ne sont ni consultées ni restaurées pour ce cabinet. En cas de restauration de la base pour un incident, la suppression est rejouée avant toute remise en service.
6. **Attestation.** Le Sous-traitant remet une attestation indiquant la date de suppression et la date d'expiration de la dernière sauvegarde concernée.
7. Restent hors de la suppression, faute de données patient :
   - les journaux techniques de l'hébergeur (adresses IP des postes, chemins des requêtes ; durée : annexe 3) ;
   - le registre d'exploitation.

## Article 11 — Litiges

Sur instruction écrite du Responsable ou sur décision de justice, le Sous-traitant pose une **conservation pour litige**. Elle suspend toute suppression des données du cabinet, y compris celle de l'article 10, jusqu'à sa levée écrite. Les sauvegardes continuant d'expirer, le Sous-traitant réalise sur demande un export dédié, conservé chiffré. [Frais éventuels : à décider.]

## Article 12 — Violation de données

1. Le Sous-traitant notifie au Responsable toute violation de données le concernant **dans les [48] heures** après en avoir eu connaissance. La notification indique :
   - la nature de la violation ;
   - les catégories et le nombre approximatif de personnes et d'enregistrements ;
   - les conséquences probables ;
   - les mesures prises ou proposées.
2. Il l'assiste pour les suites, y compris auprès de la CNDP. [Obligation légale de notification : non trouvée dans les sources consultées, à vérifier.]

## Article 13 — Documentation et audits

Le Sous-traitant met à disposition la documentation de l'annexe 2 et répond aux questionnaires du Responsable. [Audit sur place : modalités, préavis, frais, à décider.]

## Article 14 — Responsabilité

[À rédiger par le juriste.]

## Article 15 — Droit applicable

Droit marocain. [Juridiction compétente.]

---

## Annexe 1 — Description des traitements

- **Finalités :**
  - gestion de l'agenda et des rendez-vous ;
  - tenue du dossier patient : identité, contacts, notes médicales ;
  - suivi des actes et des encaissements ;
  - tableau de bord du cabinet (activité, revenus) ;
  - import de fichiers de patients ;
  - gestion des comptes du personnel ;
  - sécurité et traçabilité (journal d'audit).
- **Personnes concernées :** patients et leurs proches (contacts) ; personnel du cabinet.
- **Données :** inventaire détaillé dans [inventaire-et-ecarts.md](inventaire-et-ecarts.md), section 1. Le service ne collecte aucune donnée de carte ni de compte bancaire.
- **Opérations :** enregistrement, consultation, modification, archivage, export, suppression dans les cas prévus.
- **Durées :** annexe 3.

## Annexe 2 — Mesures de sécurité (état au [date])

Mesures en place, chacune vérifiée par des tests automatiques :
- **Isolation par cabinet :**
  - sécurité au niveau des lignes (RLS) activée et forcée sur toutes les tables ;
  - filtre explicite par cabinet dans chaque requête ;
  - tests systématiques d'accès d'un cabinet aux données d'un autre.
- **Contrôle d'accès par rôle** (administrateur, dentiste, secrétaire), vérifié côté serveur. Notes médicales réservées au dentiste ; chaque lecture est tracée.
- **Authentification :**
  - mots de passe Argon2id ;
  - verrouillage après 10 échecs (15 minutes) ;
  - double authentification obligatoire pour les administrateurs et les dentistes ;
  - sessions fermées après 60 minutes d'inactivité et au plus tard après 12 heures ;
  - cookie de session sécurisé (`__Host-`, `Secure`, `HttpOnly`) ;
  - protection contre la falsification de requêtes.
- **Chiffrement :**
  - notes médicales chiffrées dans l'application (AES-256-GCM) ;
  - clé distincte de la base, avec une copie indépendante ;
  - connexions en HTTPS.
- **Traçabilité :** journal d'audit en ajout seul. Il ne recopie jamais un contenu saisi.
- **Moindre privilège :** l'application n'a aucun droit de contournement de la sécurité de la base ; seul le service d'administration détient les accès propriétaire et administrateur.
- **Journaux et remontée d'erreurs :** aucune valeur saisie ; la remontée d'erreurs n'envoie aucune donnée personnelle.
- **Données de test** fictives uniquement, hors production.
- **Sauvegardes :** quotidiennes, hebdomadaires et mensuelles, plus la restauration à un instant donné, chez l'hébergeur. [Exercice de restauration sur l'hébergement : **à réaliser** avant la mise en service.]
- **Fin de contrat :** export complet, conservation pour litige, suppression sur instruction (article 10).

Points non vérifiés à ce jour :
- chiffrement au repos des volumes et des sauvegardes chez l'hébergeur ;
- localisation des sauvegardes et des journaux ;
- accès du personnel de l'hébergeur.

## Annexe 3 — Durées de conservation

Voir [tableau-de-conservation.md](tableau-de-conservation.md), à reprendre ici une fois les durées décidées.

## Annexe 4 — Sous-traitants ultérieurs et pays

| Sous-traitant | Prestation | Données | Pays d'hébergement | Siège |
|---|---|---|---|---|
| Railway Corporation | Hébergement (calcul, base de données, sauvegardes, journaux) | Toutes | Pays-Bas (région Europe de l'Ouest) ; [sauvegardes et journaux : à confirmer] | États-Unis |
| Functional Software Inc. (Sentry), si activé | Remontée d'erreurs | Aucune donnée personnelle par conception | Union européenne [à confirmer] | États-Unis |

[À revoir si le choix se porte sur un hébergeur au Maroc.]

## Annexe 5 — Éléments pour les formalités du Responsable auprès de la CNDP

Fournis par le Sous-traitant :
- description technique du traitement (annexe 1) ;
- mesures de sécurité (annexe 2) ;
- liste des sous-traitants et pays (annexe 4) ;
- durées (annexe 3) ;
- clauses du présent contrat, à joindre à la demande de transfert à l'étranger.
