# Phase 8 — Tableau de bord et statistiques : rapport

Date : 2026-09-27. Statut : **code et tests locaux terminés** ; résultat de la CI GitHub consigné dans le résumé de fin de phase. En attente de validation avant la Phase 9.

> **Mise à jour après validation (2026-09-27).**
> - L'occupation compte désormais les patients absents : c'est l'« occupation du planning ».
> - Le taux de présence s'affiche à côté du taux d'absence.
> - Les rendez-vous marqués « sans facturation » ne sont plus des oublis d'encaissement.
>
> Voir l'ADR 0010, section 10, et le rapport de la Phase 9. Les chiffres ci-dessous sont ceux de la version validée.

## Réponses du porteur du projet (validation de la Phase 7)

| # | Réponse | Où c'est consigné et comment c'est tenu |
|---|---|---|
| 1 | Le dentiste voit les revenus de tout le cabinet, répartis par praticien. Une limitation future à ses propres revenus doit rester possible | ADR 0009, section 10. Toute lecture de revenus (page « Revenus », journal, tableau de bord) passe par `revenueScope` (`modules/finance/queries.ts`). La limitation s'ajoutera par une permission `finance.reports.read_own` et une seconde branche de cette fonction, sans toucher aux requêtes |
| 2 | La secrétaire n'annule pas un acte, même non payé | Inchangé (`payment.void`) |
| 3 | Pas de clôture de période au MVP, mais possible plus tard sans refonte | ADR 0009, section 10 : les données (instants d'encaissement et d'annulation, jamais modifiés) permettent de recalculer une période « telle que connue » à une date ; le calcul des revenus a désormais une seule implémentation |
| 4 | Reçu patient plus tard | Ajouté aux extensions futures (`docs/future/README.md`), avec ses prérequis |

L'analyse de la Phase 8 est l'ADR 0010 : définition exacte de chaque indicateur, permissions, périodes et fuseaux, occupation, coût des requêtes.

## Livré

| Élément | Emplacement |
|---|---|
| Analyse : deux écrans (accueil « À suivre », page « Statistiques »), définitions, permissions par section, découpage temporel, période précédente, occupation, coût des requêtes, options écartées | `docs/adr/0010-tableau-de-bord-et-statistiques.md` |
| Périodes : jour, semaine (lundi-dimanche), mois, année ; période précédente et suivante (mois entiers décalés en mois, sinon même longueur) ; découpage jour, semaine ou mois ; contrôle d'une période saisie | `packages/shared/src/periods.ts` |
| Contrat de la réponse, sections facultatives | `packages/shared/src/stats.ts` |
| **Bornes des tranches construites dans le fuseau du cabinet** (`local-time.ts`), puis agrégation en base par `width_bucket` : aucune conversion de fuseau en SQL | `modules/scheduling/buckets.ts` |
| **Service de statistiques** : une transaction, sections calculées seulement si permises, agrégats SQL | `modules/stats/stats.service.ts` |
| Occupation : temps ouvert (horaires moins indisponibilités) et temps réservé limité à ce temps ouvert | `modules/stats/occupancy.ts` |
| **Lectures financières partagées** (revenus, restant dû, périmètre des revenus) ; la page « Revenus » de la Phase 7 passe de l'agrégation dans Node aux mêmes requêtes agrégées | `modules/finance/queries.ts` |
| Route `GET /api/dashboard?from&to&practitionerId` | `api/routes/stats.ts` |
| **Accueil, « À suivre »** : rendez-vous des 7 prochains jours, honorés aujourd'hui sans acte saisi, restant à encaisser, encaissé aujourd'hui. Même périmètre que la journée affichée (« Ma journée » ou tout le cabinet) | `pages/today/TodayIndicators.tsx` |
| **Page « Statistiques »** : période (boutons, flèches, dates libres), praticien ; huit indicateurs ; évolution des revenus ; activité par période ; occupation et revenus par praticien ; types les plus fréquents ; rendez-vous honorés sans acte avec lien « Encaisser » | `pages/stats/` |
| Graphiques écrits à la main : colonnes (empilées si plusieurs séries), barres, jauges ; légende, infobulle au survol et au clavier, tableau des valeurs ; palette validée pour la vision des couleurs | `pages/stats/charts.tsx` |

### Sections et permissions (calculées par le serveur)

| Section | Administrateur | Dentiste | Secrétaire |
|---|---|---|---|
| Activité, occupation, types fréquents, rendez-vous à venir | oui | oui | oui |
| Patients actifs et nouveaux | oui | oui | oui |
| Restant à encaisser, honorés sans acte | oui | oui | oui |
| Revenus, évolution, revenus par praticien | oui | oui | **non** : section absente de la réponse |

## Vérifications exécutées

Environnement : Node 22.22, PostgreSQL 16 local, Chromium 1194.

| Vérification | Résultat |
|---|---|
| Formatage, lint, typage | OK |
| Tests `packages/shared` | 77/77 |
| Tests `apps/server` : unitaires | 85/85 |
| Tests `apps/server` : intégration (base jetable, rôle applicatif réel) | 254/254 |
| Tests `apps/web` | 114/114 |
| Tests par mutation (voir ci-dessous) | 18 failles introduites, 18 détectées (dont une après renforcement d'un test) |
| Parcours réels dans Chromium, version de production, ordinateur, tablette et téléphone, deux cabinets | OK ; chiffres affichés identiques à un calcul SQL indépendant |
| Build, dérive schéma/migrations, `pnpm audit --prod` | OK (aucune migration dans cette phase) |
| Budget du chargement initial (`pnpm check:bundle`) | 144 ko compressés pour 160 ko ; la page « Statistiques » est chargée à la demande |

### Calculs testés sur des données connues

Le test d'intégration du service construit un jeu de septembre 2026 (cabinet à Paris), dont chaque total est calculé à la main dans le test :
- **Bords de mois en heure de Paris** : un rendez-vous et un paiement du 1er septembre à 0 h 30 (31 août en UTC) comptent en septembre ; ceux du 1er octobre à 0 h 30 (30 septembre en UTC) comptent en octobre.
- **Changement d'heure** : la journée du 25 octobre dure 25 heures ; 0 h 30 et 23 h 30 le 25 tombent le 25, 0 h 30 le 26 tombe le 26.
- **Occupation** :
  - Dr A : 22 jours ouvrés × 3 h, moins une absence, soit 3 780 min ouvertes et 105 min réservées ;
  - les rendez-vous hors horaires, absents et annulés ne comptent pas ;
  - un praticien archivé sans horaires reste affiché, avec un taux vide.
- **Nouveaux patients** : imports exclus. **Patients vus** : patients distincts avec un rendez-vous honoré.
- **Revenus** : paiements annulés à part, période précédente, filtre praticien.
- **Honorés sans acte** : un acte annulé ne compte pas comme acte saisi.
- **Données vides** : zéros, séries complètes, taux `null` (jamais 0 % ni division par zéro).
- **Isolation** : l'autre cabinet, chargé sur la même période, n'apparaît jamais ; un praticien d'un autre cabinet donne 404.
- **Permissions** : la section revenus est absente de la réponse faite à la secrétaire.

### Performance (une année de données)

Deux cabinets chargés chacun de 4 praticiens, 5 000 patients, 16 704 rendez-vous et 10 320 paiements. Nombre de requêtes SQL mesuré par appel, transaction comprise :

| Appel | Temps local | Requêtes |
|---|---|---|
| Tableau de bord, jour | 38 à 53 ms | 22 |
| Tableau de bord, semaine | 48 à 64 ms | 22 |
| Tableau de bord, mois | 90 à 97 ms | 22 |
| Tableau de bord, année | 269 à 347 ms | 22 |
| Tableau de bord, année, un praticien | 117 à 134 ms | 23 |
| Page « Revenus », année | 61 à 89 ms | 10 |

- Le nombre de requêtes ne dépend ni du volume ni de la longueur de la période.
- Le test échoue au-delà de 25 requêtes ou de 3 secondes : plafond large pour une machine de CI partagée.
- Aucun index ajouté : les index existants (`appointments (clinic_id, start_at)`, `payments (clinic_id, received_at)`, `charges (appointment_id)`) suffisent aux temps mesurés.
- Dans Chromium, sur le cabinet de démonstration (2 841 rendez-vous), l'API a répondu en 41 ms pour un mois et 87 ms pour une année.

### Tests par mutation

Chaque faille a été introduite seule, les tests concernés rejoués, puis le fichier restauré (script hors dépôt).

| # | Faille introduite | Détectée par |
|---|---|---|
| S1 | Tranches calculées dans le fuseau UTC (celui du serveur) | Service (bords de mois, changement d'heure) |
| S2 | Annulés comptés dans les rendez-vous de la période | Service |
| S3 | Occupation non limitée au temps ouvert | Unitaire, service |
| S4 | Absences et blocages ignorés dans le temps ouvert | Service |
| S5 | Imports comptés comme nouveaux patients | Service |
| S6 | Paiements annulés comptés dans les revenus | Service |
| S7 | Section revenus donnée à la secrétaire | Service, HTTP |
| S8 | Filtre praticien ignoré pour les revenus | Service |
| S9 | Acte annulé considéré comme saisi | Service |
| S10 | Taux à 0 sans dénominateur | Unitaire, service |
| S11 | Période précédente prise dans le mauvais sens | Service |
| S12 | Patients vus : tous statuts | Service, **après renforcement** : le jeu de test ne contenait aucun patient seulement absent |
| S13 | Une requête par tranche pour l'évolution des revenus | Performance (nombre de requêtes) |
| P1 | Semaine commençant le dimanche | Périodes, interface |
| W1 | « 0 % » affiché sans donnée | Interface |
| W2 | Indicateurs du jour de tout le cabinet sur « Ma journée » | Interface |
| W3 | Période incohérente envoyée au serveur | Interface |
| W4 | Menu « Statistiques » réservé aux revenus | Navigation |

### Parcours réels dans Chromium

Conditions :
- version de production (`vite build` puis `vite preview`), navigateur réglé sur New York, cabinets à Paris ;
- dimanche 27 septembre 2026 ;
- cabinet A chargé de janvier à octobre : horaires historiques, 350 patients dont 50 importés, 2 841 rendez-vous, 1 950 paiements. Cabinet B vide.

Valeurs de référence calculées **directement en SQL**, avec des bornes de mois en heure de Paris construites par PostgreSQL, donc indépendamment du code de l'application :

| Septembre 2026 | Calcul SQL | Affiché |
|---|---|---|
| Rendez-vous honorés | 204 | 204 |
| Patients absents | 35 | 35 |
| Revenus encaissés | 12 480,00 € | 12 480,00 € |
| Honorés sans acte | 24 | 24 |
| Revenus de l'année 2026 | 142 380,00 € | 142 380,00 € |

1. **Dentiste (ordinateur) :**
   - accueil : « À suivre », limité à son agenda (« Ma journée ») ;
   - « Statistiques » : septembre par défaut. Occupation 58 % (119 h 30 réservées sur 206 h ouvertes), taux d'absence 14,6 %, comparaisons avec août ;
   - survol d'une colonne : infobulle ; focus clavier : libellé complet (« mardi 8 septembre 2026 : Encaissé 1 230,00 € ») ;
   - année : 12 colonnes mensuelles ;
   - semaine, semaine précédente, filtre « Hygiéniste Démo » ; période libre incohérente refusée.
2. **Secrétaire (tablette) :**
   - accueil et statistiques sans aucun revenu ;
   - la réponse du serveur ne contient pas la section `revenue` ;
   - « Encaisser » depuis la liste des honorés sans acte ouvre le formulaire de la fiche patient sur ce rendez-vous.
3. **Téléphone** : aucun débordement horizontal (statistiques du mois et de l'année, accueil).
4. **Cabinet B** : ses seuls chiffres (zéro), rien du cabinet A.

## Défauts trouvés et corrigés pendant la phase

1. **Définition de l'occupation contraire au modèle des rendez-vous.**
   - La première version de l'analyse comptait les patients absents dans le temps réservé.
   - Or un absent libère son créneau (ADR 0007).
   - Corrigé avant le code : une seule définition du créneau occupé, pour l'agenda et les statistiques.
2. **`GROUP BY width_bucket(...)` refusé par PostgreSQL.**
   - L'expression répétée portait deux paramètres distincts.
   - Regroupement par position. Trouvé par les tests de la Phase 7, rejoués après le passage de la page « Revenus » aux requêtes agrégées.
3. **Libellé d'une semaine partielle faux.**
   - Il prenait sept jours à partir du premier jour de la tranche, au lieu du dimanche.
   - Corrigé, test ajouté.
4. **Test HTTP dépendant de l'horloge réelle.**
   - La date de création d'une fiche patient vient de l'horloge de la base, pas de l'horloge simulée des tests.
   - Les nouveaux patients sont vérifiés au niveau du service, à dates explicites.
5. **Trou de test** révélé par la mutation S12 (voir ci-dessus) : comblé.

## Écarts par rapport au plan

1. **Pas de bibliothèque de graphiques** (l'architecture prévoyait Recharts) : colonnes, barres et jauges écrites à la main, pour le poids. Tableau de l'architecture corrigé.
2. **Pas de nouvelle permission « statistiques »** : chaque section dépend de la permission de ses données (ADR 0010, section 5).
3. **Ajout non demandé** : « Rendez-vous honorés sans acte saisi », qui relie l'agenda aux paiements (oubli de facturation).

## Limites connues

- **Rendez-vous gratuits** (contrôle post-opératoire, par exemple) : ils apparaissent dans « honorés sans acte », faute de moyen de les marquer « sans facturation ».
- **Nouveaux patients** = fiches créées par le cabinet ; la date de création vient de l'horloge de la base.
- **Revenus par praticien** : selon le praticien de l'acte. Un acte sans rendez-vous ni praticien choisi compte dans « Non précisé ».
- **Occupation** : les rendez-vous accordés hors horaires ne comptent pas. Sur une période qui s'étend dans le futur, elle mesure le remplissage.
- **Revenus d'une période passée** : pas de clôture (réponse 3) ; une annulation ultérieure les modifie, et elle est visible.
- **Parcours Chromium** : toujours exécutés depuis un script hors dépôt (automatisation en Phase 10).

## Questions ouvertes

1. **Rendez-vous non facturables** : ajouter une case « sans facturation » au rendez-vous, pour qu'il sorte de « honorés sans acte » ?
2. **Objectifs** (revenus, taux d'occupation) et **export** (CSV) : à prévoir ou non ?
3. **Occupation et absences** : le choix actuel suit l'agenda (un absent libère le créneau). Préférez-vous un taux « réservé » qui compte aussi les absents ?
