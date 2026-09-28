# ADR 0012 — Tests de bout en bout et validation globale

- Statut : accepté (2026-09-28), Phase 10
- **Demande du porteur du projet :** valider le produit entier, pas seulement ajouter des tests isolés ; automatiser dans la CI les parcours Chromium jusque-là manuels ; couvrir les trois rôles, les fuseaux horaires, la concurrence, les erreurs réseau, la performance, l'accessibilité de base, l'absence de données sensibles dans les journaux, la restauration ; ne jamais conclure « sécurisé à 100 % » ni « prêt pour la production » parce que les tests passent.

## 1. Décision

Un paquet `e2e` (Playwright, Chromium) exécute les parcours sur la **pile de production** :

| Élément | Ce qui tourne | Pourquoi |
|---|---|---|
| Base | Base dédiée recréée à chaque exécution, rôles préparés comme au premier déploiement | Aucun état hérité d'une exécution précédente |
| Migrations | `dist/migrate.js` (commande de production) | La commande livrée est celle qui est testée |
| API et worker | `dist/main-api.js`, `dist/main-worker.js`, rôle `dental_app` | Le code compilé, pas le code de développement |
| Interface | `apps/web/dist` servie par `vite preview`, qui relaie `/api` comme le fera le proxy de production | Même origine, mêmes cookies qu'en production |
| Cabinets | Créés par `dist/create-clinic.js` et `dist/create-admin.js` | Les commandes d'administration sont exercées |
| Poste | Navigateur réglé sur New York, cabinet à Paris | Toute heure affichée dans le fuseau du poste est détectée |

Règles :
- **Aucune relance automatique** d'un test en échec (`retries: 0`) : un test instable doit se voir et se corriger.
- **Contrôles indépendants** : les chiffres affichés (revenus, restant dû, statistiques, journal) sont comparés à une requête SQL écrite dans le test (superutilisateur, sans RLS), pas à l'API.
- **CSP de production appliquée** : l'interface est servie avec les en-têtes de `apps/web/security-headers.ts`. Toute violation de la CSP sur une page principale fait échouer les parcours (ajout du 2026-09-28).
- **Secrets de l'exécution** : la clé de chiffrement est tirée par le lanceur. Le contrôle final vérifie qu'elle n'apparaît dans aucun journal, pas plus que les mots de passe des rôles PostgreSQL, le cookie de session ou les en-têtes d'authentification (ajout du 2026-09-28).
- **Données sentinelles** : noms de patients, notes, téléphone, mot de passe et motifs saisis par les tests sont connus. À la fin de l'exécution, les journaux réels de l'API et du worker, le journal d'audit et la file de tâches (pg-boss) ne doivent en contenir aucun, sinon l'exécution échoue.
- **Volume** : un cabinet reçoit un an d'activité écrit directement en base (5 000 patients, environ 6 000 rendez-vous, actes, paiements, 100 000 entrées de journal) pour mesurer pages et charge.
- **Restauration** : la base de l'exécution est sauvegardée (`pg_dump`) puis restaurée dans une base neuve ; données, RLS, politiques, droits et migrations sont comparés.
- **Accessibilité** : axe-core (WCAG 2.1 A et AA) sur les pages de chaque rôle, avec des données, en téléphone et en ordinateur ; parcours au clavier seul. Échec sur toute violation « grave » ou « critique ».

La CI exécute la suite complète dans un job dédié (`e2e`), sur PostgreSQL 16, avec le Chromium de la version figée de Playwright. Rapport, traces et journaux (données fictives uniquement) sont conservés 7 jours comme artefact.

## 2. Répartition des tests

| Niveau | Rôle | Exemples |
|---|---|---|
| Unitaires (Vitest) | Règles pures, mise en forme, contrats | Calculs de créneaux, montants, fuseaux, catalogue d'audit |
| Intégration (Vitest + PostgreSQL réel, rôle applicatif) | Services, RLS, routes HTTP, concurrence en base | Matrice des 74 routes, fuite entre cabinets, tentatives simultanées |
| Interface (Vitest + jsdom) | Composants et pages, API simulée | Formulaires, états d'erreur, rôles |
| Bout en bout (Playwright) | Produit entier dans un vrai navigateur, sur la pile compilée | Démonstration « cabinet neuf → usage quotidien », double clic, réponse perdue, changement d'heure, charge, restauration |

Un comportement déjà prouvé à un niveau inférieur n'est pas refait en bout en bout, sauf s'il dépend du navigateur, du réseau, du rendu ou de l'enchaînement complet.

## 3. Conséquences

- Une nouvelle fonctionnalité visible par le personnel ajoute ou étend un parcours `e2e/tests/`.
- Toute donnée saisie par un nouveau parcours est déclarée dans `e2e/support/sentinels.ts`.
- La suite prend environ 5 minutes en local ; elle ne remplace ni la recette sur l'hébergement réel, ni un test d'intrusion, ni un audit d'accessibilité manuel.
- Limites connues : Chromium seulement (WebKit/Safari non installable dans l'environnement de développement, CDN bloqué) ; charge mesurée sur une seule machine, API et base sur le même hôte.
