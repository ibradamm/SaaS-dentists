# Sauvegardes et restauration

**État au 2026-09-30 : procédure prête, jamais exécutée sur un hébergement.** Aucun staging n'existe (aucun budget). Seul l'exercice local est prouvé : `e2e/tests/10-backup-restore.spec.ts`, à chaque exécution de la CI (`pg_dump`, restauration dans une base neuve, comparaison des données, de la RLS, des rôles, des droits et des migrations ; note médicale relue avec la clé conservée à part).

**Une sauvegarde qui n'a pas été restaurée avec succès n'est pas validée.**

## 1. Mécanismes disponibles sur Railway (documentation officielle, lue le 2026-09-30)

| Mécanisme | Fonctionnement | Conservation | Restauration | Limites |
|---|---|---|---|---|
| Sauvegardes du volume | Instantanés du volume PostgreSQL : manuels, quotidiens, hebdomadaires, mensuels | Quotidien : 6 jours ; hebdomadaire : 27 jours ; mensuel : 89 jours | Nouveau volume monté à la place de l'ancien (modification à valider), service redémarré. L'ancien volume est conservé | Même projet et même environnement seulement ; **effacer le volume efface ses sauvegardes** ; sauvegarde manuelle limitée à 50 % de la taille du volume |
| Restauration à un instant donné | pgBackRest : journaux WAL envoyés en continu vers un bucket Railway ; sauvegarde complète hebdomadaire, différentielle quotidienne | Environ 4 semaines | Nouveau service `postgres-restored-…` à côté de l'original, qui n'est jamais modifié ; bascule manuelle | Fenêtre à partir de l'activation seulement ; bascule à faire à la main |
| `pg_dump` hors de Railway | Export logique vers un stockage d'un autre fournisseur | À définir | Base neuve, comme l'exercice local | Pas automatisé à ce jour |

À vérifier auprès de Railway ([Trust Center](https://trust.railway.com)) avant toute production :
- chiffrement au repos des volumes, des sauvegardes et du bucket ;
- localisation des sauvegardes ;
- personnes pouvant restaurer.

La documentation ne le dit pas. Statut : NON VÉRIFIÉ.

**Pour la production**, les sauvegardes du volume et le bucket de restauration restent chez le même fournisseur, dans le même compte. Une copie `pg_dump` régulière chez un autre fournisseur couvre la perte du compte ou du fournisseur. Elle contient des données personnelles : chiffrée, accès restreint, durée de conservation fixée. Les notes médicales y restent chiffrées par `DATA_ENCRYPTION_KEY`.

## 2. Objectifs à valider par le porteur du projet (proposition)

| Grandeur | Proposition | Mécanisme |
|---|---|---|
| Perte de données maximale (RPO) | 5 minutes | Restauration à un instant donné : archivage au moins toutes les 60 s |
| Durée de restauration (RTO) | 1 heure | À mesurer pendant l'exercice |
| Fréquence de l'exercice | Chaque trimestre, et après tout changement d'hébergement ou de version de PostgreSQL | |

## 3. Exercice sur le staging (données synthétiques uniquement)

Préparation : comptes de test ([deploiement-staging.md](deploiement-staging.md), section 6), plus un compte dentiste créé par l'administrateur de test.

1. **Données repérables** (par l'interface, avec les comptes de test) :
   - patient « Restauration Alpha », téléphone synthétique ;
   - rendez-vous le lendemain à 10 h (heure du cabinet) ;
   - acte de 300,00 MAD, encaissement de 100,00 MAD ;
   - note médicale « note de restauration » (compte dentiste).

   Noter l'heure **T0** (UTC). Relever ce qu'affiche l'application : fiche, agenda, compte du patient, journal d'audit.
2. **Sauvegarde manuelle** du volume (Backups → Create backup). Noter l'heure.
3. Attendre **au moins 2 minutes** (archivage des WAL).
4. **Incident simulé** (noter l'heure **T1**) :
   - renommer le patient ;
   - annuler le rendez-vous ;
   - annuler l'encaissement ;
   - créer un patient « Restauration Bêta ».
5. **Restauration à un instant donné** à T0 + 30 s (Backups → Point-in-time → Restore). Noter le début de l'opération.
6. **Bascule du staging vers la base restaurée**, sans toucher à l'original :
   - dans `.railway/railway.ts`, remplacer `postgres(...)` par le nom du service restauré, dans les références ;
   - `railway config plan`, puis `railway config apply` ;
   - redéployer `migrate` (« Base conforme ») ;
   - **avant `api` et `worker`** : rejouer les purges de cabinets inscrites au registre après la date de la sauvegarde ([fin-de-contrat.md](fin-de-contrat.md), section 4). Sinon un cabinet supprimé réapparaît ;
   - redéployer `api` et `worker`. Noter la fin (API en bonne santé).
7. **Clé tirée du coffre** : remplacer la valeur de `DATA_ENCRYPTION_KEY` par la copie du coffre, et comparer son empreinte avec celle du registre.
8. **Vérifications**, toutes obligatoires :
   - patient « Restauration Alpha » intact, « Restauration Bêta » absent ;
   - rendez-vous et encaissement dans leur état de T0 ; restant dû à 200,00 MAD ;
   - note médicale lisible par le dentiste : la clé du coffre déchiffre la base restaurée ;
   - journal d'audit présent jusqu'à T0, sans les actions de l'incident ;
   - `migrate` : toutes les migrations en place, « Base conforme » (RLS, rôles, journal) ;
   - `check:deployment` : 10 OK ;
   - isolation : le second cabinet de test ne voit rien du premier.
9. **Exercice de la sauvegarde du volume** : même principe avec la sauvegarde de l'étape 2. La restauration remplace le volume et redémarre `postgres`.
10. **Retour** à la base d'origine, ou maintien de la base restaurée. Supprimer le service inutile.

## 4. Résultats à consigner

| Mesure | Restauration à un instant donné | Sauvegarde du volume |
|---|---|---|
| Heure demandée / heure obtenue | | |
| Données perdues (RPO mesuré) | | |
| Durée, du clic à l'API en bonne santé (RTO mesuré) | | |
| Vérifications de l'étape 8 | | |
| Anomalies | | |

Le contrôle 20 de la matrice (`docs/phases/phase-11-audit-preproduction.md`) passe à CONFORME seulement quand ce tableau est rempli, et les vérifications toutes réussies.
