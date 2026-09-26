# Phase 4 — Cabinet et disponibilités : rapport

Date : 2026-09-26. Statut : **code et tests locaux terminés** ; résultat de la CI GitHub consigné dans le résumé de fin de phase. En attente de validation avant la Phase 5.

**Décisions du porteur du projet :**
- un cabinet peut avoir un ou plusieurs praticiens ;
- pas de fauteuils ni de salles au MVP, avec un modèle qui permet de les ajouter sans refonte ;
- les disponibilités sont liées au praticien.

L'analyse préalable du modèle est l'ADR 0006.

## Livré

| Élément | Emplacement |
|---|---|
| Analyse du modèle : praticiens, horaires, disponibilités, absences, blocages, types, fuseaux, règles préparées pour les rendez-vous, extension aux salles | `docs/adr/0006-praticiens-horaires-disponibilites.md` |
| Tables `practitioners`, `appointment_types`, `working_schedules`, `working_intervals`, `availability_blocks` ; coordonnées du cabinet. RLS activée et forcée, droits par colonne, clés composites, contraintes d'exclusion (`btree_gist`) contre les chevauchements d'horaires | migrations 0009 et 0010 |
| Calcul pur des disponibilités : heure locale ↔ UTC en heure murale (Luxon), opérations sur intervalles génériques, créneaux alignés sur l'horloge locale (prêts pour la Phase 5) | `modules/scheduling/{local-time,intervals,availability}.ts` |
| Praticiens liés ou non à un compte membre du cabinet ; types de rendez-vous ; archivage ; verrou optimiste | `practitioners.service.ts` |
| Horaires datés (« à partir du… ») sans réécriture du passé ; suppression d'un changement prévu ; verrou par praticien | `schedules.service.ts` |
| Absences et blocages d'un praticien ou de tout le cabinet, en journées entières ou en heures locales ; heure inexistante (saut d'heure) refusée | `schedules.service.ts` |
| Portée des droits : le dentiste gère **son** agenda ; secrétariat et administrateur, tous les agendas et le cabinet entier | `modules/scheduling/access.ts`, route `anyPermission` |
| Profil du cabinet : coordonnées ; au changement de fuseau, recalage des absences en journées entières | `clinic.service.ts` |
| API : praticiens, types, horaires, indisponibilités, disponibilités | `api/routes/scheduling.ts` |
| Interface : menu « Disponibilités » (semaine, horaires, absences et blocages) et « Cabinet » (profil, praticiens, types). Choix du praticien masqué s'il n'y en a qu'un ; « M'ajouter comme praticien » pour le cabinet individuel ; affichage dans le fuseau du cabinet quel que soit celui du poste | `apps/web/src/pages/availability/`, `pages/settings/` |
| Données de démonstration : deux praticiens, horaires, types de rendez-vous | `db/cli/seed.ts` |

## Vérifications exécutées

Environnement : Node 22.22, PostgreSQL 16 local.

| Vérification | Résultat |
|---|---|
| Formatage, lint, typage | OK |
| Tests `packages/shared` | 59/59 |
| Tests `apps/server` : unitaires | 76/76 |
| Tests `apps/server` : intégration (base jetable, rôle applicatif réel) | 158/158 |
| Tests `apps/web` | 45/45 |
| Suite serveur complète rejouée 6 fois après le correctif du déploiement (voir « Défauts trouvés ») | 6 fois sur 6 au vert |
| Tests par mutation (voir ci-dessous) | 13 failles introduites, 12 détectées, 1 équivalente |
| Parcours réel dans Chromium, navigateur réglé sur le fuseau de New York | OK après 2 corrections |
| Dérive schéma/migrations, build, `pnpm audit --prod` | Aucune dérive ; OK ; aucune vulnérabilité connue |

**Nouveaux tests principaux :**
- **Moteur de calcul (unitaires) :**
  - heures murales en hiver et en été ;
  - jours du changement d'heure : une plage de 1 h à 4 h dure 2 h au printemps et 4 h à l'automne ; journées de 23 h et de 25 h ;
  - heure inexistante refusée, heure ambiguë résolue sur la première occurrence ;
  - fuseau à demi-heure (Calcutta) ; changement d'heure de New York ;
  - soustraction d'intervalles ; créneaux alignés sur l'horloge locale.
- **Services (intégration) :**
  - lien praticien ↔ compte limité aux membres du cabinet ;
  - horaires datés : arrêt de la période en cours, périodes futures conservées, remplacement le même jour, suppression d'un changement prévu ;
  - refus des dates passées et des versions périmées ;
  - **deux tests de concurrence** : dates différentes, et même période ;
  - absences de part et d'autre du changement d'heure ;
  - portée des droits du dentiste ;
  - calcul des disponibilités ;
  - recalage au changement de fuseau ;
  - isolation entre cabinets.
- **RLS en SQL brut** sur les 5 nouvelles tables : lecture, insertion, modification et suppression pour un autre cabinet ; aucune suppression de praticien ni de type.
- **API :**
  - matrice des permissions par rôle (le dentiste reçoit 403 sur l'agenda d'un confrère) ;
  - parcours complet du dentiste sur son propre agenda ;
  - codes 400, 404 et 409 ; CSRF.
- **Interface :**
  - cabinet à un seul praticien, puis à plusieurs ;
  - lecture seule sur l'agenda d'un confrère ;
  - envoi de la période de référence ; blocage des plages qui se chevauchent ;
  - portée des absences ;
  - aucune disponibilité périmée affichée après une modification ;
  - paramètres réservés à l'administrateur ; champs modifiés seuls envoyés.

### Tests par mutation

| Faille introduite | Détectée |
|---|---|
| Politique RLS `practitioners` ouverte à tous | Oui (test RLS) |
| Contrainte d'exclusion des périodes retirée | Oui (catalogue) |
| Verrou du praticien retiré (horaires) | Oui, 3 exécutions sur 3 (remplacements simultanés) |
| Contrôle d'identité de la période retiré (version seule) | Oui (concurrence) |
| Dentiste autorisé sur l'agenda d'un confrère | Oui |
| Dentiste autorisé à bloquer tout le cabinet | Oui |
| Heure murale calculée « minuit + minutes » | Oui (tests du changement d'heure) |
| Heure inexistante acceptée | Oui |
| Blocages ignorés dans le calcul des disponibilités | Oui |
| Horaires rétroactifs acceptés | Oui |
| Pas de recalage des absences au changement de fuseau | Oui |
| Interface : agenda d'un confrère modifiable | Oui |
| Route sans contrôle « au moins une permission » | **Non**, faille équivalente : le service refuse toujours. La route est une première barrière (même cas qu'en Phase 3). |

### Parcours réel dans Chromium (poste réglé sur New York, cabinet à Paris)

1. **Administrateur :**
   - profil du cabinet enregistré : ville sans espaces superflus, téléphone normalisé ;
   - praticiens de démonstration visibles ; type « Contrôle 15 min » ajouté ;
   - semaine du 28 septembre : 09:00–12:00 et 14:00–18:00 ;
   - fermeture du cabinet le 5 octobre, puis réunion de 10 h à 11 h le 28 septembre ; la semaine affiche 09:00–10:00, 11:00–12:00, 14:00–18:00 ;
   - plus de mercredi à partir du 12 octobre : deux périodes, et le mercredi 21 octobre est libre ;
   - **lundi 26 octobre**, après le passage à l'heure d'hiver : 09:00–12:00 affiché, alors que le navigateur est à l'heure de New York.
2. **Dentiste (téléphone) :**
   - pas de menu « Cabinet » ;
   - son agenda présélectionné et modifiable ;
   - « Tout le cabinet » non proposé ;
   - agenda de l'hygiéniste en lecture seule ; `PUT` direct → 403.
3. **Secrétaire :** modifie les horaires de l'hygiéniste ; « Cabinet » refusé.
4. **Contrôle en base :**
   - réunion stockée de 08:00 à 09:00 UTC ;
   - fermeture de minuit à minuit, heure de Paris ;
   - deux périodes contiguës ;
   - audit sans libellés ni coordonnées ;
   - aucune donnée sensible dans les journaux.

## Défauts trouvés et corrigés pendant la phase

Chaque correctif est accompagné d'un test vérifié en échec sur l'ancien code.

1. **Horaires : deux modifications simultanées pouvaient réussir toutes les deux.**
   - Cause : le contrôle ne comparait que la version, alors qu'une période créée entre-temps peut porter le même numéro.
   - Correction : l'interface transmet l'identifiant **et** la version de la période lue.
   - Trouvé par le test de concurrence, avant tout essai manuel.
2. **Audit refusant les noms de champs contenant un chiffre** (`addressLine1`) : format des clés élargi.
3. **Déploiement : deux instances démarrant ensemble pouvaient échouer** (« tuple concurrently updated »).
   - Défaut présent depuis la Phase 1 : les droits sur la file de tâches étaient accordés hors du verrou des migrations.
   - Correction : un verrou de session couvre tout le déploiement.
   - Reproduction ciblée (4 déploiements simultanés sur base vierge, 8 tours) : 8 échecs sur 8 sans le correctif, 0 sur 8 avec.
   - Le test du migrateur passe désormais à 4 déploiements simultanés : il échoue 3 fois sur 3 sans le correctif.
4. **Interface : semaine affichée vide pendant le chargement** (données de la semaine précédente conservées). Remplacé par un indicateur de chargement.
5. **Interface : ancienne disponibilité affichée après un nouveau blocage**, le temps du rafraîchissement. Les disponibilités sont désormais retirées du cache après chaque modification.
6. **Interface : profil marqué « non enregistré » après l'enregistrement**, quand le serveur avait normalisé une valeur (espaces). Le formulaire reprend les valeurs renvoyées.

## Écarts par rapport au plan

1. **Pas de table d'horaires d'ouverture du cabinet.**
   - Les disponibilités dépendent des horaires des praticiens.
   - Les fermetures sont des absences « tout le cabinet ».
   - Raison : ADR 0006, section 3.
2. **Modification d'une absence :** disponible dans l'API (`PUT`), pas encore dans l'interface, où l'on supprime puis recrée.
3. **Blocages horaires sur un seul jour dans l'interface** ; l'API accepte plusieurs jours.

## Limites connues

- **Indisponibilités :**
  - pas de répétition (« chaque mardi ») : se traite par les horaires de travail ;
  - pas de liste des rendez-vous en conflit à la création d'un blocage, faute de rendez-vous (Phase 5, règle R6).
- **Horaires :**
  - pas d'horaires passant minuit ;
  - un horaire finissant à minuit se saisit « 23:59 » dans l'interface et s'enregistre 24:00.
- **Application web :** 627 ko (182 ko compressés) ; pistes en Phase 6 (rapport de la Phase 3).
- **Parcours Chromium :** toujours exécuté à la main depuis un script hors dépôt (automatisation en Phase 10).

## Reste à faire

Phase 5 (rendez-vous et agenda), après validation. Les règles R1 à R8 de l'ADR 0006 en sont le cahier des charges.
