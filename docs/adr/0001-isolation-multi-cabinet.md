# ADR 0001 — Isolation des données entre cabinets

- Statut : accepté (Phase 1, 2026-09-26)
- Contexte : ARCHITECTURE.md, invariant I2

## Décision

L'isolation repose sur quatre mécanismes indépendants. Chacun suffit à bloquer une fuite si un autre fait défaut.

1. **Row-Level Security PostgreSQL, activée et forcée** sur toute table portant `clinic_id` (et sur `clinics`). La politique `tenant_isolation` compare `clinic_id` à `app.current_clinic_id()`, en lecture (`USING`) comme en écriture (`WITH CHECK`).
2. **Contexte de transaction** : `withTenant(db, clinicId, fn)` ouvre une transaction et appelle `set_config('app.clinic_id', id, true)`. Le paramètre est local à la transaction : il disparaît au commit ou au rollback, même quand la connexion retourne au pool. Sans contexte, `app.current_clinic_id()` renvoie `NULL` et aucune ligne n'est visible (échec fermé).
3. **Deux rôles PostgreSQL** :
   - `dental_owner` possède les tables et exécute les migrations ;
   - `dental_app`, utilisé par l'API et le worker, n'est ni superutilisateur, ni `BYPASSRLS`, ni propriétaire, et n'a que les droits DML nécessaires. `audit_logs` y est en ajout seul, et les colonnes `status`, `currency` et `country_code` de `clinics` ne sont pas modifiables.
4. **Garde au démarrage** : l'API et le worker refusent de démarrer si leur rôle est superutilisateur, `BYPASSRLS` ou propriétaire d'une table (`assertLeastPrivilege`).

`clinic_id` a pour valeur par défaut `app.current_clinic_id()` : une insertion dans le contexte d'un cabinet est rattachée à ce cabinet sans que le code ait à le répéter. Une valeur explicite différente est refusée par la politique RLS.

## Modèle de menace (précision, Phase 2)

Le contexte (`app.clinic_id`, etc.) est positionné par l'application, et tout rôle PostgreSQL peut appeler `set_config`. La RLS protège donc contre les **oublis** : une requête sans filtre, un contexte absent, une connexion réutilisée. Elle ne protège pas contre un processus applicatif compromis, qui pourrait choisir un autre cabinet.

Contre ce second risque, les défenses sont ailleurs :
- sessions liées à un cabinet et vérifiées côté serveur ;
- aucun identifiant de cabinet accepté depuis le client ;
- moindre privilège du rôle `dental_app` (ni DDL, ni `BYPASSRLS`, droits par colonne) ;
- journal d'audit.

Par ailleurs, les services filtrent aussi explicitement par `clinic_id` dans leurs requêtes. Ce filtre et la RLS forment deux couches indépendantes.

## Alternatives écartées

| Option | Raison du rejet |
|---|---|
| Filtre `WHERE clinic_id = ?` dans chaque requête, sans RLS | Un seul oubli suffit à provoquer une fuite, et aucun mécanisme ne le détecte |
| Une base ou un schéma par cabinet | Migrations multipliées et exploitation lourde, pour un bénéfice d'isolation que la RLS apporte déjà à ce volume |
| RLS sans `FORCE` | Une mauvaise `DATABASE_URL` pointant vers le propriétaire contournerait la RLS. `FORCE` et la garde de démarrage ferment ce cas |

## Conséquences

- Les opérations qui traversent les cabinets (création de cabinet, jobs système) utilisent le rôle propriétaire en positionnant explicitement le contexte, ou itèrent sur les cabinets.
- Tests garde-fous :
  - `schema-catalog.int.test.ts` échoue si une nouvelle table avec `clinic_id` n'est pas protégée ;
  - `tenant-isolation.int.test.ts` vérifie lecture, écriture, mise à jour croisée et disparition du contexte.
  - Un test par mutation a été réalisé : RLS retirée, audit rendu modifiable, contexte rendu persistant. Chaque mutation fait échouer la suite.
