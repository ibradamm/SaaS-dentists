# Consignes pour Claude Code

Projet : plateforme de gestion de cabinet dentaire. Le plan validé est dans `docs/ARCHITECTURE.md`. Le travail avance **par phases** : ne commencer une phase qu'après validation de la précédente par l'utilisateur.

## Commandes

- Vérification complète : `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- PostgreSQL local sans Docker : `pnpm dev:db`, puis `pnpm db:bootstrap && pnpm db:migrate`
- Nouvelle migration :
  - après une modification de `apps/server/src/db/schema` : `pnpm --filter @dental/server db:generate` ;
  - SQL manuel (RLS, droits, triggers) : `pnpm --filter @dental/server exec drizzle-kit generate --custom --name=<nom>`.

## Règles non négociables

- Ne jamais annoncer qu'un test est passé sans l'avoir exécuté ; ne jamais présenter une intégration comme fonctionnelle sans l'avoir vérifiée.
- Toute requête métier passe par `withTenant`. Toute table portant `clinic_id` a RLS activée et forcée, avec une politique.
- L'API et le worker utilisent le rôle `dental_app`. Le rôle `dental_owner` sert uniquement aux migrations et à l'administration.
- Une migration appliquée est immuable. Pas de migration descendante (ADR 0002).
- Les permissions sont vérifiées côté serveur, jamais seulement dans l'interface.
- Aucun secret dans le code ni dans Git. Aucune donnée sensible dans les logs.
- Les actions externes (WhatsApp, Google, rappels) sont enfilées dans la transaction métier via `enqueue` (outbox).
