# Scénario de démonstration : d'un cabinet neuf à l'usage quotidien

Ce scénario sert trois usages :
- démonstration du produit ;
- recette manuelle ;
- test automatisé `e2e/tests/01-demo.spec.ts`, joué à chaque envoi par la CI sur la pile de production.

Toutes les données sont fictives.

## Lancer la version automatique

```bash
pnpm dev:db                                    # PostgreSQL local, si pas de Docker
pnpm build                                     # la démonstration tourne sur le build de production
pnpm --filter @dental/e2e exec playwright test tests/01-demo.spec.ts             # le scénario seul
pnpm --filter @dental/e2e exec playwright test tests/01-demo.spec.ts --headed    # navigateur visible
pnpm --filter @dental/e2e exec playwright show-report artifacts/report          # rapport et traces
```

`pnpm e2e` fait le build puis lance toute la suite (52 parcours, environ 5 minutes).

La pile est démarrée par le test lui-même (base `dental_e2e` recréée, migrations, API, worker, interface compilés).

Le navigateur est réglé sur New York et le cabinet sur Paris : toute heure affichée doit être celle de Paris.

## Personnages

| Personne | Rôle | Appareil |
|---|---|---|
| Anne Martin | Administratrice du « Cabinet des Lilas » | Ordinateur |
| Paul Lefort | Dentiste, praticien « Dr Lefort » | Téléphone |
| Julie Roche | Secrétaire | Tablette |

## Déroulé

| # | Qui | Action | Ce qu'on doit voir |
|---|---|---|---|
| 1 | Exploitant | `pnpm admin:create-clinic --name "Cabinet des Lilas" --timezone Europe/Paris …` puis `pnpm admin:create-admin` | Identifiant du cabinet ; mot de passe temporaire affiché une seule fois |
| 2 | Anne | Première connexion : nouveau mot de passe, puis double authentification (application TOTP) | Accueil avec l'encadré « Mise en route du cabinet » |
| 3 | Anne | Cabinet → profil (adresse, téléphone) | « Profil enregistré. » |
| 4 | Anne | Utilisateurs → comptes de Paul (dentiste) et Julie (secrétaire) | Mot de passe temporaire de chacun, à transmettre hors de l'application |
| 5 | Anne | Praticiens : « Dr Lefort » lié au compte de Paul, « Hygiéniste Hélène » ; types « Consultation » (30 min) et « Détartrage » (45 min) | Listes à jour |
| 6 | Anne | Disponibilités → Horaires du Dr Lefort : lundi à vendredi, 9 h-12 h et 14 h-18 h | 10 plages enregistrées |
| 7 | Anne | Absences et blocages : formation du Dr Lefort sur un jour ouvré | Absence listée |
| 8 | Anne | Patients → Importer un fichier (`e2e/fixtures/patients.csv`, 6 lignes) | 4 patients importés ; une ligne sans prénom et un doublon signalés ; heure de l'import à l'heure de Paris |
| 9 | Julie | Première connexion sur tablette ; nouveau patient « FABREGAS Noé » | Fiche créée |
| 10 | Julie | Agenda : rendez-vous à 10 h ; 10 h 15 refusé (créneau pris) ; 19 h accepté après « Confirmer quand même » ; jour d'absence refusé ; deux rendez-vous d'hier saisis après coup | Refus explicites, sans bouton de confirmation pour le créneau pris et l'absence |
| 11 | Paul | Première connexion sur téléphone (double authentification) ; rendez-vous d'hier : 10 h « honoré », 11 h « patient absent » | Statuts à jour, page lisible sans défilement horizontal |
| 12 | Paul | « Encaisser » depuis le rendez-vous : 60 € dus, 20 € en espèces ; 40 € par carte, annulés avec motif (erreur de moyen), puis 40 € par chèque | Restant dû 40 € puis 0 € ; paiement annulé barré, avec motif et auteur |
| 13 | Julie | Acte « Détartrage » 45 € pour Brissac, 15 € payés | « À encaisser » : 30,00 € |
| 14 | Paul | Statistiques d'hier à aujourd'hui | Revenus 75,00 € ; 1 honoré ; présence 50 % |
| 15 | Anne | Journal : action « Paiement annulé », puis « Import validé » | Une entrée chacune, avec l'auteur (Paul, Anne) et le patient concerné |
| 16 | Julie | Recherche rapide « Castag… » depuis l'en-tête | Fiche de Castagnet Chloé |

À chaque étape, la version automatique contrôle aussi la base par une requête SQL indépendante :
- nombre de plages horaires et de patients importés ;
- statuts des rendez-vous ;
- montants encaissés et annulés ;
- chiffres des statistiques.

## Aller plus loin

Les autres parcours de `e2e/tests/` montrent ce qui ne figure pas dans la démonstration :
- deux secrétaires sur le même créneau ;
- double clic et réseau coupé ;
- changement d'heure ;
- second cabinet isolé ;
- accessibilité ;
- charge et restauration.

Résultats et chiffres : [`docs/phases/phase-10.md`](phases/phase-10.md).
