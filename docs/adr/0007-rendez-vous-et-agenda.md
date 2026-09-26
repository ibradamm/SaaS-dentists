# ADR 0007 — Rendez-vous et agenda

- Statut : accepté (2026-09-26), analyse préalable à la Phase 5 ; mis en œuvre (rapport : `docs/phases/phase-5.md`)
- Décisions du porteur du projet :
  1. un rendez-vous hors horaires ou sur un créneau bloqué exige une confirmation explicite, tracée dans l'audit ;
  2. aucun rendez-vous pendant une absence ;
  3. statuts : prévu, honoré, patient absent, annulé, extensibles ;
  4. la durée du type est une valeur par défaut, modifiable par rendez-vous ;
  5. pas de table d'horaires d'ouverture.
- Fondations : ADR 0006. Ses règles R1 à R8 sont reprises ici.

## 1. Invariants et mécanismes

| # | Invariant | Garanti par |
|---|---|---|
| I1 | Jamais deux rendez-vous qui occupent le même temps pour un praticien | **Base** : `EXCLUDE USING gist (practitioner_id =, tstzrange(start_at, end_at, '[)') &&) WHERE (occupies_slot)` |
| I2 | Jamais un même patient à deux rendez-vous en même temps (chez deux praticiens) | **Base** : même exclusion sur `patient_id` |
| I3 | Aucun rendez-vous pendant une absence (du praticien ou de tout le cabinet) | Service, sous le verrou du praticien ; aucune dérogation possible |
| I4 | Hors horaires ou sur un blocage : seulement avec confirmation explicite, tracée | Service : refus avec le code `AVAILABILITY_CONFIRMATION_REQUIRED` ; avec confirmation, entrée d'audit `appointment.availability_override` dans la même transaction |
| I5 | Une modification ne s'appuie jamais sur un état périmé | Verrou optimiste (`version`) ; verrou transactionnel par praticien, partagé avec les horaires et les indisponibilités (ADR 0006, R5) |
| I6 | Isolation entre cabinets | `clinic_id`, clés composites vers praticien, patient et type, RLS forcée, filtre explicite (ADR 0001) |
| I7 | Un rendez-vous n'est jamais supprimé ; l'historique est complet | Aucun droit `DELETE` pour le rôle applicatif ; l'annulation est un statut |
| I8 | Durées et horaires sur la grille de 5 minutes, durée de 5 min à 8 h | Contraintes `CHECK` |

- **Pourquoi deux protections (verrou et contrainte).**
  - La contrainte d'exclusion garantit I1 et I2 quoi qu'il arrive : requêtes simultanées, erreur dans le code ou écriture directe en base.
  - Le verrou par praticien sérialise un rendez-vous et une indisponibilité créés en même temps. Sans lui, un rendez-vous pourrait être validé pendant qu'une absence est posée, ce que la contrainte ne voit pas (les absences n'en font pas partie).
- **Vérifié le 2026-09-26 sur PostgreSQL 16** :
  - plages adjacentes acceptées ;
  - chevauchement refusé pour le praticien comme pour le patient ;
  - le statut « patient absent » libère le créneau ;
  - revenir à « prévu » est refusé si le créneau a été repris.

## 2. Table `appointments`

| Colonne | Règle |
|---|---|
| `practitioner_id`, `patient_id`, `appointment_type_id` | Obligatoires, clés composites `(clinic_id, …)`. Praticien, patient et type **actifs** à la création |
| `start_at`, `end_at` | Instants UTC, `end_at > start_at`, alignés sur 5 min. Durée de 5 à 480 min |
| `status` | Clé étrangère vers `appointment_statuses` |
| `occupies_slot` | Recopié de `appointment_statuses` par un déclencheur ; jamais écrit par l'application (droits par colonne) |
| `note` | Note administrative facultative (500 caractères). **Aucune information médicale** : l'interface le rappelle |
| `cancelled_at`, `cancelled_by`, `cancellation_reason` | Renseignés à l'annulation. Motif court (200 caractères), jamais recopié dans l'audit |
| `created_by`, `version`, `created_at`, `updated_at` | Traçabilité, verrou optimiste |

- **Saisie :** l'heure de début arrive en heure locale du cabinet (`2026-10-01T10:00`) et est convertie par le serveur (ADR 0006). Une heure inexistante est refusée.
- **Durée :** en minutes réelles. Un rendez-vous de 60 min dure 60 min, même la nuit d'un changement d'heure.

## 3. Statuts extensibles

Table de référence **`appointment_statuses`** : `code`, `occupies_slot`, `sort_order`. Elle est commune à tous les cabinets et en lecture seule pour l'application.

| Code | Libellé | Occupe le créneau | Transitions permises |
|---|---|:-:|---|
| `SCHEDULED` | Prévu | oui | → `COMPLETED`, `NO_SHOW` (une fois l'heure de début passée) ; → `CANCELLED` |
| `COMPLETED` | Honoré | oui | → `SCHEDULED` (correction d'une erreur de saisie) |
| `NO_SHOW` | Patient absent | **non** : un patient reçu à sa place ne doit pas être bloqué | → `SCHEDULED` (correction ; refusée si le créneau a été repris) |
| `CANCELLED` | Annulé | non | aucune : définitif, on recrée un rendez-vous |

- **Ajouter un statut** (par exemple « arrivé en salle d'attente » ou « reporté ») :
  1. une ligne dans `appointment_statuses` (migration) ;
  2. un libellé dans l'interface ;
  3. des transitions dans la table du code (`packages/shared`).
- **Ce qui ne change pas :** ni la structure de `appointments`, ni la contrainte d'exclusion, qui s'appuie sur `occupies_slot` et non sur une liste de statuts figée.
- **Corrections vers « prévu » :** elles ne redemandent pas la vérification des horaires (elles portent sur le passé). Seule la contrainte d'exclusion s'applique.

## 4. Règles d'écriture

**Création, déplacement, changement de praticien ou de durée.** Réservés aux rendez-vous « prévus », évalués sous le verrou du ou des praticiens concernés :

1. absence qui chevauche le rendez-vous → refus `PRACTITIONER_ABSENT`, sans dérogation ;
2. rendez-vous pas entièrement dans les horaires, ou qui chevauche un blocage → refus `AVAILABILITY_CONFIRMATION_REQUIRED` avec les raisons (hors horaires, blocage et son libellé) ;
3. avec `allowOutsideAvailability: true` → accepté, entrée d'audit `appointment.availability_override` avec les raisons ;
4. autre rendez-vous du praticien ou du patient sur ce temps → refus `SLOT_UNAVAILABLE` : contrôle préalable pour un message clair, contrainte en dernier recours.

**Qui peut confirmer.** Toute personne qui a `appointment.write` : administrateur, dentiste, secrétariat. La confirmation est un geste explicite (bouton « Confirmer quand même »), jamais automatique. Une permission dédiée pourra la restreindre plus tard.

**Liens avec les autres modules :**

| Situation | Règle |
|---|---|
| Absence ou blocage posé sur des rendez-vous existants | Accepté ; les rendez-vous en conflit sont **listés** dans la réponse, jamais modifiés (R6) |
| Horaires modifiés à partir d'une date | Idem : les rendez-vous « prévus » désormais hors horaires sont listés |
| Archivage d'un praticien | Refusé s'il a des rendez-vous « prévus » à venir (R7) |
| Archivage d'un patient | Refusé s'il a des rendez-vous « prévus » à venir |
| Annulation d'un import | Un patient importé qui a un rendez-vous n'est jamais supprimé (condition ajoutée, test du catalogue mis à jour) |
| Archivage d'un type | Permis ; les rendez-vous existants gardent leur type, les nouveaux ne peuvent plus l'utiliser |
| Changement de fuseau du cabinet | Sans effet : les rendez-vous sont des instants |

## 5. Permissions et audit

- **Permissions existantes :**
  - `appointment.read` : agenda, historique d'un patient, créneaux libres ;
  - `appointment.write` : création, modification, statut.
- **Portée :** tous les rôles y ont droit. Le dentiste peut prendre rendez-vous pour un confrère, cas usuel. Une restriction « son agenda seulement » s'ajouterait comme pour les horaires (ADR 0006).
- **Audit :**
  - `appointment.created` et `appointment.updated` : identifiants et instants, jamais de nom ni de note ;
  - `appointment.status_changed` : statut avant et après ;
  - `appointment.availability_override` : raisons.
- **Lecture de l'agenda :** non tracée. Ce ne sont pas des données médicales.

## 6. Créneaux libres

`GET /api/availability/slots` :
- disponibilités (horaires − absences − blocages, ADR 0006) moins les rendez-vous qui occupent leur créneau ;
- débuts alignés sur l'horloge locale (pas de 15 min par défaut) ;
- 50 résultats au plus.

La réponse des disponibilités retire désormais aussi ces rendez-vous.

## 7. Interface : agenda maison plutôt que FullCalendar

L'architecture prévoyait FullCalendar. Choix revu :

- **Fuseau :** FullCalendar ne gère un fuseau nommé (celui du cabinet) qu'avec un greffon qui embarque Luxon dans le navigateur, soit plus de 200 ko ajoutés à une application déjà au-dessus du seuil de 500 ko.
- **Besoins :**
  - vues « jour » (colonnes par praticien) et « semaine » (un praticien) ;
  - clic sur un créneau ;
  - fiche du rendez-vous.
  Une grille maison les couvre en quelques centaines de lignes, testées.
- **Accessibilité :** chaque rendez-vous est un bouton annoncé (patient, heure, type, statut). Un bouton « Nouveau rendez-vous » permet tout au clavier, sans dépendre de la grille.
- **Pas de glisser-déposer au MVP** : le déplacement passe par la fiche (date, heure, praticien), avec les créneaux libres proposés.
- **Affichage :** tout est positionné en heure locale du cabinet (`Intl`, fuseau du cabinet).
- **Limite connue :** l'heure répétée du passage à l'heure d'hiver (2 h-3 h) n'est pas dédoublée à l'écran. Elle est en dehors des horaires des cabinets.
- **Mise en œuvre :** chaque rendez-vous porte une étiquette accessible complète (contexte, heure, patient, type, statut). L'heure courante est rafraîchie chaque minute (ligne « maintenant », accès à « honoré »).

## 8. Codes d'erreur ajoutés

| Code | Sens | Réaction de l'interface |
|---|---|---|
| `AVAILABILITY_CONFIRMATION_REQUIRED` | Hors horaires ou sur un blocage | Affiche les raisons et propose « Confirmer quand même » |
| `PRACTITIONER_ABSENT` | Pendant une absence | Message, aucune dérogation |
| `SLOT_UNAVAILABLE` | Créneau déjà pris (praticien ou patient) | Message et créneaux libres proposés |

Une version périmée garde le code `CONFLICT` : il faut recharger.

## 9. Hors périmètre de la Phase 5

- Rendez-vous récurrents et liste d'attente.
- Rappels aux patients : ils passeront par l'outbox existante, extension future.
- Glisser-déposer.
- Plusieurs praticiens sur un même rendez-vous.
- Fauteuils et salles : `appointments.room_id` facultatif et une seconde exclusion, ajouts purs (ADR 0006, section 8).

## 10. Options écartées

| Option | Raison |
|---|---|
| Statuts figés dans une contrainte `CHECK` et dans la condition de l'exclusion | Chaque nouveau statut obligerait à recréer la contrainte d'exclusion ; la table de référence et `occupies_slot` l'évitent |
| « Patient absent » qui occupe le créneau | Empêcherait de recevoir un autre patient à sa place |
| Suppression physique des rendez-vous | Perte d'historique ; l'annulation suffit |
| Vérifier les chevauchements seulement dans le code | Ne résiste pas à deux requêtes simultanées ; la base doit être la garantie finale |
| Dérogation possible pendant une absence | Refusée par décision du porteur du projet |
