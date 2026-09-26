# ADR 0005 — Import de patients depuis un fichier (CSV / Excel)

- Statut : accepté (2026-09-26)
- Contexte : question O3. Le produit est un SaaS généraliste : on ne sait pas quel logiciel les cabinets utilisent aujourd'hui. Le porteur du projet demande un portail « importer des fichiers » pour reprendre leurs données.

## Décision

### 1. Le fichier est lu dans le navigateur, jamais envoyé au serveur

- **Formats :** `.csv` / `.txt` (papaparse) et `.xlsx` (read-excel-file, chargée à la demande ; première feuille).
- **Refusés avec un message :** `.xls` (ancien format binaire), fichiers de plus de 10 Mo, plus de 20 000 lignes, plus de 100 colonnes.
- **Encodage :** UTF-8 (avec ou sans BOM) si le contenu est valide, sinon Windows-1252, l'encodage des CSV enregistrés par Excel sous Windows en français. Le séparateur est détecté automatiquement.
- **Numéros de ligne :** conservés tels qu'Excel les affiche. Les lignes vides sont écartées sans décaler la numérotation, pour que le rapport renvoie à la bonne ligne du fichier.
- **Envoi :** seules les colonnes associées par l'utilisateur partent au serveur, en texte brut, par paquets de 500 lignes. Une colonne non associée, par exemple « Antécédents », ne quitte jamais le poste.

**Raisons :**
- pas d'analyseur de fichiers bureautiques côté serveur (surface d'attaque : archives zip, XML) ;
- pas de fichier de données personnelles stocké ;
- minimisation des données envoyées.

### 2. Le serveur revalide tout

Le navigateur est une source non fiable.

- **Contrat :** Zod contrôle chaque paquet (types, longueurs, 500 lignes au plus, 5 Mo par requête).
- **Validation par ligne :** `validatePatientRow` applique deux niveaux.
  - **Erreur (ligne refusée) :** nom ou prénom absent ou trop long.
  - **Avertissement (valeur ignorée, ligne acceptée) :** date, téléphone, e-mail, numéro de dossier ou note invalides.
- **Aucune correction devinée :** seuls les espaces et le format sont normalisés.
- **Dates :** format choisi par l'utilisateur (JJ/MM/AAAA par défaut, MM/JJ/AAAA, AAAA-MM-JJ). Le format ISO est toujours accepté ; une cellule date d'Excel devient ISO dans le navigateur. Les années sur deux chiffres sont refusées (ambiguës), ainsi que les dates avant 1900 ou futures.
- **Téléphones :** jusqu'à 3 par ligne, normalisés en E.164 avec le pays du cabinet.
- **Données médicales :** jamais importées. Elles exigeraient un chiffrement et une vérification clinique que l'import ne peut pas garantir.

### 3. Cycle d'un lot

```
DRAFT ──(paquets de lignes)──► rapport ──► COMMITTED ──► REVERTED
   └──────────────► DISCARDED
```

La validation (`commit`) est refusée dans trois cas :
- lot incomplet (lignes reçues différentes du total annoncé) ;
- excès de lignes ;
- ligne reçue deux fois.

### 4. Doublons

| Cas | Règle | Résultat |
|---|---|---|
| Dans le fichier | Même nom, prénom et date de naissance (normalisés, sans accents), ou même numéro de dossier | Ligne ignorée (`DUPLICATE_IN_FILE`) |
| Déjà dans le logiciel | Même identité avec date de naissance, ou même numéro de dossier | Ligne ignorée (`EXISTING`) ; aucune fiche existante n'est modifiée |
| Homonyme sans date de naissance d'un côté | Doute | Ligne importée avec l'avertissement `POSSIBLE_DUPLICATE` |

La comparaison avec les fiches existantes est refaite au moment de la validation, sous verrou du lot. Un patient saisi entre l'envoi et la validation n'est donc pas dupliqué (test de concurrence).

### 5. Minimisation et conservation

- `import_rows.data` (données personnelles normalisées) est effacé à la validation et à l'abandon.
- Les brouillons de plus de 24 h sont effacés à la création de l'import suivant du cabinet.
- Seuls restent les numéros de ligne, les statuts et les codes d'anomalie.

### 6. Annulation d'un import validé

- **Patients supprimés :** uniquement ceux du lot encore intacts, c'est-à-dire en version 1 (aucune modification, aucun contact ajouté ou modifié) et sans note médicale.
- **Autres patients :** conservés et comptés.
- **Défense en profondeur :**
  - la politique RLS `patients_delete_imported` n'autorise la suppression physique que pour un patient issu d'un import ; un patient saisi à la main ne peut être qu'archivé ;
  - la clé étrangère des notes médicales est en `RESTRICT` ;
  - un test du catalogue liste les tables qui référencent `patients`. Toute nouvelle table liée (rendez-vous, paiements) fait échouer ce test tant qu'elle n'est pas prise en compte par l'annulation.

### 7. Droits et traçabilité

- **Permission :** `data.import`, réservée à l'administrateur, vérifiée dans chaque méthode du service et sur chaque route.
- **Audit :** au niveau du lot (création, validation, annulation, abandon), avec des compteurs uniquement, sans nom ni valeur.
- **Lien avec le lot :** chaque patient créé porte `import_batch_id` et `created_source = 'IMPORT'`.

## Options écartées

| Option | Raison |
|---|---|
| Envoi du fichier et analyse côté serveur | Surface d'attaque, stockage de fichiers de données personnelles, envoi de colonnes inutiles |
| Connecteurs dédiés à des logiciels précis | Logiciels des cabinets inconnus (O3) ; à reconsidérer à la demande |
| Mise à jour des fiches existantes par l'import | Risque d'écraser des données correctes ; un import ne fait que créer |
| Import des antécédents médicaux | Données de santé non vérifiables ; saisie manuelle par le praticien |

## Limites connues

- Deux lignes homonymes **sans** date de naissance dans le même fichier sont toutes deux importées, sans avertissement entre elles.
- La purge des brouillons de plus de 24 h n'a lieu qu'à la création d'un nouvel import. Une tâche planifiée est prévue en Phase 9 (rétention).
- Seule la première feuille d'un classeur est lue.
- Seuls les patients sont importables. Importer des rendez-vous ou des paiements demandera une extension de l'import et des conditions d'annulation.
