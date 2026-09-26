# Phase 2 — Authentification, rôles et permissions : rapport

Date : 2026-09-26. Statut : **code et tests locaux terminés** ; résultat de la CI GitHub consigné dans le résumé de fin de phase.

## Livré

| Élément | Emplacement |
|---|---|
| Tables `users` (commune à la plateforme), `clinic_memberships` (rôle par cabinet), `sessions`, avec RLS activée et forcée, droits par colonne, triggers | `db/schema/`, migrations 0003 à 0005 |
| Variables de contexte d'authentification (`app.auth_email`, `app.user_id`, `app.session_token_hash`) : visibilité minimale, sans fonction privilégiée | migration 0003, `db/tenant.ts` |
| Catalogue de 17 permissions, matrice ADMIN / DENTIST / SECRETARY (réponses O9 appliquées), rôles à double authentification obligatoire | `packages/shared/src/permissions.ts` |
| Connexion : Argon2id, verrouillage après 10 échecs, même message et même durée pour un compte inconnu | `modules/auth/` |
| Sessions : cookie `httpOnly`, empreinte du jeton en base, inactivité 60 min, durée maximale 12 h, révocation, renouvellement du jeton à chaque élévation de privilège | `modules/auth/auth.service.ts`, `api/session-cookie.ts` |
| Double authentification TOTP : secret chiffré (AES-256-GCM + contexte), anti-rejeu en deux couches, 5 essais maximum, mise en place imposée aux ADMIN et DENTIST | `modules/auth/totp.ts`, `lib/secret-box.ts` |
| Étapes imposées (code, mot de passe temporaire, mise en place de la double authentification), vérifiées par le serveur | `api/auth-plugin.ts`, `modules/auth/restrictions.ts` |
| CSRF : jeton par session et vérification de l'origine ; limitation de débit globale et renforcée sur les routes sensibles | `api/auth-plugin.ts`, `api/app.ts` |
| API `/api/auth/*`, `/api/users` (création avec mot de passe temporaire, rôle, désactivation, réinitialisations), `/api/clinic` | `api/routes/` |
| Protection du dernier administrateur, y compris en cas de modifications simultanées (verrou `FOR UPDATE`) | `modules/users/users.service.ts` |
| Audit : connexions réussies et échouées, verrouillage, codes faux, mise en place de la double authentification, déconnexion, changement de mot de passe, création et modification de comptes, réinitialisations, paramètres du cabinet | services |
| Commandes d'administration : création de cabinet, premier administrateur, réinitialisation de la double authentification ; `pnpm setup:env` | `db/cli/`, `scripts/init-env.mjs` |
| Interface : connexion, code, mot de passe imposé, mise en place avec QR code, accueil, gestion des utilisateurs ; composants accessibles écrits à la main (registre shadcn/ui inaccessible depuis l'environnement) | `apps/web/src/` |
| ADR 0003 ; ADR 0001 complété (modèle de menace de la RLS) | `docs/adr/` |

## Vérifications exécutées

Environnement : Node 22.22, PostgreSQL 16.13 local.

| Vérification | Résultat |
|---|---|
| Formatage, lint, typage | OK |
| Tests `packages/shared` : matrice 17 permissions × 3 rôles, contre un tableau écrit indépendamment | 57/57 |
| Tests `apps/server` (unitaires et intégration sur base jetable, rôle applicatif réel) | 124/124 |
| Tests `apps/web` : application complète, routeur réel, API simulée | 8/8 |
| Tests par mutation (voir ci-dessous) | 8 failles introduites, 8 détectées |
| Parcours réel dans Chromium via le proxy Vite (voir ci-dessous) | OK |
| Parcours réel en `curl` contre l'API : mot de passe temporaire, étape imposée, changement, permissions, refus 403, déconnexion | OK |
| Build serveur et web ; dérive schéma/migrations | OK ; aucune dérive |

Parcours dans Chromium :
1. redirection vers la connexion ;
2. mot de passe temporaire, puis changement imposé ;
3. mise en place imposée de la double authentification, code TOTP calculé depuis la clé affichée ;
4. accès complet ;
5. création d'un compte et affichage du mot de passe temporaire ;
6. cookie `httpOnly` et `SameSite=Lax`, illisible par JavaScript ;
7. déconnexion.

Tests par mutation : chaque faille est introduite seule, la suite doit échouer.

| Faille introduite | Détectée |
|---|---|
| Anti-rejeu TOTP retiré dans la vérification | Oui, par le test unitaire ajouté après une première non-détection (voir ci-dessous) |
| Anti-rejeu retiré dans la vérification **et** en base | Oui (intégration) |
| Verrouillage du compte désactivé | Oui |
| Contrôle CSRF retiré | Oui |
| Étape d'authentification ignorée | Oui |
| Comptes visibles par tous (politique RLS `users`) | Oui |
| Secrétaire dotée de `user.manage` | Oui (matrice et HTTP) |
| Expiration d'inactivité retirée | Oui |
| Service sans contrôle de permission | Oui |
| Verrou « dernier administrateur » retiré | Oui, 5 exécutions sur 5 ; test stable 5 fois sur 5 avec le verrou |

La première non-détection s'explique ainsi :
- retirer l'anti-rejeu dans otplib ne faisait échouer aucun test, car la mise à jour conditionnelle en base bloquait toujours le rejeu ;
- deux couches indépendantes existaient donc, mais seule leur combinaison était testée ;
- un test unitaire couvre maintenant la première couche seule.

## Écarts par rapport au plan validé

1. **Pas de tables `roles` / `permissions` / `role_permissions`** : catalogue et matrice dans le code, rôle porté par l'appartenance au cabinet (ADR 0003).
2. **Pas de fonctions `SECURITY DEFINER`** pour l'authentification : variables de contexte à visibilité minimale (ADR 0003).
3. **Composants d'interface écrits à la main** au lieu de shadcn/ui, dont le registre est inaccessible depuis l'environnement. Même principe (code dans le dépôt), sans dépendance à Radix pour l'instant.
4. **Pas de réinitialisation du mot de passe par e-mail** (prévu : « évitable au MVP ») : l'administrateur génère un mot de passe temporaire.

## Limites connues
- Voir ADR 0003, « Conséquences et limites connues » : effets multi-cabinets des réinitialisations, pas d'interface de choix de cabinet, existence d'un e-mail révélée à la création, perte de la clé de chiffrement.
- **Limitation de débit :** en mémoire, adaptée à une seule instance d'API.
- **Sessions expirées :** jamais supprimées pour l'instant (le rôle applicatif n'a pas le droit DELETE). Une tâche de purge est à ajouter avec les durées de conservation (J.2).
- **Tests E2E :** pas de test automatisé dans le dépôt ; le parcours Chromium a été exécuté à la main depuis un script hors dépôt. Automatisation prévue en Phase 8.
- **Taille du bundle web :** 472 ko, soit 146 ko compressé (mesure du build) ; optimisation prévue en Phase 8.

## Démarrer (développement)

```bash
pnpm setup:env            # .env avec clé de chiffrement générée
pnpm dev:db               # ou docker compose -f infra/docker-compose.yml up -d
pnpm db:bootstrap && pnpm db:migrate && pnpm db:seed   # affiche 3 comptes de démonstration
pnpm dev:api & pnpm dev:web                              # http://127.0.0.1:5173
```

Production :
```bash
pnpm admin:create-clinic --name "…" --timezone Europe/Paris --locale fr-FR --currency EUR --country FR
pnpm admin:create-admin --clinic <id> --email … --name "…"
```

## Reste à faire
Phase 3 (patients), après validation.
