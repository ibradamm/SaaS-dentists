# Phase 5 — Rendez-vous et agenda : rapport

Date : 2026-09-27. Statut : **code et tests locaux terminés** ; résultat de la CI GitHub consigné dans le résumé de fin de phase. En attente de validation avant la Phase 6.

**Décisions du porteur du projet (2026-09-26) :**
1. hors horaires ou sur un créneau bloqué : rendez-vous possible seulement après confirmation explicite, tracée dans l'audit ;
2. aucun rendez-vous pendant une absence ;
3. statuts du MVP : prévu, honoré, patient absent, annulé, avec un modèle extensible ;
4. la durée du type est une valeur par défaut, modifiable par rendez-vous ;
5. pas de table d'horaires d'ouverture.

L'analyse préalable (invariants, modèle, règles) est l'ADR 0007.

## Livré

| Élément | Emplacement |
|---|---|
| Analyse : invariants I1 à I8, statuts extensibles, règles d'écriture, liens avec les autres modules, choix de l'agenda maison | `docs/adr/0007-rendez-vous-et-agenda.md` |
| Tables `appointment_statuses` et `appointments` ; RLS activée et forcée ; clés composites ; contraintes d'exclusion praticien **et** patient limitées aux statuts qui occupent le créneau ; `occupies_slot` imposé par déclencheur ; ni `DELETE` ni modification du patient ou de `occupies_slot` pour le rôle applicatif ; grille de 5 min et durée de 5 à 480 min en `CHECK` | migrations 0011 et 0012 |
| Statuts et transitions dans le code partagé ; codes d'erreur `AVAILABILITY_CONFIRMATION_REQUIRED`, `PRACTITIONER_ABSENT`, `SLOT_UNAVAILABLE` | `packages/shared/src/appointments.ts` |
| Évaluation d'un créneau (absence, hors horaires, blocage) | `modules/appointments/rules.ts` |
| Création, déplacement, changement de praticien, de type, de durée ou de note ; statuts ; historique d'un patient ; créneaux libres. Verrou du praticien, verrou optimiste, audit sans nom ni note | `modules/appointments/appointments.service.ts` |
| Liens avec les autres modules : conflits listés (jamais modifiés) à la pose d'une absence, d'un blocage ou d'un changement d'horaires ; disponibilités moins les rendez-vous ; archivage d'un praticien ou d'un patient refusé s'il a des rendez-vous prévus ; annulation d'import qui épargne les patients ayant un rendez-vous | `schedules.service.ts`, `practitioners.service.ts`, `patients.service.ts`, `imports.service.ts` |
| API rendez-vous, historique patient, créneaux libres ; écritures d'horaires et d'indisponibilités renvoyant les conflits | `api/routes/appointments.ts`, `api/routes/scheduling.ts` |
| Interface « Agenda » : vue jour (une colonne par praticien) et semaine (un praticien), en heure du cabinet ; horaires, absences et blocages visibles ; clic sur un créneau libre ou bouton « Nouveau rendez-vous » ; recherche du patient ; durée du type proposée et modifiable ; créneaux libres proposés ; confirmation explicite « Confirmer quand même » ; fiche avec statuts, annulation motivée, déplacement | `apps/web/src/pages/agenda/` |
| Fiche patient : rendez-vous à venir et historique, « Prendre rendez-vous » (formulaire prérempli) | `pages/patients/PatientAppointments.tsx` |
| Disponibilités : rendez-vous touchés listés après une absence, un blocage ou un changement d'horaires, avec lien vers chacun | `pages/agenda/ConflictsNotice.tsx` |

## Vérifications exécutées

Environnement : Node 22.22, PostgreSQL 16 local.

| Vérification | Résultat |
|---|---|
| Formatage, lint, typage | OK |
| Tests `packages/shared` | 66/66 |
| Tests `apps/server` : unitaires | 80/80 |
| Tests `apps/server` : intégration (base jetable, rôle applicatif réel) | 195/195 |
| Tests `apps/web` | 63/63 |
| Suite d'intégration rejouée après la correction d'un test instable (voir « Défauts trouvés ») | 8 fois sur 8 au vert |
| Tests par mutation (voir ci-dessous) | 15 failles introduites, 15 détectées |
| Parcours réel dans Chromium, poste réglé sur New York, cabinet à Paris | OK après 1 correction |
| Dérive schéma/migrations, build, `pnpm audit --prod` | Aucune dérive ; OK ; aucune vulnérabilité connue |

**Nouveaux tests principaux :**
- **Base, en SQL brut, sans le service :**
  - chevauchement refusé pour le praticien, et pour le patient chez un autre praticien ;
  - plages adjacentes permises ;
  - `occupies_slot` imposé par le déclencheur ;
  - « annulé » et « patient absent » libèrent le créneau ;
  - grille et durée ;
  - refus des droits (`DELETE`, modification de `occupies_slot` ou du patient, ajout de statut) ;
  - isolation entre cabinets.
- **Services (intégration) :**
  - durée par défaut et durée modifiée ;
  - heure locale convertie en UTC de part et d'autre du changement d'heure ; heure inexistante refusée ;
  - confirmation exigée hors horaires et sur un blocage, puis tracée à part ;
  - absence du praticien ou du cabinet : refus même avec confirmation ;
  - **deux créations simultanées** : une seule réussit ;
  - **verrou** : une absence en cours de création (non validée) bloque la prise de rendez-vous, qui la voit ensuite et refuse ;
  - transitions de statut ; « honoré » seulement après l'heure de début ; « patient absent » libère le créneau ; retour à « prévu » refusé si le créneau a été repris ;
  - version périmée refusée ;
  - déplacement avec audit avant/après ;
  - conflits listés ; disponibilités et créneaux libres ;
  - archivages refusés ; annulation d'import ;
  - isolation.
- **API :**
  - matrice des rôles ; 401 ; CSRF ;
  - parcours de confirmation ;
  - **deux secrétaires sur le même créneau** : 201 et 409 ;
  - codes 400, 404 et 409 ; historique ; créneaux libres.
- **Interface :**
  - vue jour et vue semaine ; cabinet à New York ;
  - aucune confirmation envoyée d'office, et modifier la saisie l'annule ;
  - absence sans dérogation possible ;
  - clic sur la grille ; durée du type ; créneau proposé ;
  - statuts ; version périmée ; seuls les champs modifiés envoyés ;
  - lien depuis la fiche patient ; consultation seule sans droit d'écriture ;
  - conflits affichés après une absence ;
  - placement sur la grille (fonctions pures) et heure murale (dates) avec changements d'heure.

### Tests par mutation

Chaque faille a été introduite seule, les tests concernés rejoués, puis le fichier restauré (script hors dépôt).

| # | Faille introduite | Détectée par |
|---|---|---|
| M1 | Contrainte d'exclusion « praticien » retirée | Tests SQL brut, catalogue |
| M2 | « Patient absent » occupe le créneau | Tests SQL brut, service |
| M3 | Contrainte d'exclusion « patient » retirée | Test SQL brut (ajouté pendant la phase), catalogue |
| M4 | Droit `UPDATE` sur `occupies_slot` accordé | Tests SQL brut, catalogue |
| M5 | RLS non forcée sur `appointments` | Catalogue |
| M6 | Contrôle d'absence retiré | Service, API |
| M7 | Dérogation acceptée sans confirmation | Service, API |
| M8 | Dérogation non tracée dans l'audit | Service |
| M9 | Verrou du praticien retiré à la création | Test du verrou (ajouté pendant la phase) |
| M10 | « Honoré » avant l'heure de début | Service, API |
| M11 | « Annulé » → « prévu » permis | Tests des transitions, service |
| M12 | Heure saisie lue en UTC (fuseau du serveur) | Service et API (11 tests en échec) |
| M13 | Annulation d'import sans épargner les patients ayant un rendez-vous | Service |
| M14 | Interface : confirmation envoyée d'office | Tests de l'interface |
| M15 | Interface : heure affichée dans le fuseau du poste | Tests des dates, de la grille et de l'agenda |

M3 et M9 n'étaient **pas** couvertes à la première lecture des tests : le contrôle préalable du service masquait l'absence de la contrainte « patient », et la contrainte d'exclusion masquait l'absence du verrou pour la double réservation. Deux tests ont été ajoutés. Le second met en scène de façon déterministe une absence non validée qui tient le verrou. Chacun échoue sur la faille correspondante.

### Parcours réel dans Chromium

Conditions : poste réglé sur New York, cabinet à Paris. Il était 00:52 le dimanche 27 à Paris, et encore le samedi 26 sur le poste.

1. **Agenda :** ouvert sur « Dimanche 27 septembre 2026 », date du cabinet et non du poste.
2. **Deux secrétaires sur deux sessions** valident en même temps Dr Démo le lundi 28, à 10:00 et à 10:15 :
   - l'une obtient « Rendez-vous enregistré » ;
   - l'autre, « Le praticien a déjà un rendez-vous sur ce créneau ».
3. **Hors horaires** (19:00) :
   - l'avertissement donne la raison et rappelle la trace dans l'audit ;
   - le rendez-vous n'est enregistré qu'après « Confirmer quand même ».
4. **Déplacement** vers 15:00, choisi parmi les créneaux libres proposés (09:00 à 09:30 puis 10:30… : 09:45 à 10:15 exclus, car ils chevauchent le rendez-vous de 10:00).
5. **Vue semaine :** mercredi après-midi non travaillé, heures de Paris.
6. **Absence « Formation » posée le mardi 29** sur un rendez-vous existant :
   - « 1 rendez-vous prévu est pendant cette absence… », avec un lien vers lui ;
   - rendez-vous inchangé ;
   - nouveau rendez-vous ce jour-là refusé, sans bouton de confirmation.
7. **Statuts :**
   - « Marquer honoré » désactivé avant l'heure ;
   - annulation avec motif ; visible avec « Afficher les annulés » ;
   - rendez-vous passé (vendredi 25) : « honoré », puis correction possible.
8. **Fiche patient :** historique affiché ; « Prendre rendez-vous » ouvre le formulaire avec le patient présélectionné.
9. **Dentiste sur téléphone (390 px) :** vue jour lisible, aucun débordement horizontal de la page.
10. **Contrôle en base et dans les journaux :**
    - 10:00 à Paris stocké 08:00 UTC ;
    - audit : identifiants, instants et raisons de dérogation seulement (ni nom, ni note, ni texte du motif) ;
    - journaux de l'API : aucune donnée patient, aucune chaîne de requête, aucune erreur.

## Défauts trouvés et corrigés pendant la phase

1. **Création refusée par la base (42501).**
   - Cause : l'ORM cite toutes les colonnes dans l'`INSERT`, et les droits d'insertion étaient accordés colonne par colonne.
   - Correction : droit `INSERT` sur la table. `occupies_slot` reste imposé par le déclencheur, ce que le test SQL brut vérifie.
   - La migration 0012 a été corrigée **avant tout partage** ; la base locale a été recréée. Aucune migration poussée n'a été modifiée (ADR 0002).
2. **Deux trous de couverture** révélés en préparant les mutations (M3, M9 ci-dessus). Deux tests ont été ajoutés.
3. **Test instable** : 2 échecs sur 10 exécutions de la suite d'intégration.
   - Cause : la lecture de l'audit sans `ORDER BY`, dont l'ordre n'est pas garanti par PostgreSQL.
   - Correction : tri explicite par date puis par identifiant (UUID v7 monotone). La suite est ensuite passée 8 fois sur 8.
4. **Accessibilité : noms annoncés des rendez-vous sans séparateurs** dans certains calculs de nom accessible. Remplacés par une étiquette explicite qui reprend le texte visible.
5. **Typographie : « Lundi 28 Septembre ».**
   - Cause : la classe CSS `capitalize` met une majuscule à chaque mot.
   - Correction : majuscule sur la première lettre seulement.
   - Le défaut existait aussi dans la vue « Semaine » des disponibilités (Phase 4). Trouvé dans le parcours Chromium.
6. **Règles de pureté React** : l'heure courante était lue pendant le rendu. Elle passe par un hook rafraîchi chaque minute, qui met aussi à jour la ligne « maintenant » et l'accès à « honoré ».

## Écarts par rapport au plan

1. **Agenda maison au lieu de FullCalendar** : fuseau nommé du cabinet, taille de l'application (ADR 0007, section 7).
2. **Pas de glisser-déposer** : le déplacement passe par la fiche, avec les créneaux libres proposés.
3. **Pas de création de patient depuis le formulaire de rendez-vous** : on le crée d'abord dans « Patients ». Candidat pour la Phase 6 (parcours quotidiens).

## Limites connues

- **Heure répétée au passage à l'heure d'hiver** (2 h-3 h) : elle n'est pas dédoublée sur la grille. Elle est hors des horaires des cabinets (ADR 0007).
- **Déplacement :** les créneaux proposés excluent la place actuelle du rendez-vous. Un décalage qui chevauche sa propre place se saisit à la main ; le serveur l'accepte.
- **Rendez-vous dans le passé :** acceptés, pour la saisie a posteriori, avec confirmation seulement s'ils sont hors horaires. Voir la question ci-dessous.
- **Rafraîchissement :** l'agenda se met à jour au retour sur la page ou sur la fenêtre, pas en direct. Un créneau pris entre-temps par une collègue est refusé à l'enregistrement.
- **Vue jour avec beaucoup de praticiens :** la grille défile horizontalement dans son cadre.
- **Application web :** 660 ko (191 ko compressés), 33 ko de plus qu'en Phase 4 ; pistes en Phase 6.
- **Parcours Chromium :** toujours exécuté depuis un script hors dépôt (automatisation en Phase 10).

## Question pour la validation

**Rendez-vous créé dans le passé.**
- **Aujourd'hui :** accepté.
- **Risque :** une erreur de date passe inaperçue.
- **Proposition :** exiger la même confirmation explicite que hors horaires, avec la raison « dans le passé », tracée dans l'audit.
- **Coût :** une raison de dérogation de plus et ses tests.
