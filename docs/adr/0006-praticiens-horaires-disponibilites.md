# ADR 0006 — Praticiens, horaires, absences, blocages et disponibilités

- Statut : accepté (2026-09-26), analyse préalable à la Phase 4
- Décisions du porteur du projet :
  - un cabinet peut avoir un ou plusieurs praticiens ;
  - pas de fauteuils ni de salles au MVP, mais le modèle doit permettre de les ajouter sans refonte ;
  - les disponibilités sont liées au praticien.

## 1. Principes

1. **Deux natures de temps, deux représentations.**
   - Ce qui se **répète** (« le lundi de 9 h à 12 h ») est stocké en **heure locale du cabinet** (jour ISO + minutes depuis minuit). Stocker un instant UTC décalerait les horaires d'une heure à chaque changement d'heure.
   - Ce qui **arrive une fois** (un congé, un blocage, bientôt un rendez-vous) est stocké en **instants UTC** (`timestamptz`).
2. **Un seul fuseau par cabinet** (`clinics.timezone`, IANA). Toutes les conversions heure locale ↔ instant se font côté serveur (Luxon), dans ce fuseau, jamais dans celui du navigateur.
3. **La base garantit ce qui ne doit jamais être faux :**
   - pas deux périodes d'horaires qui se chevauchent pour un praticien ;
   - pas deux plages qui se chevauchent un même jour dans une période ;
   - isolation entre cabinets.

   Le code garantit le reste, testé.
4. **Le calcul des disponibilités est une fonction pure**, sans base ni horloge implicite, qui travaille sur des intervalles génériques. Elle sert aux praticiens aujourd'hui et servira aux salles demain.
5. **Grain de 5 minutes** pour les horaires, les durées et les blocages. C'est le pas usuel des agendas et il évite les créneaux de 7 min 30.

## 2. Praticiens (`practitioners`)

Un praticien est une **ressource réservable**, distincte d'un compte utilisateur :
- un praticien peut ne jamais se connecter (collaborateur, hygiéniste) ;
- un compte peut être administrateur **et** praticien : cas du dentiste titulaire, notamment en cabinet individuel.

| Colonne | Règle |
|---|---|
| `display_name` | 1 à 100 caractères (« Dr Martin ») |
| `user_id` | Facultatif. Clé composite `(clinic_id, user_id)` vers `clinic_memberships` : le compte doit être membre **de ce cabinet**. Un compte est lié à un seul praticien par cabinet (index unique partiel). |
| `color` | `#RRGGBB`, pour l'agenda |
| `status` | `ACTIVE` / `ARCHIVED`. Pas de suppression, car les rendez-vous le référenceront. |
| `version` | Verrou optimiste |

**Un ou plusieurs praticiens.** Aucun mode « cabinet individuel » à configurer : le nombre de praticiens actifs suffit.
- **Un seul praticien actif :** l'interface le sélectionne d'office et masque les choix.
- **Plusieurs :** l'interface affiche les choix.
- **Démarrage d'un cabinet individuel :** « M'ajouter comme praticien » crée le praticien lié au compte connecté.

**Lien avec les permissions :**
- `schedule.manage_own` (dentiste) : il gère uniquement le praticien lié à **son** compte ;
- `schedule.manage_any` (administrateur, secrétaire) : tous les praticiens ;
- créer, renommer, lier ou archiver un praticien relève de `clinic.settings.manage` (administrateur).

## 3. Horaires de travail : périodes versionnées

Un changement d'horaires se décide à l'avance : « à partir du 1er septembre, je ne travaille plus le mercredi ». Modifier les horaires en place changerait rétroactivement les semaines passées et les rendez-vous déjà pris. D'où deux tables.

| Table | Contenu | Contraintes en base |
|---|---|---|
| `working_schedules` | Période : praticien, `valid_from` (date locale), `valid_to` (exclue, vide = sans fin), `version` | `EXCLUDE (practitioner_id =, daterange(valid_from, valid_to, '[)') &&)` : jamais deux périodes en même temps |
| `working_intervals` | Plages d'une période : jour ISO (1 = lundi … 7 = dimanche), `start_minute`, `end_minute` | `0 ≤ début < fin ≤ 1440`, multiples de 5 ; `EXCLUDE (schedule_id =, weekday =, int4range(début, fin) &&)` : les plages adjacentes (9 h-12 h, 12 h-14 h) sont permises |

Les journées coupées (matin et après-midi) sont deux plages. Les horaires qui passent minuit ne sont pas gérés : cas inexistant en cabinet dentaire.

**Opération unique : « nouveaux horaires à partir du jour D »** (D ≥ aujourd'hui dans le fuseau du cabinet ; le passé n'est pas réécrit).

| Situation | Effet |
|---|---|
| Une période commence exactement en D | Ses plages sont remplacées |
| Une période commencée avant D couvre D | Elle est arrêtée en D ; la nouvelle va de D jusqu'à la fin de l'ancienne |
| Aucune période ne couvre D | La nouvelle va de D jusqu'au début de la période suivante (ou sans fin) |

- Les périodes futures déjà prévues sont conservées.
- Une période future peut être supprimée : la précédente s'étend alors jusqu'à la suivante.
- Une période sans plage est permise : le praticien ne travaille pas (congé long, départ).
- **Concurrence :** verrou transactionnel par praticien, et **identifiant et version** de la période en vigueur transmis par l'interface. La version seule ne suffit pas : une période créée entre-temps peut porter le même numéro (défaut trouvé par le test de concurrence). Deux modifications simultanées donnent un enregistrement et un conflit 409, jamais un mélange.

**Horaires d'ouverture du cabinet : pas de table dédiée.** Le plan prévoyait des « horaires d'ouverture », mais une table séparée dupliquerait les horaires des praticiens sans rien garantir de plus.
- Les disponibilités ne dépendent que des horaires des praticiens.
- Les fermetures du cabinet sont des absences « tout le cabinet » (section 4).
- La plage affichée par l'agenda se déduira des horaires (Phase 5).

Cette table s'ajoutera si un affichage public des horaires devient nécessaire.

## 4. Absences, congés et blocages (`availability_blocks`)

Une seule table d'**indisponibilités ponctuelles**, en instants UTC `[start_at, end_at)`.

| `kind` | Sens | Effet sur les rendez-vous (Phase 5) |
|---|---|---|
| `ABSENCE` | Le praticien ne travaille pas : congés, formation, absence | **Refus** de tout rendez-vous |
| `BLOCK` | Le praticien est là mais le créneau n'est pas réservable : réunion, administratif, urgence gardée | Exclu des créneaux proposés ; réservation possible seulement avec une confirmation explicite, tracée |

- **Portée :** `practitioner_id` renseigné (un praticien) ou vide, ce qui signifie **tout le cabinet** : fermeture, jour férié, réunion d'équipe. Un blocage de tout le cabinet exige `schedule.manage_any`.
- **Journée entière (`all_day`) :** saisie en dates locales incluses (du 24 au 31 décembre), stockée de minuit local à minuit local du lendemain. L'indicateur sert à l'affichage.
- **Saisie horaire :** en heure locale du cabinet (`2026-10-01T12:00`), convertie par le serveur. Une heure inexistante (saut d'heure du printemps) est refusée avec un message clair. Une heure ambiguë (automne) prend la première occurrence.
- **Motif :**
  - catégorie implicite par `kind`, plus un libellé court facultatif (100 caractères) ;
  - l'interface rappelle de n'y mettre aucune information médicale : un « arrêt maladie » est une donnée de santé du salarié. Le libellé « Absence » suffit.
- **Limites :** durée maximale d'un an ; les chevauchements entre indisponibilités sont permis (un blocage pendant un congé est sans effet).
- **Écritures :** création, modification et suppression, avec audit (horaires et motif ne sont pas des données patient) et verrou optimiste. La création prend le verrou du praticien, le même que prendront les rendez-vous en Phase 5.
- **Pas de répétition** (« chaque mardi 12 h-13 h ») au MVP : une indisponibilité récurrente se traite par les horaires de travail. Une règle de répétition s'ajoutera si le besoin est confirmé.
- **Changement de fuseau du cabinet :**
  - les horaires gardent leur sens local (9 h reste 9 h) ;
  - les indisponibilités « journée entière » sont recalculées sur les minuits du nouveau fuseau, dans la même transaction ;
  - les autres gardent leurs instants.

## 5. Types de rendez-vous (`appointment_types`)

| Colonne | Règle |
|---|---|
| `name` | 1 à 100 caractères ; unique parmi les types actifs du cabinet (sans tenir compte de la casse) |
| `duration_minutes` | 5 à 480, multiple de 5 : durée proposée ; un rendez-vous pourra s'en écarter |
| `color` | `#RRGGBB` |
| `status`, `version` | `ACTIVE` / `ARCHIVED` ; verrou optimiste |

Communs à tous les praticiens au MVP.

**Extensions possibles sans refonte (non réalisées) :**
- types réservés à certains praticiens, avec une durée propre à chacun : table de liaison `appointment_type_practitioners` ;
- temps de préparation après le soin ;
- tarif par défaut (Phase 7).

## 6. Calcul des disponibilités

Pour un praticien et une période en dates locales (62 jours au plus) :

```
travail     = pour chaque date d : plages du jour ISO de d, dans la période d'horaires
              qui couvre d, converties en instants (heure locale → UTC, fuseau du cabinet)
indispo     = ABSENCE et BLOCK du praticien et de tout le cabinet qui chevauchent la période
disponible  = travail − indispo
```

- **Conversion :** chaque bord de plage est construit en heure murale (date + heure + minute dans le fuseau), jamais par « minuit + N minutes ». Ce calcul serait faux d'une heure les jours de changement d'heure.
- **Changement d'heure :**
  - une plage de 1 h à 4 h dure 2 h réelles le jour du passage à l'heure d'été et 4 h le jour du retour à l'heure d'hiver ;
  - une fin à 24 h correspond au minuit local suivant.
- **Créneaux** (fonction prête et testée, exposée en Phase 5) : débuts alignés sur l'horloge locale selon un pas (15 min par défaut) où la durée demandée tient entière dans une plage disponible. La Phase 5 retirera en plus les rendez-vous existants.

## 7. Règles préparées pour les rendez-vous (Phase 5)

| # | Règle | Mécanisme prévu |
|---|---|---|
| R1 | Un rendez-vous a un praticien, un patient, un type, `[start_at, end_at)` en UTC, sur la grille de 5 min | Colonnes et contraintes `CHECK` |
| R2 | Jamais deux rendez-vous non annulés qui se chevauchent pour un praticien | `EXCLUDE USING gist (practitioner_id =, tstzrange(start_at, end_at) &&) WHERE status <> 'CANCELLED'` (extension `btree_gist` installée dès la Phase 4) |
| R3 | Refus pendant une `ABSENCE` du praticien ou du cabinet | Vérification dans le service, sous verrou du praticien |
| R4 | Hors horaires ou sur un `BLOCK` : refus, sauf confirmation explicite de la personne (urgence, dépassement), tracée dans l'audit | Paramètre explicite, audit |
| R5 | Une indisponibilité et un rendez-vous créés en même temps sont sérialisés : le second voit le premier | `pg_advisory_xact_lock` par praticien, pris par les horaires et indisponibilités (Phase 4) et par les rendez-vous (Phase 5) ; tous les praticiens du cabinet pour une indisponibilité de tout le cabinet, dans un ordre fixe (pas d'interblocage) |
| R6 | Créer une indisponibilité ou changer des horaires ne déplace ni n'annule aucun rendez-vous : les rendez-vous en conflit sont listés, la personne décide | Liste renvoyée par l'API (Phase 5) |
| R7 | Un praticien archivé ne reçoit plus de rendez-vous ; son archivage est refusé s'il a des rendez-vous futurs | Service (Phase 5) |
| R8 | Tout ce qui est échangé avec l'interface est soit un instant UTC ISO, soit une date ou heure locale du cabinet explicitement nommée comme telle | Contrats Zod |

## 8. Fauteuils et salles plus tard, sans refonte

Ajouts prévus, tous additifs (aucune donnée existante à transformer) :
1. **Table `rooms`** (cabinet, nom, statut).
2. **`appointments.room_id`** facultatif, avec une seconde exclusion `(room_id =, plage &&) WHERE room_id IS NOT NULL AND status <> 'CANCELLED'`.
3. **`availability_blocks.room_id`** facultatif, avec la contrainte `num_nonnulls(practitioner_id, room_id) <= 1` (les deux vides = tout le cabinet).
4. **Horaires éventuels des salles :** `working_schedules.room_id` facultatif, avec au plus une ressource par période.
5. **Calcul :** disponibilité d'une salle = même fonction pure. Créneau réservable = intersection des disponibilités du praticien et de la salle (même fonction d'intervalles).
6. **Types de rendez-vous :** exigence facultative d'un type de salle (table de liaison).

Le verrou par praticien s'étend aux salles avec une clé par ressource.

## 9. Profil du cabinet (priorité « gestion du cabinet »)

- **Colonnes ajoutées à `clinics`** : adresse (2 lignes), code postal, ville, téléphone (E.164), e-mail, toutes facultatives.
- **Modification :** réservée à `clinic.settings.manage`, avec audit ; le changement de fuseau suit la section 4.

## 10. Permissions

Aucune nouvelle permission.

| Action | Permission |
|---|---|
| Voir praticiens, types, horaires, indisponibilités, disponibilités | `appointment.read` (tous les rôles) |
| Créer, modifier, archiver un praticien ou un type ; profil du cabinet | `clinic.settings.manage` |
| Horaires et indisponibilités d'un praticien | `schedule.manage_any`, ou `schedule.manage_own` si le praticien est lié au compte |
| Indisponibilité de tout le cabinet | `schedule.manage_any` |

- **Route :** elle déclare les permissions acceptées (`manage_own` ou `manage_any`).
- **Service :** il vérifie la portée exacte (propriétaire du praticien).

## 11. Options écartées

| Option | Raison |
|---|---|
| Horaires stockés en UTC | Faux après chaque changement d'heure |
| Horaires sans période de validité | Un changement futur réécrirait le passé et les rendez-vous déjà pris |
| Horaires en JSON dans une seule colonne | La base ne pourrait plus garantir l'absence de chevauchement ni être interrogée en SQL par la Phase 5 |
| Table générique `resources` (praticien, salle…) dès maintenant | Abstraction sans usage actuel et intégrité plus faible (clés polymorphes) ; les ajouts de la section 8 suffisent |
| Horaires d'ouverture du cabinet en table | Doublon sans garantie supplémentaire (section 3) |
| Conversion des fuseaux dans le navigateur | Faux si le poste n'est pas dans le fuseau du cabinet |
| Temporal (API native) | Absent de Node 22 ; Luxon est prévu par l'architecture (section B) |
