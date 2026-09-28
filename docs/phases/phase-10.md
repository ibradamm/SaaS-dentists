# Phase 10 — Tests complets et validation globale : rapport

Date : 2026-09-28. Statut : **validée** par le porteur du projet le 2026-09-28. Le correctif d'idempotence des rendez-vous recommandé en section 2 est livré avec l'audit pré-production (`phase-11-audit-preproduction.md`).

Méthode et règles de test : ADR 0012. Scénario de démonstration : [`docs/demo.md`](../demo.md).

Ce rapport ne conclut ni « sécurisé à 100 % » ni « prêt pour la production ». Il dit ce qui a été vérifié, comment, et ce qui reste à faire (sections 7, 9 et 10).

## Réponses du porteur du projet (validation de la Phase 9)

| # | Réponse | Suite donnée |
|---|---|---|
| 1 | Phase 9 validée | `docs/phases/phase-9.md` : statut mis à jour |
| 2 | Sessions terminées conservées 30 jours au MVP, politique configurable après avis juridique | `SESSION_RETENTION_DAYS` (30 par défaut, 30 minimum imposé par la politique RLS de la migration 0018, 3 650 maximum) ; ADR 0011 section 6, `.env.example`, ARCHITECTURE G.2 ; tests de configuration et de purge à 45 jours |
| 3 | Test réel de Sentry avant la production, projet de staging seulement, DSN en variable d'environnement | **Impossible dans cette phase, reporté à la Phase 11** : voir ci-dessous |

Sentry, constaté le 2026-09-28 :
- Le MCP Sentry (lecture seule) voit l'organisation `adam-oc`, région UE (`de.sentry.io`), qui ne contient **aucun projet**. Aucun projet n'a été créé : c'est une décision du porteur du projet.
- Depuis l'environnement de développement, `sentry.io` et `*.ingest.de.sentry.io` sont refusés par le proxy (HTTP 403). Les protections réseau n'ont pas été contournées.
- Préparé : la commande `pnpm --filter @dental/server sentry:check`. Elle refuse tout environnement autre que `APP_ENV=staging` et tout DSN non HTTPS. Elle envoie une erreur contrôlée dont le SQL, les paramètres, la cause PostgreSQL, les en-têtes (cookie, authorization) et le corps contiennent le marqueur `SENTINELLE-FICTIVE-PATIENT`. Elle affiche la réponse de Sentry, l'identifiant de l'événement, le corps exact envoyé et l'absence du marqueur.
- Vérifiée contre un serveur d'ingestion local (`error-reporting.int.test.ts`) : format, authentification, contenu par liste blanche, marqueur absent.
- Procédure du test réel : section 10, étape 6.

## 1. Ce qui fonctionne

Chaque ligne est vérifiée par un parcours de bout en bout sur la pile de production (Chromium, poste réglé sur New York, cabinet à Paris), en plus des tests unitaires et d'intégration des phases précédentes.

| Domaine | Vérifié | Parcours |
|---|---|---|
| Mise en route d'un cabinet neuf | Commandes d'administration, première connexion, double authentification, profil, utilisateurs, praticiens, types, horaires, absence, import | `01-demo` |
| Authentification | Message neutre, verrouillage après 10 échecs, code TOTP faux puis bon, déconnexion, session révoquée ou inactive, changement d'utilisateur sur le même poste sans reste de la session précédente, compte de deux cabinets, réinitialisation de la double authentification et du mot de passe | `02-auth` |
| Rôles et permissions | Menus et pages par rôle ; appels directs refusés par le serveur (403) même en contournant l'interface ; notes médicales réservées au dentiste | `03-roles-isolation` |
| Isolation entre cabinets | Fiche d'un autre cabinet introuvable ; écritures (fiche, archivage, rendez-vous, paiement, annulation d'acte) refusées en 404, données inchangées | `03-roles-isolation`, `05-finance` |
| Agenda | Deux postes sur le même créneau (un seul rendez-vous), double clic, réseau coupé puis nouvel essai, réponse perdue, déplacement vers un créneau proposé, modification concurrente détectée, statuts, annulation qui libère le créneau, absence posée sur des rendez-vous (signalés, jamais modifiés) | `04-agenda` |
| Fuseaux et changement d'heure | Semaine du passage à l'heure d'hiver (écart Paris–New York de 5 h au lieu de 6 h) : heures affichées et instants en base exacts ; créneaux proposés ; heure inexistante du passage à l'heure d'été refusée avec un message explicite | `04-agenda` |
| Encaissements | Acte depuis l'agenda, paiements partiels, dépassement bloqué, double clic et réponse perdue sans doublon (clé d'idempotence), deux encaissements simultanés du restant dû (un seul accepté), annulations motivées réservées au dentiste, montants au centime (1 234,56 €) | `05-finance` |
| Revenus, « À encaisser », statistiques, journal | Chaque chiffre affiché comparé à une requête SQL indépendante ; filtre par praticien ; journal filtré par utilisateur ; historique d'un élément ; motif saisi jamais recopié | `05-finance`, `07-stats-audit` |
| Patients et import | Homonyme signalé avant création, double clic, réponse perdue, import XLSX (dates et téléphones d'Excel, ligne invalide), annulation d'import qui conserve la fiche déjà utilisée, import refusé à la secrétaire, recherche sans accents | `06-patients-import` |
| Responsive | Toutes les pages principales de chaque rôle en téléphone (390 px), tablette (820 px) et ordinateur (1 280 px) : aucun défilement horizontal | `08-responsive-a11y` |
| Accessibilité de base | axe-core WCAG 2.1 A/AA, avec des données, pages et panneaux ouverts : aucune violation grave ou critique, aucune mineure relevée ; parcours au clavier seul (connexion, lien d'évitement, prise de rendez-vous) | `08-responsive-a11y` |
| Données sensibles | Journaux réels de l'API et du worker, journal d'audit, file de tâches : aucune donnée saisie par les tests (102 211 lignes contrôlées à la dernière exécution) | contrôle final (`global-teardown.ts`) |
| Performance et charge | Un an d'activité : pages entre 0,17 et 1,2 s ; 20 postes simultanés, 180 requêtes/s, p95 ≤ 200 ms, aucune erreur | `09-performance` |
| Sauvegarde et restauration | `pg_dump` puis restauration dans une base neuve : lignes, RLS forcée, politiques, droits, propriétaires, migrations identiques ; isolation vérifiée avec le rôle applicatif | `10-backup-restore` |
| Build et migrations | Parcours exécutés sur le code compilé ; 19 migrations appliquées par la commande de production ; aucune dérive schéma/migrations | pile e2e, CI |

## 2. Ce qui ne fonctionne pas, ou pas complètement

| Constat | Effet | Décision proposée |
|---|---|---|
| Prise de rendez-vous : si la réponse se perd après l'enregistrement, le nouvel essai affiche « Le praticien a déjà un rendez-vous sur ce créneau » | Aucun doublon (vérifié), mais un message trompeur : la personne peut croire à un échec | Clé d'idempotence sur la création de rendez-vous, comme pour les paiements (migration et contrat). Non fait : changement de schéma hors du périmètre « tests » de la phase |
| Connexions simultanées au même compte : la seconde reçoit 429 | Voulu (ADR 0011 : tentatives sérialisées par adresse contre le contournement du verrouillage). Visible seulement si un même compte se connecte sur deux postes à la même seconde | Aucun changement ; comptes nominatifs par personne |
| Page « Revenus » sur un an : 1,2 s sur ordinateur (500 lignes de journal rendues) | Acceptable sur ordinateur ; non mesuré sur une tablette d'entrée de gamme | Pagination ou repli du journal au-delà d'un mois, si la recette sur tablette le justifie |
| Navigateurs autres que Chromium | Safari (iPad) et Firefox non testés : WebKit n'est pas installable dans l'environnement (CDN Playwright bloqué) | Recette manuelle sur iPad Safari en Phase 11 ; job WebKit en CI à ajouter et vérifier |
| Remontée Sentry | Non vérifiée contre le vrai service | Phase 11, étape 6 |
| En-têtes de sécurité de l'interface | Servis par l'API seulement ; `vite preview` ne les pose pas sur les fichiers statiques | Proxy de production (Phase 11, étape 4) |

## 3. Bugs découverts et corrigés

| # | Bug | Gravité | Trouvé par | Correction | Test de non-régression |
|---|---|---|---|---|---|
| 1 | Un compte rattaché à plusieurs cabinets ne pouvait pas se connecter : aucun choix du cabinet | Élevée pour les cabinets multi-sites | Parcours `02-auth` | Après un mot de passe correct, le serveur renvoie la liste des cabinets actifs (409), l'interface propose le choix ; un mauvais mot de passe ne révèle rien | `auth.int.test.ts` (cabinet suspendu exclu), `auth-api.int.test.ts` (réponse HTTP), `app.test.tsx`, parcours |
| 2 | Heures de l'historique d'import et des notes médicales affichées dans le fuseau du poste (27/09 20:13 à New York au lieu de 28/09 02:13 à Paris) | Moyenne (date médicale erronée) | Parcours `01-demo` et `03` | `formatDateTime` exige le fuseau du cabinet | `timezone-guard.test.ts` (refuse tout formatage de date sans fuseau dans le code), parcours |
| 3 | Plages horaires numérotées sur la semaine au lieu du jour dans les libellés accessibles (« mardi, plage 3 ») | Faible (lecteur d'écran) | Parcours `01-demo` | Numéro dans la journée | `availability.test.tsx` |
| 4 | Double envoi en quelques millisecondes : deux fiches patient créées | Faible à moyenne : un humain ne l'atteint pas (sonde : aucun doublon dès 20 ms d'écart, même processeur ralenti ×6) ; un bouton de souris usé qui « rebondit », si | Parcours `06`, sonde de temps | Les requêtes identiques en cours ne partent qu'une fois (`lib/api.ts`), point unique pour tous les formulaires | `api.test.ts`, parcours `04` et `06` (une seule requête envoyée) |
| 5 | Statistiques : liste de définitions mal formée (axe `definition-list`, grave) | Faible (lecteur d'écran) | axe, parcours `08` | Jauge dans un `dd` | `stats.test.tsx` (structure des listes) |
| 6 | Statistiques : colonnes des graphiques nommées sans rôle, nom non annoncé (axe `aria-prohibited-attr`, grave ; visible seulement avec des données) | Faible (lecteur d'écran) | axe, parcours `08` | `role="img"` | `stats.test.tsx` |
| 7 | Outil de test : code TOTP généré sur le pas précédent, refusé si une frontière de 30 s passe entre génération et vérification | Test seulement | Échec du job E2E en CI (lu par le MCP GitHub) | Jamais le pas précédent | Suite complète locale et CI |

## 4. Tests exécutés

| Commande | Résultat |
|---|---|
| `pnpm format:check && pnpm lint && pnpm typecheck` | Sans erreur (paquet e2e compris) |
| `pnpm test` | shared 80, serveur 394 (unitaires et intégration, PostgreSQL 16 réel), web 131 : tous verts |
| `pnpm build && pnpm check:bundle` | Chargement initial 146,6 ko compressés (budget 160 ko) |
| `pnpm --filter @dental/server db:generate` | Aucune dérive entre le schéma et les migrations |
| `pnpm audit` (production et développement) | Aucune vulnérabilité connue |
| gitleaks (index à chaque commit, historique complet) | Aucun secret |
| `pnpm e2e` (suite complète, locale) | **52 sur 52** en 4 min 39 s, aucune relance |
| CI GitHub, job « Parcours de bout en bout » | Vert sur le commit 0487231 (47 parcours à ce stade, 3 min 39 s) ; résultat du commit final dans le résumé |

### Campagne de failles volontaires

Chaque correctif a été retiré ou altéré, un par un, pour vérifier qu'un test échoue.

- Script hors dépôt, 14 failles au niveau unitaire et intégration :
  - premier passage : **12 sur 14** ;
  - non détectées : C3 (cabinet suspendu proposé au choix) et C4 (liste des cabinets absente de la réponse HTTP) ;
  - tests ajoutés pour ces deux cas ;
  - second passage : **14 sur 14**.
- 4 failles au niveau bout en bout, vérifiées à la main, toutes détectées :
  - regroupement des envois retiré (deux parcours échouent) ;
  - contrôle final de la base : une valeur saisie injectée dans le journal d'audit ;
  - restauration sans les droits (`--no-acl`).

| Faille | Détectée par |
|---|---|
| C1 liste des cabinets non transmise | service d'authentification |
| C2 ordre non alphabétique | service d'authentification |
| C3 cabinet suspendu proposé | service (test ajouté) |
| C4 réponse HTTP sans la liste | API (test ajouté) |
| C5 cabinet choisi non envoyé par l'interface | parcours de connexion (web) |
| H1 plages numérotées sur la semaine | disponibilités (web) |
| F1 heure dans le fuseau du poste | test de garde des fuseaux |
| R1 plancher de 30 jours retiré | configuration |
| R2 durée configurée ignorée par la tâche | conservation (45 jours) |
| R3 durée par défaut à 7 jours | configuration |
| D1 envois identiques non regroupés | client API, parcours |
| D2 requête terminée jamais retirée | client API |
| A1 liste de définitions mal formée | statistiques (web) |
| A2 colonnes sans rôle | statistiques (web) |

## 5. Scénarios de bout en bout automatisés

52 parcours, 11 fichiers, exécutés en CI à chaque envoi (`.github/workflows/ci.yml`, job `e2e`).

| Fichier | Parcours |
|---|---|
| `00-stack` | Pile de production : santé, en-têtes de sécurité, 401, redirection vers la connexion |
| `01-demo` | Démonstration en 16 étapes : cabinet neuf → usage quotidien (détail : `docs/demo.md`) |
| `02-auth` (7) | Verrouillage ; double authentification ; déconnexion ; session révoquée ou inactive ; changement d'utilisateur ; compte de deux cabinets ; réinitialisations par l'administrateur |
| `03-roles-isolation` (6) | Menus et pages par rôle (×3) ; appels directs refusés ; notes médicales ; second cabinet |
| `04-agenda` (8) | Concurrence ; double clic ; réseau coupé ; réponse perdue ; déplacement et modification concurrente ; statuts ; absence sur rendez-vous ; changement d'heure |
| `05-finance` (7) | Agenda → encaissement, double clic, réponse perdue ; refus à la secrétaire ; encaissements simultanés ; annulations du dentiste ; revenus et « À encaisser » = base ; téléphone ; autre cabinet |
| `06-patients-import` (6) | Homonyme ; double clic ; réponse perdue ; import XLSX ; annulation d'import ; import refusé et recherche sans accents |
| `07-stats-audit` (3) | Tableau de bord = SQL ; filtre praticien = SQL ; journal et historique = base |
| `08-responsive-a11y` (9) | Pages par rôle en trois formats (×3) ; axe par rôle (×3) ; panneaux ouverts ; clavier seul ; page de connexion |
| `09-performance` (3) | Volume ; temps d'affichage ; charge |
| `10-backup-restore` | Sauvegarde et restauration |

## 6. Performances mesurées

Machine : 4 cœurs Xeon 2,1 GHz, 15 Go ; API, worker, PostgreSQL 16 et navigateur sur le même hôte ; build de production. Volume du cabinet mesuré :
- 5 000 patients ;
- 5 962 rendez-vous sur un an et deux mois à venir ;
- 3 938 actes et 3 938 paiements ;
- 101 365 entrées de journal ;
- écrits en base en 3,7 s.

### Pages (navigation complète, jusqu'à l'affichage des données)

| Page | Affichage | Appel API le plus lent |
|---|---|---|
| Accueil | 194 ms | tableau de bord du jour, 59 ms |
| Agenda semaine (dentiste) | 231 ms | 18 ms |
| Agenda jour | 173 ms | 16 ms |
| Liste des patients | 179 ms | 14 ms |
| Fiche du patient le plus suivi | 168 ms | 25 ms |
| À encaisser | 252 ms | 27 ms |
| Revenus sur un an | 1 221 ms | revenus, 77 ms (le reste : rendu de 500 lignes de journal) |
| Statistiques sur un an | 535 ms | tableau de bord, 194 ms |
| Journal sur un mois | 191 ms | 17 ms |
| Recherche rapide (frappe → résultat) | 393 ms | délai de saisie de l'interface compris |

### Charge : 20 postes simultanés pendant 32 s

Chaque poste enchaîne en boucle :
- agenda de la semaine ;
- recherche de patient ;
- fiche ;
- créneaux libres ;
- prise de rendez-vous (annulée si acceptée) ;
- tableau de bord du mois.

| Appel | Nombre | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| Agenda (semaine) | 912 | 89 ms | 132 ms | 168 ms | 210 ms |
| Recherche de patient | 912 | 103 ms | 140 ms | 167 ms | 224 ms |
| Fiche patient | 912 | 82 ms | 113 ms | 131 ms | 150 ms |
| Créneaux libres | 912 | 92 ms | 125 ms | 140 ms | 175 ms |
| Prise de rendez-vous | 912 | 110 ms | 152 ms | 181 ms | 220 ms |
| Annulation | 263 | 102 ms | 141 ms | 167 ms | 192 ms |
| Tableau de bord (mois) | 912 | 149 ms | 197 ms | 242 ms | 274 ms |

Résultats de la charge :
- 5 735 requêtes, **180 requêtes par seconde** ;
- **aucune erreur serveur** ;
- 263 rendez-vous pris ; 649 refus de créneau déjà pris, attendus puisque 70 % des créneaux sont occupés.

Après la charge, aucun chevauchement de rendez-vous pour un praticien (contrôle SQL). Les 20 connexions sont faites l'une après l'autre : des connexions simultanées au même compte sont refusées par conception (section 2).

### Sauvegarde et restauration

| Mesure | Valeur |
|---|---|
| Base sauvegardée | 126 945 lignes (toutes les données des parcours, un an d'activité compris) |
| `pg_dump` (format personnalisé) | 0,6 s, 4,9 Mo |
| `pg_restore` dans une base neuve | 1,4 s |

Limites de ces chiffres :
- une seule machine, sans latence réseau entre l'API et la base ;
- un seul processus d'API ;
- ils ne prédisent pas le comportement sur l'hébergement réel, à remesurer en Phase 11.
- Seuils des tests, volontairement larges pour une machine de CI partagée : page < 4 s, appel < 2 s, p95 < 2 s.

## 7. Risques ouverts

| Risque | Impact | Probabilité | Parade ou prochaine étape |
|---|---|---|---|
| Hébergement non choisi : certification HDS (France), restauration à un instant donné, sauvegardes hors site | Bloquant légal et perte de données | Certaine tant que non traité | Phase 11 |
| Durées de conservation non validées juridiquement (journal, patients inactifs, paiements, sessions) ; pas de procédure d'effacement | Non-conformité RGPD | Élevée | Avis juridique avant production |
| Safari/iPad non testé | Défaut d'affichage ou de saisie sur l'appareil le plus courant en cabinet | Moyenne | Recette sur iPad réel ; job WebKit |
| Message trompeur après réponse perdue sur un rendez-vous | Rendez-vous repris en double par erreur humaine | Faible | Clé d'idempotence (section 2) |
| Limiteur de débit en mémoire | Limites contournables avec plusieurs instances d'API | Faible tant qu'il y a une instance | Une seule instance, ou limiteur partagé |
| Aucun test d'intrusion externe | Failles non couvertes par la revue interne | Inconnue | Test d'intrusion sur le staging |
| Clé de chiffrement des notes médicales (`DATA_ENCRYPTION_KEY`) : perte = notes illisibles | Perte de données médicales | Faible, grave | Sauvegarde de la clé hors de la base, procédure testée |
| Accessibilité : contrôles automatiques seulement | Obstacles non détectés par axe (ordre de lecture, annonces) | Moyenne | Test avec un lecteur d'écran (NVDA, VoiceOver) |
| Charge mesurée sur une machine locale | Écart avec l'hébergement réel | Moyenne | Remesurer sur le staging |

## 8. Fonctionnalités volontairement hors MVP

- Messagerie WhatsApp, agent IA de prise de rendez-vous, copie vers Google Calendar (ADR 0004, `docs/future/`).
- Rappels aux patients (SMS, e-mail) et portail patient.
- Reçu patient et export CSV des statistiques et revenus (backlog, `docs/future/README.md`).
- Facturation de l'abonnement SaaS (Stripe, plus tard ; jamais pour les paiements des patients).
- Hors produit actuel :
  - feuilles de soins électroniques, tiers payant, lecture de carte Vitale ;
  - schéma dentaire et dossier clinique structuré (seules des notes médicales libres existent) ;
  - objectifs chiffrés.
- Effacement d'un patient : il dépend d'un avis juridique (obligation de conservation du dossier médical).

## 9. Bloquants pour une vraie production

1. **Hébergement de données de santé** : hébergeur certifié HDS si les cabinets sont en France (question ouverte L1 : pays des premiers clients).
2. **Cadre juridique** :
   - durées de conservation validées ;
   - procédure d'effacement ;
   - contrat de sous-traitance avec les cabinets ;
   - analyse d'impact (AIPD) probable pour des données de santé.
3. **Sauvegardes** :
   - restauration à un instant donné ;
   - copies hors site ;
   - exercice de restauration réussi sur l'hébergement réel, pas seulement localement.
4. **Proxy de production** :
   - TLS ;
   - en-têtes de sécurité de l'interface, vérifiés automatiquement ;
   - `API_TRUST_PROXY_HOPS` réglé selon le réseau réel.
5. **Secrets** :
   - dans le gestionnaire de l'hébergeur ;
   - clé de chiffrement sauvegardée hors de la base ;
   - mots de passe des rôles PostgreSQL propres à chaque environnement.
6. **Remontée des erreurs** vérifiée pour de vrai (Sentry de staging) et **supervision** : disponibilité, erreurs, verrouillages de comptes, échecs de tâches, espace disque.
7. **Recette sur appareils réels**, iPad Safari compris.
8. **Test d'intrusion externe** sur le staging.

## 10. Checklist de déploiement de la Phase 11

À dérouler dans l'ordre. Chaque étape a son critère de réussite. Une étape échouée arrête la suite.

| # | Étape | Comment vérifier |
|---|---|---|
| 1 | Décider du pays des premiers cabinets et de l'hébergeur (HDS si France), avec restauration à un instant donné | Certificat HDS de l'offre ; PITR documenté dans l'offre |
| 2 | Créer deux environnements distincts, staging puis production, chacun avec sa base PostgreSQL 16, ses rôles et ses secrets | `pnpm db:bootstrap` puis `node dist/migrate.js` : 19 migrations appliquées ; `APP_ENV` correct ; aucun secret partagé entre environnements |
| 3 | Mettre les secrets dans le gestionnaire de l'hébergeur (`DATA_ENCRYPTION_KEY`, mots de passe des rôles, `SENTRY_DSN`) ; sauvegarder la clé de chiffrement hors de la base | L'API démarre sans `.env` ; gitleaks vert ; clé relue depuis sa sauvegarde et comparée (empreinte) |
| 4 | Proxy (Caddy ou équivalent) : TLS, `/api` vers l'API, fichiers de l'interface avec CSP, HSTS, `frame-ancestors`, `Referrer-Policy`, `Permissions-Policy` ; `API_TRUST_PROXY_HOPS` | Rapport d'un analyseur d'en-têtes ; test automatique des en-têtes de l'interface ; adresse IP réelle du client dans les journaux |
| 5 | Déployer sur le staging : API (une instance), worker, migrations par la commande de production | `/health/ready` vert ; worker « démarré » ; tâche nocturne de conservation planifiée (pg-boss) |
| 6 | Test réel de Sentry : créer un projet `dental-staging` (région UE) ; mettre son DSN dans `SENTRY_DSN` du staging ; lancer `APP_ENV=staging pnpm --filter @dental/server sentry:check` depuis le staging | Code de sortie 0, identifiant d'événement affiché ; événement visible dans Sentry (MCP `search_events` ou interface) ; contenu inspecté champ par champ : ni marqueur `SENTINELLE-FICTIVE-PATIENT`, ni SQL avec valeurs, ni cookie, ni en-tête `authorization`, ni corps de requête |
| 7 | Lancer la suite de bout en bout contre le staging (adaptation de l'adresse de base), puis la recette manuelle sur iPad Safari, tablette Android et téléphone | 52 parcours verts ; liste des défauts de la recette traitée |
| 8 | Remesurer la charge sur le staging (même mélange, 20 postes) | p95 < 500 ms, aucune erreur serveur ; sinon analyse avant d'aller plus loin |
| 9 | Sauvegardes : activer PITR et copies hors site ; restaurer le staging à un instant donné dans une base neuve | Même comparaison que `10-backup-restore` : lignes, RLS forcée, politiques, droits, migrations ; durée de restauration notée |
| 10 | Supervision : disponibilité (`/health/ready`), erreurs (Sentry), verrouillages (`auth.account_locked`), échecs de tâches, disque et connexions PostgreSQL ; alertes vers une personne joignable | Alerte de test reçue pour chaque signal |
| 11 | Test d'intrusion externe sur le staging ; correction des constats graves | Rapport du prestataire ; constats graves corrigés et revérifiés |
| 12 | Validation juridique des durées de conservation et de la procédure d'effacement ; ajuster `SESSION_RETENTION_DAYS` si besoin | Avis écrit ; configuration de production conforme |
| 13 | Production : premier cabinet par `create-clinic` et `create-admin` ; première connexion de l'administrateur avec double authentification | Parcours de démonstration (`docs/demo.md`) déroulé à la main avec des données fictives, puis données fictives supprimées |
| 14 | Procédures écrites : incident, restauration, perte du téléphone du seul administrateur (`reset-mfa`), rotation d'un secret | Chaque procédure exécutée une fois sur le staging |

## MCP et outils utilisés

| Service | Usage | Valeur |
|---|---|---|
| GitHub | État des exécutions de CI et journaux des jobs | A montré l'échec du parcours de réinitialisation en CI (code TOTP sur le pas précédent), corrigé |
| Sentry | Lecture seule : organisation `adam-oc` (UE), aucun projet | Confirme que le test réel doit attendre la création d'un projet de staging |
| Railway | Non utilisé | Aucun déploiement avant la Phase 11 (consigne) |
| Resend, Stripe, Supabase | Non utilisés | Aucune fonction d'e-mail ; Stripe réservé à la facturation future ; aucune raison de changer l'architecture |

## Écarts par rapport au plan

- Les parcours tournent sur Chromium seulement (voir section 2).
- La charge est mesurée par un parcours Playwright (contextes de requête), sans outil dédié (k6, Artillery). Choix : aucune dépendance de plus, et le même contexte de pile que les autres parcours.
- Le scénario de démonstration crée praticiens, types et horaires par l'interface ; les autres parcours les créent par l'API pour aller plus vite.
