# Inventaire des données et écarts (loi 09-08)

- **Date :** 2026-10-01.
- **Source :** le code (`apps/server/src/db/schema`, journaux, sauvegardes, configuration de déploiement).
- **Avertissement :** les références juridiques sont celles de [sources.md](sources.md), avec leurs réserves. Un écart « corrigé » l'est techniquement ; cela ne vaut pas conformité.

## 1. Données collectées

Personnes concernées : **patients** et leurs contacts (proches), **personnel** des cabinets (comptes).

| Table | Personnes | Données | Sensible ? | Protection |
|---|---|---|---|---|
| `patients` | Patients | Nom, prénom, date de naissance, e-mail, note administrative (texte libre), statut, origine (saisie ou import) | Oui par contexte : être patient d'un cabinet dentaire est une donnée de santé | RLS par cabinet ; volume chiffré **non vérifié** chez l'hébergeur |
| `patient_contacts` | Patients, proches | Téléphone, lien (patient lui-même, tuteur, autre), libellé | Idem | RLS |
| `patient_medical_notes` | Patients | Notes médicales | **Oui** | Chiffrées dans l'application (AES-256-GCM, `DATA_ENCRYPTION_KEY`) ; lecture réservée au dentiste et tracée |
| `appointments` | Patients, praticiens | Date, type d'acte, statut, **note libre**, motif d'annulation | Oui : type d'acte et note peuvent révéler un soin | RLS ; note **en clair** |
| `charges`, `payments` | Patients | Libellé de l'acte, montant, mode de paiement, référence facultative, motif d'annulation | Oui (libellé de l'acte) | RLS ; **aucune donnée de carte ni de compte bancaire** |
| `import_batches`, `import_rows` | Patients | Copie des lignes importées (`data`), effacée à la validation de l'import ; restent dans les lignes validées la **clé d'identité** (nom et prénom normalisés, date de naissance), la référence externe (ancien logiciel) et les codes d'anomalie | Idem patients | RLS ; brouillons supprimés après 24 h ; clé et référence conservées sans limite (écart E9) |
| `users` | Personnel | E-mail, nom, empreinte du mot de passe (Argon2id), secret de double authentification chiffré, compteurs de sécurité, dernière connexion | Non | Empreintes, chiffrement ; un compte peut appartenir à plusieurs cabinets |
| `clinic_memberships`, `practitioners` | Personnel | Rôle, statut, nom affiché, couleur | Non | RLS |
| `sessions` | Personnel | **Adresse IP**, navigateur, horodatages, empreinte du jeton | Non | Supprimées 30 jours après leur fin |
| `audit_logs` | Personnel (auteur), patients (objet) | Action, identifiants, champs modifiés **sans leur valeur**, **adresse IP** | Indirectement | Ajout seul pour l'application ; aucune suppression |
| `clinics` | Cabinet | Nom, coordonnées, fuseau, paramètres, statut, conservation pour litige | Non | RLS |
| Journaux de l'API (sortie standard → hébergeur) | Personnel | Méthode, chemin **sans paramètres**, **adresse IP du poste**, identifiant de requête, erreurs sans valeur saisie | Non | Aucune valeur saisie ; durée de conservation chez l'hébergeur **non vérifiée** |
| Sentry (si activé) | — | Type et code d'erreur, pile d'appels, service, identifiant de requête ; **ni adresse IP, ni utilisateur, ni valeur saisie** (`error-reporter.ts`, testé) | Non | Région UE |
| Navigateur | Personnel | Cookie de session seulement ; aucun stockage local de données | Non | `__Host-`, `Secure`, `HttpOnly` |

Aucune donnée n'est collectée **auprès du patient** directement. Le personnel du cabinet les saisit ou les importe : l'information du patient (article 5) incombe donc au cabinet.

## 2. Où vont les données (flux et sous-traitants ultérieurs)

| Destinataire | Rôle | Données | Pays | Point à vérifier |
|---|---|---|---|---|
| Railway (Railway Corporation, société américaine) | Hébergement : calcul, PostgreSQL, volume, sauvegardes, bucket de restauration, journaux, proxy d'entrée | Toutes | Région prévue `europe-west4-drams3a` (Amsterdam, **Pays-Bas**) | Localisation des **sauvegardes**, du **bucket** et des **journaux** ; **accès du personnel de Railway** depuis les États-Unis (transfert vers un pays hors liste) ; chiffrement au repos ; DPA de Railway à accepter |
| Sentry (Functional Software Inc., américaine) | Remontée d'erreurs, facultative | Erreurs sans donnée personnelle (conception, tests) | Organisation en région UE | Hébergement exact de la région UE ; DPA ; confirmer qu'aucune donnée personnelle n'y part (événement réel non encore vérifié) |
| GitHub (Microsoft) | Code et CI | **Aucune donnée réelle** : la CI n'utilise que des données fictives | États-Unis | Garder cette règle (CLAUDE.md : données synthétiques uniquement) |
| Notre entreprise (exploitation, support) | Commandes d'administration, restitution, purge | Toutes, à la demande | Maroc ? À préciser | Un accès depuis l'étranger serait un transfert ; liste et engagements de confidentialité des personnes habilitées |
| Aucun autre | — | Pas d'e-mail, de SMS, de messagerie, d'IA ni de paiement en ligne dans le produit | — | Tout ajout = nouveau sous-traitant à déclarer (contrat, CNDP) |

## 3. Écarts constatés

État :
- **corrigé** : changement technique fait et testé ;
- **documenté** : document ou procédure prêt, à faire relire ;
- **à décider** : décision du porteur du projet, du juriste ou du cabinet.

| # | Écart | Gravité | État |
|---|---|---|---|
| E1 | Aucun **contrat de sous-traitance** (article 23) | Bloquant avant tout cabinet réel | Documenté : [contrat-sous-traitance-projet.md](contrat-sous-traitance-projet.md) |
| E2 | Aucune **notice d'information des patients** (article 5) | Bloquant | Documenté : [notice-information-patients-projet.md](notice-information-patients-projet.md) |
| E3 | **Formalités CNDP** non faites : déclaration ou autorisation (article 22 incertain), transfert à l'étranger | Bloquant | À décider : dossier type par cabinet, après avis juridique |
| E4 | **Hébergement hors du Maroc** : Pays-Bas (pays de la liste) par une société américaine ; sauvegardes, journaux et accès de support non localisés | Élevée | À décider : vérifier auprès de Railway ; comparer avec un **hébergeur au Maroc**, ce qui supprimerait le transfert sans le remplacer par d'autres obligations (coût et architecture à évaluer) |
| E5 | **Restitution** en fin de contrat : aucun moyen | Élevée | **Corrigé** : commande `export-clinic` (export JSON complet, notes déchiffrées, sans secret ; rôle applicatif et RLS) ; tests |
| E6 | **Suppression** en fin de contrat : aucun moyen ; sauvegardes non traitées | Élevée | **Corrigé** (outil) : `purge-clinic`, sur instruction seulement (simulation par défaut, cabinet suspendu, confirmation par le nom) ; tests. **Documenté** : sauvegardes et registre ([fin-de-contrat.md](../operations/fin-de-contrat.md)) |
| E7 | **Litiges** : aucun moyen de geler une suppression | Moyenne | **Corrigé** : conservation pour litige par cabinet (`clinic-lifecycle --action hold`). Elle bloque la purge nocturne et la purge de fin de contrat ; tests |
| E8 | **Durées de conservation** non définies : dossier, facturation, audit, lignes d'import, comptes du personnel, journaux d'hébergement | Élevée | **Documenté** : [tableau-de-conservation.md](tableau-de-conservation.md). **Corrigé** (mesure) : durées de revue configurables, rapport `retention-report` **sans suppression** |
| E9 | **Lignes d'un import validé** : la copie complète est effacée à la validation (`imports.service.ts`), mais la **clé d'identité** (nom et prénom normalisés, date de naissance) et la référence externe restent sans limite. Après rectification d'une fiche, l'ancienne clé subsiste (article 8) | Faible | À décider : effacer clé et référence après la fenêtre d'annulation de l'import (volumes mesurés par le rapport dès aujourd'hui) |
| E10 | **Effacement sur demande** (article 8) : une fiche saisie à la main ne peut pas être supprimée par l'application (archivage seulement, par conception, pour protéger le dossier) | Moyenne | À décider : procédure d'administration au cas par cas, avec avis du cabinet et du juriste (dossier médical à conserver ?) |
| E11 | **Droit d'accès** (article 7) : aucun export par patient ; la fiche à l'écran présente coordonnées, rendez-vous, encaissements et notes (dentiste) | Faible | À décider : un export par patient dans l'interface si les cabinets en ont besoin |
| E12 | **Textes libres en clair** (note de rendez-vous, note administrative, libellés d'actes) pouvant contenir des informations de santé. Chiffrement au repos du volume non vérifié | Moyenne | À décider : vérifier le chiffrement au repos chez l'hébergeur ; consignes de saisie aux cabinets (le médical va dans les notes médicales) |
| E13 | **Adresse IP des postes** dans les journaux de l'API (`logger.ts`), conservés par l'hébergeur pour une durée non vérifiée | Faible | À décider : durée chez l'hébergeur ; justification (sécurité) dans le tableau |
| E14 | **Accès de l'exploitant** (commandes d'administration, `railway ssh`) non tracés dans le journal du cabinet | Moyenne | Documenté : registre d'exploitation ([fin-de-contrat.md](../operations/fin-de-contrat.md)) ; trace automatique à décider |
| E15 | **Personnel des cabinets** : pas de notice d'information ; aucune durée pour les comptes désactivés | Faible | À décider : notice personnel (sur le modèle de la notice patients) ; durée |
| E16 | **Comptes communs à plusieurs cabinets** : qualification (responsable ou sous-traitant) pour les données d'authentification | Faible | À décider (juriste) |
| E17 | **Violation de données** : aucune procédure de notification au cabinet | Moyenne | Documenté : clause du contrat (délai à fixer) ; procédure d'incident à écrire avant la production |

Ce que les mesures techniques **ne couvrent pas** : formalités CNDP, contrats signés, information effective des patients, choix de l'hébergeur, durées validées. Le SaaS n'est pas « conforme » du seul fait des mesures en place.
