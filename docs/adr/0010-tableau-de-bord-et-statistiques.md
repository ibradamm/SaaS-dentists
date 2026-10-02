# ADR 0010 — Tableau de bord et statistiques

- Statut : accepté (2026-09-27), analyse préalable à la Phase 8
- **Demande du porteur du projet :** un tableau de bord utile au dentiste et à la secrétaire, sans surcharge ; indicateurs selon les permissions ; calculs côté serveur sur les données réelles ; filtres aujourd'hui, semaine, mois, année, période personnalisée et praticien.
- **Fondations :**
  - rendez-vous et statuts (ADR 0007) ;
  - horaires et indisponibilités (ADR 0006) ;
  - paiements et revenus encaissés (ADR 0009) ;
  - fuseau du cabinet et `local-time.ts` (ADR 0006) ;
  - permissions (ADR 0003).

## 1. Deux écrans, deux usages

| Écran | Question à laquelle il répond | Pour qui |
|---|---|---|
| **« Aujourd'hui »** (accueil existant) | Que dois-je faire aujourd'hui ? | Secrétaire et dentiste, plusieurs fois par jour |
| **« Statistiques »** (nouvelle page) | Comment va le cabinet sur une période ? | Dentiste surtout ; secrétaire pour l'activité |

- **L'accueil garde la liste de la journée** et reçoit un bandeau court de quatre indicateurs d'action :
  - rendez-vous des 7 prochains jours ;
  - montant restant à encaisser ;
  - rendez-vous honorés aujourd'hui sans acte saisi ;
  - encaissé aujourd'hui (dentiste, administrateur).
- **La page « Statistiques »** porte l'analyse par période. Elle ne duplique pas l'agenda ni la page « Revenus » (journal détaillé des encaissements, Phase 7), vers lesquels elle renvoie.
- **Garde-fou contre la surcharge :** chaque indicateur répond à une décision identifiable (relancer, facturer, ouvrir des créneaux, suivre l'activité). Un indicateur sans décision associée n'est pas affiché.

## 2. Définitions exactes

Toutes les dates sont des **dates locales du cabinet**. « Dans la période » signifie : l'instant tombe entre le début du premier jour et la fin du dernier jour, en heure du cabinet.

### Activité (permission `appointment.read`)

| Indicateur | Définition | Filtre praticien |
|---|---|---|
| Rendez-vous de la période | Rendez-vous dont le **début** est dans la période, hors annulés | Oui |
| Honorés, patients absents, annulés, prévus | Même base, par statut actuel. Un rendez-vous annulé compte à sa date prévue, pas à la date d'annulation | Oui |
| Taux d'absence | Absents ÷ (honorés + absents). Vide si aucun rendez-vous passé n'a été pointé | Oui |
| Taux de présence | Honorés ÷ (honorés + absents) : le complément du taux d'absence, affiché avec lui | Oui |
| Taux d'annulation | Annulés ÷ tous les rendez-vous de la période, annulés compris. Vide si aucun | Oui |
| Patients vus | Patients distincts ayant au moins un rendez-vous honoré dans la période | Oui |
| Occupation du planning | Voir la section 4 | Oui |
| Activité par période | Honorés, absents, annulés et prévus par jour, semaine ou mois (section 3) | Oui |
| Types les plus fréquents | Les 5 types de rendez-vous les plus nombreux, hors annulés, avec leur part | Oui |
| Rendez-vous à venir | Rendez-vous « prévus » qui commencent dans les 7 prochains jours à partir de maintenant ; ne dépend pas de la période | Oui |

### Patients (permission `patient.read`)

| Indicateur | Définition | Filtre praticien |
|---|---|---|
| Patients actifs | Fiches actives (non archivées), à l'instant de la consultation | Non : un patient n'appartient pas à un praticien |
| Nouveaux patients | Fiches **créées par le cabinet** dans la période. Les fiches importées sont exclues : un import de 3 000 patients ne crée pas 3 000 nouveaux patients | Non |

### Encaissements (permission `payment.read`)

| Indicateur | Définition |
|---|---|
| Restant à encaisser | Montants dus ouverts moins paiements valides, pour tout le cabinet, à l'instant de la consultation (même calcul que la page « À encaisser ») ; nombre de patients concernés |
| Honorés sans acte saisi | Rendez-vous honorés de la période sans aucun acte ouvert qui leur soit rattaché, **hors rendez-vous marqués « sans facturation »** (comptés à part) ; nombre et liste des 10 plus récents, chacun avec « Encaisser » et « Sans facturation ». Exige aussi `appointment.read`. Filtre praticien : oui |

### Revenus (permission `finance.reports.read`)

| Indicateur | Définition |
|---|---|
| Revenus encaissés | Paiements valides dont l'instant d'encaissement est dans la période (définition unique de l'ADR 0009, section 6) |
| Période précédente | Même calcul sur la période précédente (section 3) |
| Évolution des revenus | Revenus par jour, semaine ou mois, périodes sans encaissement comprises (à zéro) |
| Revenus par praticien | Selon le praticien de l'acte ; « Non précisé » sinon |
| Paiements annulés | Montant et nombre, affichés à part, jamais comptés |

Le **filtre praticien** s'applique aux revenus par le praticien de l'acte. Toute lecture de revenus passe par le **périmètre des revenus** (`revenueScope`, ADR 0009, section 10) : tout le cabinet aujourd'hui, limitable plus tard à ses propres praticiens sans changer les requêtes.

**Montants :** centimes entiers, sommés en base (`bigint`), convertis avec contrôle d'entier sûr. Aucune moyenne monétaire n'est calculée : elle introduirait des divisions et des arrondis sans décision associée.

**Taux :** calculés côté serveur, renvoyés en fraction décimale ou `null` quand le dénominateur est nul. L'interface n'affiche jamais « 0 % » pour « aucune donnée ».

## 3. Périodes, fuseau et découpage

- **Périodes proposées :**
  - aujourd'hui ;
  - semaine, du lundi au dimanche ;
  - mois civil ;
  - année civile ;
  - période libre, 366 jours au plus.
- Des flèches passent à la période précédente ou suivante du même type.
- **Découpage** (évolution des revenus, activité par période), choisi par le serveur selon la longueur :

| Longueur | Découpage |
|---|---|
| Jusqu'à 31 jours | Jour |
| Jusqu'à 183 jours | Semaine (du lundi ; la première et la dernière peuvent être partielles) |
| Au-delà | Mois |

- **Bornes calculées par `local-time.ts`**, en heure murale du cabinet, puis passées à PostgreSQL comme un tableau d'instants. La base range chaque ligne avec `width_bucket(instant, bornes)`.
  - Les jours de changement d'heure (23 h ou 25 h) sont donc exacts.
  - Aucune conversion de fuseau n'est faite en SQL (`AT TIME ZONE`) : la base de fuseaux de PostgreSQL et celle du serveur Node pourraient différer d'une version et donner des bornes incohérentes.
- **Période précédente**, calculée par une règle pure :
  - un mois civil complet → le mois précédent ;
  - une année civile complète → l'année précédente ;
  - sinon, le même nombre de jours juste avant (le jour précédent, la semaine précédente, etc.).

## 4. Occupation du planning

- **Temps ouvert** : plages de travail du praticien moins ses absences et blocages et ceux du cabinet. C'est le calcul de disponibilité existant (`computeAvailability`, ADR 0006).
- **Temps réservé au planning** (définition du porteur du projet, validation de la Phase 8) : durée des rendez-vous **prévus, honorés et patients absents**, **limitée au temps ouvert**.
  - Un patient absent compte : son créneau était réservé et inutilisable pour un autre patient. L'agenda, lui, libère ce créneau après coup (ADR 0007) ; si un autre rendez-vous y est pris, le temps n'est compté qu'une fois.
  - Un rendez-vous annulé ne compte pas.
  - Un rendez-vous accordé hors horaires ne compte pas : le taux ne dépasse jamais 100 %.
- **Taux** : temps réservé ÷ temps ouvert, par praticien et pour tout le cabinet (somme des temps). Vide si aucun temps ouvert.
- Sur une période qui s'étend dans le futur, il mesure le **remplissage** de l'agenda, ce qui répond à la question « faut-il ouvrir ou libérer des créneaux ? ».

## 5. Permissions et forme de l'API

- **Aucune nouvelle permission.** Chaque section exige la permission de ses données sources (section 2). Tableau pour les rôles actuels :

| Section | Administrateur | Dentiste | Secrétaire |
|---|---|---|---|
| Activité, occupation, types | oui | oui | oui |
| Patients | oui | oui | oui |
| Restant à encaisser, honorés sans acte | oui | oui | oui |
| Revenus | oui | oui | **non** |

- **Une seule route :** `GET /api/dashboard?from&to&practitionerId`.
  - Le service calcule **uniquement les sections permises** : une section non permise est absente de la réponse, pas masquée par l'interface.
  - L'appel exige au moins une des permissions (`authorizeAny`).
  - Un praticien d'un autre cabinet ou inconnu donne 404.
- **Une seule transaction** (`withTenant`, filtre explicite par cabinet) : toutes les sections d'une réponse décrivent le même instant.

## 6. Coût des requêtes

- **Agrégation en base** : comptes et sommes par `GROUP BY` sur les index existants :
  - `appointments (clinic_id, start_at)` ;
  - `payments (clinic_id, received_at)` ;
  - `charges (appointment_id)`.
- Seul le taux d'occupation lit des lignes (début et fin des rendez-vous de la période), pour l'intersection avec les plages ouvertes.
- **Nombre de requêtes borné et indépendant du volume** : une quinzaine au plus par appel, dont aucune par jour ni par ligne.
- La page « Revenus » de la Phase 7, qui agrégeait les paiements dans le serveur Node, passe aux mêmes requêtes agrégées : une seule définition des revenus.
- **Test de performance** :
  - un cabinet d'un an d'activité (plusieurs praticiens, milliers de patients, dizaines de milliers de rendez-vous et de paiements) ;
  - plus un second cabinet chargé, pour vérifier que son volume ne ralentit ni ne fausse le premier ;
  - temps mesurés et plafonnés.
- **Pas de cache ni de tables d'agrégats** : à ce volume, le calcul direct suffit. Il se mesure (section 6) avant d'ajouter une invalidation de cache, source classique de chiffres faux.

## 7. Écrans

- **« Statistiques »** :
  - barre de période (boutons, flèches, dates libres) et choix du praticien ;
  - puis, selon les permissions : indicateurs clés, activité par période, occupation par praticien, types fréquents, patients, encaissements (restant dû, honorés sans acte), revenus (total, évolution, par praticien).
- **Graphiques** : barres en SVG écrites à la main (pas de bibliothèque de graphiques), avec les valeurs exactes lisibles au clavier et au lecteur d'écran (tableau associé).
- **Page chargée à la demande** : le budget du chargement initial n'augmente pas.
- **Téléphone** : une colonne, graphiques pleine largeur, sans défilement horizontal de la page.

## 8. Hors périmètre de la Phase 8

- Export (CSV, PDF), objectifs chiffrés, prévisions.
- Statistiques cliniques (actes médicaux, pathologies).
- Mise à jour en temps réel.
- Comparaisons sur plusieurs années.
- Dépenses et bénéfice (pas de dépenses au MVP, ADR 0009).

## 9. Options écartées

| Option | Raison |
|---|---|
| Calcul des statistiques dans le navigateur à partir des listes | Exigence du porteur du projet ; exposerait des données brutes au-delà du besoin ; coûteux sur une année |
| Tables d'agrégats ou vues matérialisées | Prématuré au volume d'un cabinet ; invalidation complexe, risque de chiffres périmés |
| Conversion de fuseau en SQL (`AT TIME ZONE`) | Contourne `local-time.ts` (règle du projet) ; bases de fuseaux possiblement différentes entre PostgreSQL et Node |
| Bibliothèque de graphiques | Poids (plusieurs dizaines de ko) pour des barres simples |
| Nouvelle permission « statistiques » | Les permissions des données sources suffisent et évitent qu'un rôle voie en statistiques ce qu'il ne peut pas lire en détail |
| « Nouveaux patients » = premier rendez-vous honoré | Plus juste cliniquement mais dépend de l'historique antérieur au logiciel ; la création de fiche est une donnée fiable |

## 10. Réponses du porteur du projet (validation de la Phase 8, 2026-09-27)

| # | Question | Réponse | Conséquence dans le code |
|---|---|---|---|
| 1 | Rendez-vous gratuits comptés comme oublis d'encaissement | Ajouter une mention « sans facturation » | Colonne `appointments.billing_exempt` (migrations 0015-0016, seule colonne ajoutée aux droits de mise à jour). Route `POST /api/appointments/:id/billing` (`payment.write`, tracée : `appointment.billing_exempt`). La mention et un acte ouvert s'excluent : la mention est refusée si un acte ouvert existe, un acte est refusé sur un rendez-vous marqué. Les deux écritures verrouillent la ligne du rendez-vous (`FOR UPDATE` et `FOR SHARE`) : simultanées, la seconde attend puis est refusée. Statistiques : exclu des oublis, compté à part |
| 2 | Objectifs chiffrés ; export CSV | Pas d'objectifs au MVP. Export CSV plus tard | Export ajouté aux extensions futures (`docs/future/README.md`) |
| 3 | Définition de l'occupation | Honorés et absents comptent, annulés non, jamais plus de 100 % ; distinguer occupation du planning, absence et présence | Section 4 réécrite ; `plannedIntervals` (prévus, honorés, absents) ; taux de présence ajouté (global et par praticien) ; interface : « Occupation du planning », « Taux de présence » avec le taux d'absence |

