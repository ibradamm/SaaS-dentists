# ADR 0014 — Conservation, restitution et suppression des données d'un cabinet

- **Statut :** accepté (2026-10-01), étape « loi 09-08 (préparation) ».
- **Durées :** non validées juridiquement ([tableau de conservation](../conformite/tableau-de-conservation.md)).
- **Demande du porteur du projet :**
  - rendre configurables les durées dont la validation juridique reste nécessaire ;
  - n'effectuer **aucune suppression irréversible sur la base d'une durée non validée** ;
  - prévoir la restitution des données en fin de contrat, leur suppression ultérieure, le traitement des sauvegardes et les exceptions liées aux litiges.

## 1. Contexte

- Chaque cabinet est responsable du traitement ; l'éditeur est son sous-traitant (loi 09-08, article 23, texte officiel non lu : [sources.md](../conformite/sources.md)).
- Avant cette étape, aucun moyen de restituer ni de supprimer les données d'un cabinet. Seules deux purges techniques existaient : sessions terminées depuis 30 jours (ADR 0011) et brouillons d'import de plus de 24 heures.
- Aucune durée légale marocaine n'a été trouvée pour le dossier d'un cabinet dentaire. L'article 211 du CGI (dix ans) vise les pièces comptables du cabinet, et sa portée pour les actes et encaissements de l'application reste à confirmer.
- Une donnée supprimée reste dans les sauvegardes jusqu'à leur expiration : 89 jours au plus pour les instantanés mensuels de Railway.

## 2. Décision

| Élément | Choix | Raison |
|---|---|---|
| Catalogue | `apps/server/src/db/admin/clinic-data.ts` : chaque table du schéma public est propre à un cabinet (colonne `clinic_id`, ordre des clés étrangères) ou globale (`clinics`, `users`, `appointment_statuses`). Un test refuse toute table non classée | Une table oubliée ne serait ni restituée ni supprimée |
| Restitution | Commande `export-clinic` : JSON complet (`dental-export/1`), lignes converties par PostgreSQL (dates sans passage par le fuseau du serveur), notes médicales déchiffrées. Exclus : sessions et secrets d'authentification. Rôle applicatif et `withTenant` | La RLS exclut tout autre cabinet ; aucun accès propriétaire nécessaire. Format lisible par n'importe quel successeur |
| Suspension | `clinic-lifecycle --action suspend` (rôle propriétaire). Connexion refusée, sessions révoquées à la requête suivante (déjà en place) | Étape préalable à la restitution et à la purge ; réversible |
| Conservation pour litige | Colonne `clinics.legal_hold_since` (migration 0021), posée ou levée par `clinic-lifecycle --action hold|release`. Le rôle applicatif la lit sans pouvoir la modifier. Elle suspend la purge nocturne et la purge de fin de contrat | Une suppression ne doit jamais détruire une preuve demandée par un litige |
| Purge | `purge-clinic` : sur **instruction**, jamais déclenchée par une durée. Connexion administrateur (seule à pouvoir supprimer le journal d'audit et les dossiers malgré la RLS) ; une transaction ; filtre `clinic_id` sur chaque requête. Comptes rattachés à ce seul cabinet supprimés, comptes partagés conservés | Irréversible : garde-fous multiples |
| Garde-fous de la purge | Connexion qui contourne la RLS (sinon refus), cabinet **suspendu**, **sans conservation pour litige**, confirmation par le **nom exact**, **simulation par défaut** (suppression réelle puis annulation : volumes exacts, preuve que la purge passe), `--execute` explicite | Erreur de cabinet ou de manipulation : refusée |
| Durées non validées | Variables `RETENTION_REVIEW_*` facultatives. La commande `retention-report` mesure, par cabinet et par catégorie, les volumes, le plus ancien enregistrement et ce qui dépasse la durée. **Aucune suppression** | Demande explicite du porteur du projet. La configuration ne peut pas, à elle seule, déclencher une suppression |
| Durée validée plus tard | Suppression automatique ajoutée **par du code et des tests**, après décision écrite, avec mise à jour de cette ADR et du tableau | Une suppression irréversible mérite une revue de code, pas un changement de variable |
| Purges techniques existantes | Conservées (sessions 30 jours, brouillons 24 heures) et présentées comme **propositions techniques**, pas comme des obligations | Données hors dossier ; désactivables sur demande |
| Sauvegardes | Non modifiées par la purge. Expiration annoncée au contrat ; **purges rejouées** après toute restauration antérieure ; registre d'exploitation hors de la base | Une sauvegarde contient tous les cabinets ; le registre doit survivre à une restauration |

## 3. Conséquences

- Toute nouvelle table du schéma public doit entrer dans le catalogue (test `clinic-data.int.test.ts`). Elle est alors restituée et purgée sans autre changement.
- Les commandes d'administration s'exécutent dans des conteneurs distincts :
  - `export-clinic` et `retention-report` dans `api` (rôle applicatif, clé) ;
  - `clinic-lifecycle` et `purge-clinic` dans `migrate` (propriétaire, administrateur).
- La CI les exerce avec les images de production (pile staging locale).
- Le fichier d'export contient les notes en clair : chiffrement à la remise, suppression de notre copie ([fin-de-contrat.md](../operations/fin-de-contrat.md)).
- Non couverts ici :
  - effacement d'une seule fiche à la demande d'un patient ;
  - export par patient ;
  - effacement de la clé d'identité des lignes d'un import validé (écarts E9 à E11, [inventaire-et-ecarts.md](../conformite/inventaire-et-ecarts.md)).

## 4. Vérification

- Tests d'intégration (`clinic-data.int.test.ts`, 7 tests) :
  - classement de toutes les tables ;
  - export complet et sans secret ;
  - droits refusés au rôle applicatif ;
  - quatre refus de purge ;
  - simulation sans effet ;
  - purge sans effet sur un autre cabinet et compte partagé conservé ;
  - revue sans suppression.
- `retention.int.test.ts` : conservation pour litige dans la purge nocturne.
- Quatre failles injectées (table oubliée, purge sans filtre, conservation pour litige ignorée, comptes exportés en entier) : toutes détectées. Une cinquième (purge nocturne qui ignore la conservation pour litige) : détectée.
- Commandes compilées exécutées sur la base locale ; en CI, sur les images de production.
