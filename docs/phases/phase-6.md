# Phase 6 — Parcours web du dentiste et de la secrétaire : rapport

Date : 2026-09-27. Statut : **code et tests locaux terminés** ; résultat de la CI GitHub consigné dans le résumé de fin de phase. En attente de validation avant la Phase 7.

**Décision du porteur du projet (validation de la Phase 5) :**
- un rendez-vous dans le passé reste possible ;
- il exige une confirmation explicite, avec la raison « rendez-vous dans le passé » affichée clairement ;
- la dérogation est tracée dans l'audit ;
- jamais de confirmation automatique.

L'analyse des parcours et la proposition d'écrans sont l'ADR 0008.

## Livré

| Élément | Emplacement |
|---|---|
| Analyse : qui utilise quoi et sur quel appareil, dix parcours mesurés (frictions, cible), écrans proposés, règles de sécurité de l'interface, poids | `docs/adr/0008-parcours-web-par-role.md` |
| **Rendez-vous dans le passé** : raison `IN_PAST` à la création et au déplacement, cumulée avec les autres ; audit `appointment.availability_override` ; absence toujours refusée ; raisons renvoyées dans la réponse d'erreur (`error.reasons`) et affichées en clair avant « Confirmer quand même » | `modules/appointments/rules.ts`, `appointments.service.ts`, `api/error-handler.ts`, `AppointmentForm.tsx` |
| **Accueil « Aujourd'hui »** : « Ma journée » pour un compte lié à un praticien (bascule « Tout le cabinet »), sinon journée du cabinet groupée par praticien ; prochain rendez-vous signalé ; « Honoré » et « Absent » en un geste une fois l'heure passée ; « Mise en route » pour l'administrateur tant qu'il manque un praticien, des horaires, un type de rendez-vous ou les coordonnées | `pages/today/` |
| **En-tête** : menu selon les permissions ; bouton « Menu » sur téléphone ; recherche rapide de patient ; lien « Aller au contenu » ; titre d'onglet par page ; focus sur le contenu après navigation | `app/AppLayout.tsx`, `app/PatientQuickSearch.tsx`, `app/router.tsx` |
| **Sessions** : cache vidé à tout changement d'identité (compte, cabinet, déconnexion, expiration) ; réponse 401 en cours d'usage : retour à la connexion ; pas de nouvel essai sur une erreur 4xx | `lib/query-client.ts` |
| **Agenda** : vue par défaut selon le compte (sa semaine pour un praticien lié) ; sur téléphone, un praticien à la fois en vue jour et une liste par jour en vue semaine ; panneau plein écran sur tablette et téléphone, fermé par Échap, focus rendu à l'élément d'origine ; **patient créé dans le formulaire du rendez-vous**, doublons proposés d'abord | `pages/agenda/` |
| **Fiche patient** : résumé en tête (téléphone cliquable, âge, prochain rendez-vous), « Prendre rendez-vous » en haut ; notes médicales remontées pour qui peut les lire | `pages/patients/PatientSummary.tsx`, `PatientPage.tsx` |
| **Poids** : pages chargées à la demande ; bibliothèque des numéros hors du socle ; budget du chargement initial vérifié en CI | `app/router.tsx`, `lib/format-date.ts`, `lib/queries.ts`, `apps/web/scripts/check-bundle.mjs` |

## Vérifications exécutées

Environnement : Node 22.22, PostgreSQL 16 local, Chromium 1194.

| Vérification | Résultat |
|---|---|
| Formatage, lint, typage | OK |
| Tests `packages/shared` | 66/66 |
| Tests `apps/server` : unitaires | 81/81 |
| Tests `apps/server` : intégration (base jetable, rôle applicatif réel) | 198/198 |
| Tests `apps/web` | 85/85 |
| Tests par mutation (voir ci-dessous) | 15 failles introduites, 15 détectées |
| Parcours réels dans Chromium, version de production, ordinateur, tablette et téléphone, deux cabinets | OK après 4 corrections |
| Build, dérive schéma/migrations, `pnpm audit --prod` | OK ; aucune dérive ; aucune vulnérabilité connue |
| Budget du chargement initial (`pnpm check:bundle`) | 142 ko compressés pour un budget de 160 ko |

### Poids de l'application

| | Phase 5 | Phase 6 |
|---|---|---|
| JavaScript de la page de connexion | 660 ko (191 ko compressés), un seul fichier | 461 ko (142 ko compressés) |
| Bibliothèque des numéros (120 ko) | chargée partout | seulement avec les pages qui affichent un numéro |
| Pages | toutes chargées d'emblée | chargées à la demande (de 1 à 29 ko chacune) |

Le socle restant est composé de react-dom (202 ko), react-router (91 ko), zod (85 ko) et du cache de requêtes. Le réduire davantage demanderait de changer de bibliothèque, ce qui ne se justifie pas au MVP.

### Tests par mutation

Chaque faille a été introduite seule, les tests concernés rejoués, puis le fichier restauré (script hors dépôt).

| # | Faille introduite | Détectée par |
|---|---|---|
| M1 | Serveur : raison « dans le passé » supprimée | Règle pure, service, API |
| M2 | Serveur : raisons absentes de la réponse d'erreur | API |
| M3 | Interface : rendez-vous passé confirmé d'office | Agenda |
| M4 | Interface : cache non vidé au changement de session | Cache |
| M5 | Interface : réponse 401 sans retour à la connexion | Cache |
| M6 | Interface : menu « Cabinet » pour tous | Navigation |
| M7 | Interface : « Ma journée » avec les rendez-vous des confrères | Accueil |
| M8 | Interface : « Honoré » proposé avant l'heure | Accueil |
| M9 | Interface : patient créé sans recherche de doublons | Agenda |
| M10 | Interface : toutes les colonnes sur téléphone | Agenda (téléphone) |
| M11 | Interface : focus non rendu à la fermeture du panneau | Agenda |
| M12 | Interface : adresse reconstruite depuis le dernier rendu | Agenda |
| M13 | Interface : création de patient sans droit `patient.write` | Agenda |
| M14 | Interface : notes médicales après l'administratif | Fiche patient |
| M15 | Poids : bibliothèque des numéros importée dans le socle | Budget (`check:bundle`) |

### Parcours réels dans Chromium

Conditions :
- version de production (`vite build` puis `vite preview`), navigateur réglé sur New York, cabinets à Paris ;
- dimanche 27 septembre, 15 h à Paris ;
- deux cabinets de démonstration, A et B.

1. **Connexion :** 4 fichiers JS (461 ko non compressés), sans la bibliothèque des numéros.
2. **Administrateur (ordinateur) :**
   - « Mise en route » demande les coordonnées du cabinet ;
   - menu complet ; onglet « Aujourd'hui · Cabinet de démonstration ».
3. **Secrétaire (tablette 820 × 1180) :**
   - journée du cabinet groupée par praticien, prochain rendez-vous signalé ; « Honoré » en un geste ;
   - **appel d'une patiente connue** : recherche « durand » dans l'en-tête → fiche (téléphone, âge, prochain rendez-vous) → « Prendre rendez-vous » → panneau plein écran → créneau 09:30 proposé → enregistré ;
   - **appel d'un nouveau patient** : « Lefèvre » introuvable → « Nouveau patient » → fiche créée → rendez-vous enregistré, sans quitter l'agenda ;
   - **rendez-vous dans le passé** (vendredi 25) : « Rendez-vous dans le passé » et « Hors des horaires du praticien » affichés ; enregistré après « Confirmer quand même ».
4. **Dentiste (téléphone 390 × 844) :**
   - « Ma journée » : ses seuls rendez-vous ;
   - bouton « Menu », refermé après navigation ;
   - agenda : sa semaine par défaut, en liste par jour ; vue jour sur une seule colonne, la sienne ;
   - panneau du rendez-vous plein écran ; Échap le ferme et rend le focus au rendez-vous ;
   - fiche patient : notes médicales en premier ;
   - aucune page ne déborde horizontalement (accueil, agenda, patients, fiche, disponibilités ; réglages de l'administrateur).
5. **Deux cabinets dans le même onglet :**
   - secrétaire du cabinet A sur la liste des patients, puis session supprimée → retour à la connexion ;
   - connexion au cabinet B sans recharger la page, réponses retardées de 1,5 s : **aucun patient du cabinet A affiché**, ni pendant ni après ;
   - la recherche « durand » ne trouve rien dans le cabinet B.

## Défauts trouvés et corrigés pendant la phase

1. **Données d'une session affichables dans une autre** (défaut présent depuis la Phase 2).
   - Le cache n'était vidé qu'au clic sur « Se déconnecter ».
   - Après une expiration de session suivie d'une connexion à un autre cabinet dans le même onglet, les données du précédent pouvaient s'afficher le temps du rechargement.
   - Une réponse 401 en cours d'usage laissait l'utilisateur sur une page en erreur.
   - Corrigé et couvert par deux tests (M4, M5) et par le parcours Chromium.
2. **Focus perdu à la fermeture du panneau d'un rendez-vous.**
   - Cause : les deux effets s'exécutaient dans le mauvais ordre et mémorisaient le titre du panneau au lieu de l'élément d'ouverture.
   - Trouvé dans Chromium ; test ajouté, vérifié en échec sur l'ancien code.
3. **Deux changements rapprochés de l'adresse de l'agenda** (vue puis date) : le second effaçait le premier.
   - La forme fonctionnelle de `setSearchParams` ne suffit pas : elle reçoit l'adresse du dernier rendu.
   - Trouvé dans Chromium ; test ajouté, vérifié en échec sur les deux versions précédentes.
4. **Page « Praticiens » plus large que le téléphone** (43 px).
   - Cause : une liste déroulante aux options longues (nom et e-mail).
   - Corrigé dans les composants de champ, ce qui protège tous les formulaires.
5. **Texte trompeur dans le formulaire de création** : « 27/09/2026 à 09:00, modifiable ci-dessous » restait affiché après un changement de date. Supprimé.
6. **En-tête sur tablette** : « Se déconnecter » passait à la ligne. L'en-tête est désormais une grille, avec un seul exemplaire de chaque élément.

## Écarts par rapport au plan

1. **Pas de tableau de bord chiffré** : c'est la Phase 8. L'accueil montre la journée et des compteurs simples.
2. **Disponibilités :** pas de refonte. La page était déjà lisible sur téléphone (aucun débordement mesuré).

## Limites connues

- **Heure répétée au passage à l'heure d'hiver :** toujours non dédoublée sur la grille (ADR 0007).
- **Le dimanche**, la vue « semaine » s'ouvre sur la semaine qui se termine (semaine ISO, du lundi au dimanche).
- **Champs date et heure :** leur format suit la langue du navigateur (09/28/2026 dans un Chromium en anglais), pas celle de la page.
- **« Mise en route » :** elle ne vérifie les horaires que sur les deux semaines à venir.
- **Parcours Chromium :** toujours exécutés depuis un script hors dépôt (automatisation en Phase 10).
