# Phase 3 — Patients et import de fichiers : rapport

Date : 2026-09-26. Statut : **code et tests locaux terminés** ; résultat de la CI GitHub consigné dans le résumé de fin de phase. En attente de validation avant la Phase 4.

## Recentrage du périmètre (préalable)

Décision du porteur du projet : retrait de WhatsApp, de l'agent IA et de Google Calendar (ADR 0004). Appliqué avant le code de cette phase :
- permissions `conversation.*` supprimées ; `data.import` ajoutée ;
- consentement WhatsApp retiré du modèle patient avant tout commit ;
- architecture v1 archivée dans `docs/future/` ;
- fondations réutilisables conservées : file de tâches, outbox, worker, contacts E.164, chiffrement, audit.

Le nouvel ordre des phases figure dans ARCHITECTURE.md, section H.

## Livré

| Élément | Emplacement |
|---|---|
| Tables `patients`, `patient_contacts`, `patient_medical_notes`, `import_batches`, `import_rows` : RLS activée et forcée, droits par colonne, clés composites `(clinic_id, …)` | `db/schema/`, migrations 0006 à 0008 |
| Suppression physique d'un patient limitée aux patients importés (annulation d'un lot) ; les autres sont archivés | migration 0008 (`patients_delete_imported`) |
| Dossier patient : identité, e-mail, note administrative, statut actif ou archivé, verrou optimiste (`version`) incrémenté par toute écriture liée | `modules/patients/` |
| Téléphones normalisés en E.164 selon le pays du cabinet, lien (patient, responsable légal, autre), un seul contact principal (index unique partiel) | `modules/patients/normalize.ts` |
| Recherche sans accents (nom, prénom), par téléphone saisi au format local et par date de naissance ; index trigramme | `patients.service.ts`, migrations 0006 et 0007 |
| Détection des doublons avant création (même nom et date, ou date inconnue) ; la personne décide | `GET /api/patients/duplicates`, page « Nouveau patient » |
| Notes médicales : chiffrées (AES-256-GCM, contexte lié à l'identifiant), en ajout seul, lecture réservée à `patient.medical.read` et auditée, chargées à la demande dans l'interface | `patients.service.ts`, `PatientPage.tsx` |
| Import CSV / Excel : lecture dans le navigateur, association des colonnes proposée, aperçu, envoi par paquets, rapport ligne par ligne, validation, abandon, annulation | ADR 0005, `modules/imports/`, `apps/web/src/lib/import/`, `pages/imports/` |
| API `/api/patients/*` et `/api/imports/*` ; permission vérifiée sur la route et dans le service | `api/routes/patients.ts`, `imports.ts` |
| Interface : liste paginée avec recherche, création, fiche (identité, téléphones, archivage, notes médicales), assistant d'import avec historique | `apps/web/src/pages/patients/`, `pages/imports/` |
| Journaux HTTP sans chaîne de requête : les recherches de patients n'y apparaissent plus | `config/logger.ts` |
| ADR 0005 ; ADR 0004 et architecture v2 | `docs/` |

## Vérifications exécutées

Environnement : Node 22.22, PostgreSQL 16 local.

| Vérification | Résultat |
|---|---|
| Formatage, lint, typage | OK |
| Tests `packages/shared` (matrice 17 permissions × 3 rôles, contrats) | 54/54 |
| Tests `apps/server` : unitaires | 64/64 |
| Tests `apps/server` : intégration sur base jetable, rôle applicatif réel | 128/128 |
| Tests `apps/web` : application complète, routeur réel, API simulée | 33/33 |
| Tests par mutation (voir ci-dessous) | 11 failles introduites, 10 détectées, 1 équivalente (expliquée) |
| Parcours réel dans Chromium (voir ci-dessous) | OK après 3 corrections |
| Dérive schéma/migrations ; build serveur et web ; `pnpm audit --prod` | Aucune dérive ; OK ; aucune vulnérabilité connue |

**Nouveaux tests principaux :**
- **Isolation RLS en SQL brut** (`patients-rls.int.test.ts`) : sans contexte, rien n'est visible ; en contexte A, rien de B n'est lisible ; insertion pour B refusée (code 42501) ; modification et suppression de B sans effet. Ces tests vérifient la base seule, car les services filtrent aussi par cabinet.
- **Import :**
  - parcours complet ;
  - course entre saisie et validation ;
  - lot incomplet ou excédentaire ;
  - annulation qui conserve les fiches modifiées ou avec note médicale ;
  - purge des brouillons ;
  - permissions ;
  - isolation entre cabinets ;
  - volume de 2 000 lignes.
- **API :**
  - matrice des permissions par rôle en HTTP ;
  - CSRF sur DELETE ;
  - codes 400, 404 et 409 ;
  - paquet de 500 lignes de plus de 1 Mo ;
  - contenu réel des journaux.
- **Interface :**
  - liste et recherche ;
  - alerte de doublons ;
  - conflit de version ;
  - notes médicales masquées pour la secrétaire et chargées à la demande ;
  - archivage ;
  - assistant d'import avec un fichier Windows-1252 : colonne médicale jamais envoyée, paquets de 500 avec numéros de ligne, association incomplète bloquée, formats refusés, abandon, annulation.

### Tests par mutation

Chaque faille est introduite seule ; la suite concernée doit échouer.

| Faille introduite | Détectée |
|---|---|
| Politique RLS de lecture `patients` ouverte à tous | Oui (test RLS) |
| Politique RLS `import_rows` ouverte à tous | Oui (test RLS) |
| Suppression autorisée pour les patients saisis à la main | Oui |
| Annulation d'import sans condition de version | Oui |
| Annulation d'import sans exclusion des notes médicales | Oui, par un test ajouté après une première non-détection (voir ci-dessous) |
| Données brutes conservées après validation | Oui |
| Validation d'import sans contrôle de permission (service) | Oui |
| Lecture des notes médicales non auditée | Oui |
| Lecture des notes médicales sans contrôle de permission (service) | Oui |
| Notes médicales affichées sans permission (interface) | Oui |
| Route des notes médicales ouverte à `patient.read` | **Non**, faille équivalente : le service refuse toujours (ligne précédente). La route n'est qu'une première barrière. |

La première non-détection de l'exclusion des notes médicales s'explique ainsi :
- ajouter une note incrémente la version du patient, donc la condition `version = 1` suffisait déjà ;
- le nouveau test insère une note sans changer la version, comme le ferait un futur chemin d'écriture qui oublierait de l'incrémenter ;
- l'annulation doit alors conserver le patient.

### Parcours réel dans Chromium (API et interface lancées, base locale)

**Fichiers d'essai :**
- un CSV Windows-1252 à séparateur « ; » tel qu'Excel l'enregistre en France (accents, numéro belge, numéro trop court, nom manquant, doublon, date impossible, année sur deux chiffres, colonne « Antécédents médicaux ») ;
- un classeur `.xlsx` (cellules date, numéros saisis comme nombres, ligne vide).

**Déroulé :**
1. Administrateur :
   - mot de passe imposé, puis double authentification ;
   - création manuelle d'un patient ;
   - import du CSV : association proposée correcte, colonne médicale non associée et jamais envoyée (contrôlé sur les requêtes réseau) ;
   - rapport : 5 importables dont 3 avec avertissement, 1 refusée, 1 doublon, 1 déjà enregistré ; validation.
2. Import du XLSX : 4 patients ; dates et numéros convertis (`612121212` → `+33612121212`).
3. Recherche « helene » et « 0614141414 » ; fiche importée avec son numéro de dossier.
4. Annulation de l'import CSV : 5 patients supprimés, l'import XLSX intact.
5. Secrétaire :
   - lien d'import absent, page refusée ;
   - `POST /api/imports` direct → 403 ;
   - notes médicales absentes de l'interface ; lecture directe → 403.
6. Contrôle en base :
   - téléphones en E.164 ;
   - notes administratives reprises depuis « Remarques » ;
   - `import_rows.data` vide pour les deux lots ;
   - audit limité aux compteurs.

**Défauts trouvés par ce parcours (aucun test existant ne les détectait), tous corrigés avec un test de non-régression vérifié en échec sur l'ancien code :**
1. **Téléphone principal toujours vide dans la liste et les doublons.**
   - Cause : dans une requête sur une seule table, Drizzle écrit les colonnes sans préfixe de table. Dans la sous-requête, `"id"` désignait donc l'identifiant du contact.
   - Correction : jointure sur le contact principal.
2. **Numéros de ligne décalés après une ligne vide** : le rapport renvoyait à la mauvaise ligne du fichier. Correction : numérotation d'origine conservée.
   - La première version de cette correction dégradait la détection du séparateur CSV sur les petits fichiers. Un test existant l'a détecté : le séparateur est désormais détecté en ignorant les lignes vides.
3. **Données patient dans les journaux.**
   - Cause : Fastify journalisait l'URL complète, dont la chaîne de requête des recherches (nom, prénom, date de naissance, téléphone).
   - Correction : sérialiseur de requête qui ne garde que le chemin ; vérifié sur le serveur réel et par un test d'intégration.

## Écarts par rapport au plan

1. **Pas de rendez-vous ni de paiements liés aux patients** : ils arrivent en Phases 5 et 7. Le test du catalogue des clés étrangères impose d'adapter l'annulation d'import à ce moment.
2. **Pas de fusion de fiches en double** : la détection avertit, la personne décide. Une fusion demanderait des règles métier à valider.
3. **Import limité aux patients** (ADR 0005).

## Limites connues

- **ADR 0005 :** homonymes sans date dans un même fichier ; purge des brouillons déclenchée par l'import suivant ; première feuille seulement.
- **Liste des patients :** juste après un import, elle peut afficher un court instant l'ancien total avant le rafraîchissement (cache de l'interface).
- **Bundle web :**
  - module principal de 592 ko, soit 174 ko compressé ; Vite signale le dépassement de 500 ko ;
  - pages d'import et de mise en place de la double authentification chargées à la demande ;
  - pistes pour la Phase 6 : formater les téléphones côté serveur (84 ko de métadonnées en moins côté navigateur), séparer les bibliothèques en modules distincts.
- **Tests E2E :** le parcours Chromium reste exécuté à la main depuis un script hors dépôt ; automatisation en CI prévue en Phase 10.

## Reste à faire

Phase 4 (cabinet et disponibilités), après validation.
