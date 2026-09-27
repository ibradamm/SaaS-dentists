# ADR 0008 — Parcours web du dentiste et de la secrétaire

- Statut : accepté (2026-09-27), analyse préalable à la Phase 6 ; mis en œuvre (rapport : `docs/phases/phase-6.md`)
- Décision du porteur du projet (validation de la Phase 5) : un rendez-vous dans le passé reste possible, avec une confirmation explicite, une raison affichée clairement (« rendez-vous dans le passé ») et une trace dans l'audit ; jamais de confirmation automatique.
- Fondations : ADR 0003 (permissions), 0006 (disponibilités), 0007 (rendez-vous).

## 1. Qui utilise quoi, et sur quel appareil

| Personne | Appareil principal | Contexte | Besoin dominant |
|---|---|---|---|
| Secrétaire | Ordinateur à l'accueil ; parfois tablette | Téléphone qui sonne, patient au comptoir, interruptions | Trouver un patient et un créneau **vite**, sans perdre le fil |
| Dentiste | Tablette ou téléphone entre deux patients ; ordinateur au bureau | Mains occupées, peu de temps | Voir **sa** journée, le prochain patient, ses notes médicales |
| Administrateur (souvent le dentiste titulaire) | Ordinateur | Mise en route, réglages ponctuels | Savoir ce qui manque pour que le cabinet fonctionne |

## 2. Parcours clés : existant, frictions, cible

Mesures faites sur l'application de la Phase 5 (nombre d'écrans traversés).

| # | Parcours | Aujourd'hui | Friction | Cible |
|---|---|---|---|---|
| S1 | Ouvrir la journée | Accueil (texte) → Agenda | L'accueil n'apporte rien ; la grille ne montre pas « qui est le prochain » | **Accueil « Aujourd'hui »** : rendez-vous du jour par praticien, prochain rendez-vous mis en avant, actions directes |
| S2 | Appel d'un patient connu qui veut un rendez-vous | Agenda → Nouveau → recherche → créneau | Correct | Idem, plus la **recherche rapide** dans l'en-tête → fiche → « Prendre rendez-vous » |
| S3 | Appel d'un **nouveau** patient | Patients → Nouveau patient → fiche → Prendre rendez-vous → formulaire (5 écrans) | Aller-retour, fil perdu | **Création du patient dans le formulaire de rendez-vous** (nom, prénom, téléphone, date de naissance), contrôle des doublons, puis on continue |
| S4 | Déplacer ou annuler à la demande du patient | Patients → recherche → fiche → rendez-vous → agenda | Recherche en deux temps | Recherche rapide dans l'en-tête → fiche → rendez-vous |
| S5 | Le patient est là / ne vient pas | Agenda → rendez-vous → fiche → statut | 3 gestes | **Boutons « Honoré » / « Patient absent »** dans la liste du jour (actifs une fois l'heure passée) |
| S6 | Absence d'un praticien | Disponibilités → onglet → saisie ; conflits listés | Correct | Inchangé |
| D1 | Ma journée (tablette, téléphone) | Agenda, grille de tous les praticiens | Illisible sur téléphone, pas centré sur soi | **« Ma journée »** : liste de ses rendez-vous, prochain patient, accès direct à la fiche |
| D2 | Note médicale pendant le soin | Fiche patient, notes en bas de page | Défilement | Pour qui a le droit médical : **résumé et notes en haut** de la fiche |
| D3 | Son planning | Agenda, vue jour de tous | Choisir « Semaine » et son nom | Compte lié à un praticien : **sa semaine par défaut** ; sur téléphone, liste par jour |
| A1 | Mise en route du cabinet | Aucune aide | L'administrateur ne sait pas ce qui manque | **Liste « Mise en route »** sur l'accueil tant qu'il manque praticien, horaires ou type de rendez-vous |

## 3. Écrans et flux proposés

1. **En-tête et navigation**
   - Menu selon les permissions : Aujourd'hui, Agenda, Patients, Disponibilités, Cabinet, Utilisateurs.
   - Sur téléphone : bouton « Menu » (menu déroulant accessible, refermé après chaque navigation).
   - Recherche rapide de patient (nom, téléphone, date de naissance) pour qui a `patient.read`.
   - Lien d'évitement « Aller au contenu », titre de l'onglet propre à chaque page, focus déplacé sur le contenu après une navigation.
2. **Accueil « Aujourd'hui »**
   - Compte lié à un praticien actif : « Ma journée », avec bascule « Tout le cabinet » s'il y a plusieurs praticiens.
   - Sinon : « Aujourd'hui au cabinet », groupé par praticien.
   - Actions : ouvrir le rendez-vous, ouvrir la fiche, statuts rapides, « Nouveau rendez-vous ».
   - Administrateur : « Mise en route » si le cabinet est incomplet.
3. **Agenda**
   - Vue par défaut selon le compte (section 2, D3).
   - Téléphone : vue jour sur **un** praticien à la fois (sélecteur) ; vue semaine en **liste par jour**.
   - Panneau du rendez-vous : colonne à droite sur ordinateur, **plein écran** sur tablette et téléphone.
   - Formulaire : création du patient sur place (S3) ; confirmation avec **raisons structurées** (dans le passé, hors horaires, blocage).
4. **Fiche patient**
   - Résumé en tête : téléphone, prochain rendez-vous, « Prendre rendez-vous ».
   - Ordre selon les droits : notes médicales remontées pour qui peut les lire (D2).
5. **Disponibilités** : inchangées sur le fond ; tableau de la semaine lisible sur téléphone.

## 4. Règles de sécurité de l'interface

- **Le serveur reste seul juge.** L'interface masque une action non permise, mais chaque action reste contrôlée par `authorize()` et la RLS ; les tests d'API existants couvrent la matrice des rôles.
- **Aucune donnée d'une session affichée dans une autre.** Le cache des requêtes est vidé dès que l'identité change (déconnexion, expiration, connexion d'un autre compte ou d'un autre cabinet). Jusqu'ici, il n'était vidé qu'au clic sur « Se déconnecter » : après une expiration suivie d'une connexion à un autre cabinet, les données du précédent pouvaient s'afficher le temps du rechargement.
- **Session expirée en cours d'usage** (réponse 401) : retour à la connexion, cache vidé.
- Aucune nouvelle permission, aucune nouvelle route serveur à part la raison `IN_PAST`.

## 5. Rendez-vous dans le passé

- Nouvelle raison de dérogation **`IN_PAST`** : début antérieur à l'heure courante, à la création comme au déplacement.
- Elle s'ajoute aux raisons existantes et suit le même chemin : refus `AVAILABILITY_CONFIRMATION_REQUIRED`, puis acceptation avec `allowOutsideAvailability: true` et audit `appointment.availability_override`.
- La réponse d'erreur porte désormais la **liste des raisons** (`error.reasons`), pour que l'interface les affiche clairement sans analyser le message.
- Une absence reste un refus sans dérogation, même dans le passé.

## 6. Poids de l'application

- **Mesure (Phase 5)** : un seul fichier de 660 ko (191 ko compressés), chargé dès la page de connexion.
  - react-dom : 203 ko ;
  - libphonenumber-js : 117 ko, pour le seul affichage des numéros ;
  - react-router : 91 ko ;
  - zod : 85 ko ;
  - pages : environ 100 ko.
- **Mesures prises :**
  - chaque page chargée à la demande ;
  - libphonenumber-js ne part qu'avec les pages qui affichent un numéro ;
  - **budget du fichier d'entrée vérifié en CI.**
- **Résultat :** 142 ko compressés au chargement de la page de connexion (461 ko non compressés), pour un budget de 160 ko ; détail dans `docs/phases/phase-6.md`.
- **Écarté :**
  - reformater les numéros « à la main » pour se passer de libphonenumber-js : règles propres à chaque pays, risque d'erreur ;
  - supprimer la validation des réponses (zod) : elle protège l'interface d'une réponse inattendue.

## 7. Hors périmètre

- Mode hors ligne, notifications, glisser-déposer, thème sombre.
- Tableau de bord chiffré (Phase 8).
- Consultation du journal d'audit (Phase 9).
