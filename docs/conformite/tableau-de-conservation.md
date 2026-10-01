# Tableau de conservation (à faire relire)

- **Date :** 2026-10-01.
- **Statut :** projet.
- **Principe :** loi 09-08, article 3 : conserver les données sous une forme identifiante pas plus longtemps que nécessaire à la finalité (texte officiel non lu, voir [sources.md](sources.md)).

Trois statuts de durée, à ne pas confondre :
- **obligation légale** : texte identifié, à confirmer par le juriste ;
- **proposition technique** : choix justifié par la finalité, **pas une obligation** ;
- **non définie** : décision du cabinet (responsable du traitement) après avis juridique.

**Règle du produit (ADR 0014) :** aucune suppression automatique sur la base d'une durée non validée. Les durées non validées se configurent comme **durées de revue** (`RETENTION_REVIEW_*`) : la commande `retention-report` mesure ce qui les dépasse et ne supprime rien. Seules les deux purges techniques déjà en place suppriment automatiquement (lignes 6 et 7). Elles portent sur des données qui ne font pas partie du dossier, et vous pouvez demander de les désactiver.

| # | Catégorie | Tables | Durée | Point de départ | Justification | Statut de la durée | Mécanisme | Litige |
|---|---|---|---|---|---|---|---|---|
| 1 | Dossier patient : identité, contacts, notes médicales, rendez-vous | `patients`, `patient_contacts`, `patient_medical_notes`, `appointments` | **Non définie.** Pas de durée légale marocaine trouvée pour un cabinet dentaire ; la durée française (20 ans) n'est **pas** appliquée | Proposition : dernier rendez-vous (à défaut, création de la fiche) | Continuité des soins, preuve en cas de contestation | Non définie : cabinet, juriste, Ordre | Aucune suppression. Revue : `RETENTION_REVIEW_PATIENT_INACTIVE_DAYS` | Sans effet (rien n'est supprimé) |
| 2 | Actes et encaissements | `charges`, `payments` | 10 ans **si** ces enregistrements sont des pièces au sens de l'article 211 du CGI (doubles de factures, justificatifs, documents comptables) | **À confirmer** (non précisé dans les extraits) ; le rapport mesure depuis la date de l'encaissement ou de l'acte | Obligation fiscale **du cabinet** ; l'application n'émet pas de factures et ne stocke **aucune donnée bancaire** (mode de paiement et référence facultative) | Obligation légale à confirmer pour ces enregistrements | Aucune suppression. Revue : `RETENTION_REVIEW_BILLING_DAYS` | Sans effet |
| 3 | Journal d'audit (qui a fait quoi, d'où) | `audit_logs` | Proposition : **la durée du dossier qu'il trace** (une trace d'accès à un dossier sert tant que le dossier peut être contesté) ; à défaut, la durée du contrat | Date de l'action | Sécurité (article 23), preuve des accès aux dossiers et des modifications | Proposition technique | Aucune suppression. Revue : `RETENTION_REVIEW_AUDIT_LOG_DAYS` | Sans effet |
| 4 | Lignes d'un import validé : clé d'identité (nom et prénom normalisés, date de naissance) et référence externe. La copie complète est déjà effacée à la validation | `import_rows` | Proposition : **30 jours** après l'import (fenêtre d'annulation), puis effacement de la clé et de la référence (compteurs gardés) | Date de l'import | Seule finalité : annuler l'import et en afficher le rapport. Au-delà, clé obsolète d'une fiche peut-être rectifiée (écart E9) | Proposition technique | Aucune suppression aujourd'hui. Revue : `RETENTION_REVIEW_IMPORT_ROWS_DAYS` | — |
| 5 | Comptes du personnel désactivés | `users`, `clinic_memberships` | **Non définie** | Désactivation | Le journal d'audit cite ces comptes (identifiant seulement) | Non définie | Aucune suppression | — |
| 6 | Sessions terminées : adresse IP, navigateur | `sessions` | **30 jours** après la fin (paramètre `SESSION_RETENTION_DAYS`, 30 au minimum) | Fin : révocation, expiration ou inactivité | Sécurité : enquêter sur une connexion suspecte récente ; au-delà, minimisation | Proposition technique, **déjà en place** (Phase 9) | Purge nocturne | **Suspendue** pour le cabinet |
| 7 | Brouillons d'import abandonnés | `import_batches`, `import_rows` (brouillons) | **24 heures** | Création du brouillon | Fichier analysé mais jamais validé : rien n'est entré dans le dossier | Proposition technique, **déjà en place** (Phase 3) | Purge nocturne | **Suspendue** pour le cabinet |
| 8 | Journaux de l'API (adresse IP des postes, chemins sans paramètres) | Hébergeur | Fixée par l'hébergeur : **non vérifiée** | Écriture | Sécurité et diagnostic | À vérifier | Hébergeur | Hors de notre contrôle : export ponctuel si un litige l'exige |
| 9 | Erreurs remontées (Sentry, facultatif) | Sentry | Fixée par l'offre Sentry : **non vérifiée** | Événement | Diagnostic ; aucune donnée personnelle par conception | À vérifier | Sentry | — |
| 10 | Sauvegardes de la base | Hébergeur | Quotidiennes 6 jours, hebdomadaires 27 jours, mensuelles 89 jours ; restauration à un instant donné environ 4 semaines (documentation Railway, [sauvegarde-restauration.md](../operations/sauvegarde-restauration.md)) | Création de la sauvegarde | Reprise après incident | Paramètres de l'hébergeur | Expiration automatique | Copie dédiée si un litige l'exige ([fin-de-contrat.md](../operations/fin-de-contrat.md)) |
| 11 | Données d'un cabinet après résiliation | Toutes les tables du cabinet | Restitution, puis suppression **[N] jours** après la remise de l'export (proposition : 30), sauf conservation pour litige ; les sauvegardes expirent ensuite (ligne 10) | Fin du contrat | Fin de la finalité ; article 23 (contrat) | À fixer au contrat | `export-clinic`, puis `purge-clinic` **sur instruction**, jamais par une durée | **Bloque** la purge |
| 12 | Export de restitution (fichier) | Hors base | Notre copie : supprimée dès la remise confirmée au cabinet | Remise | Le cabinet devient seul détenteur | Proposition technique | Procédure manuelle | Conservé (coffre) si un litige l'exige |

## Ce que le cabinet doit décider (avec son juriste)

1. Durée du dossier patient (ligne 1), et son point de départ.
2. Portée de l'article 211 du CGI pour les actes et encaissements (ligne 2), et point de départ des dix ans.
3. Délai entre la fin du contrat et la suppression (ligne 11).
4. Validation, modification ou refus des propositions techniques (lignes 3, 4, 6, 7, 12).

Une durée validée devient une suppression automatique seulement après trois étapes : une décision écrite, une modification du code avec tests, et une mise à jour de l'ADR 0014. La configuration seule ne le permet pas.
