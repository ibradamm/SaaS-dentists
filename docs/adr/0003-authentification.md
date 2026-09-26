# ADR 0003 — Authentification, sessions et permissions

- Statut : accepté (Phase 2, 2026-09-26)
- Contexte : ARCHITECTURE.md sections F et G ; réponses O9 du 2026-09-26 (secrétaire : pas de chiffre d'affaires, pas d'annulation de paiement, gestion de l'agenda de tout praticien)

## Décisions

### Sessions serveur, pas de JWT
- **Jeton :** aléatoire de 256 bits, dans un cookie `httpOnly`, `SameSite=Lax`, `Secure` et préfixé `__Host-` hors développement. Seule son empreinte SHA-256 est stockée : une fuite de la base ne permet pas d'usurper une session.
- **Révocation immédiate** : déconnexion, changement de rôle, désactivation, réinitialisation du mot de passe ou de la double authentification, changement de mot de passe (autres sessions).
- **Expiration :** 60 min d'inactivité, 12 h au maximum, 5 min pour l'étape du code TOTP. Une session expirée est révoquée : elle ne peut pas revivre.
- **Renouvellement du jeton** à chaque élévation de privilège (code TOTP validé, double authentification activée, mot de passe changé) : protection contre la fixation de session.

### Mots de passe et verrouillage
- **Hachage :** Argon2id (m=19 Mio, t=2, p=1, recommandation OWASP).
- **Règles :** 12 à 128 caractères, sans règle de composition (recommandation NIST SP 800-63B) ; différent de l'e-mail et de l'ancien.
- **Verrouillage :** 15 minutes après 10 échecs consécutifs. Le compteur est persisté *avant* de renvoyer l'erreur (sinon l'annulation de la transaction l'effacerait).
- **Même message** pour un compte inconnu et un mauvais mot de passe, avec vérification d'une empreinte factice pour égaliser le temps de réponse.
- **Limite connue :** le verrouillage révèle qu'un compte existe, mais seulement après 10 essais sur cet e-mail, eux-mêmes limités par adresse IP.

### Double authentification (TOTP)
- **Obligatoire pour ADMIN et DENTIST** : la session reste restreinte à sa mise en place tant qu'elle n'est pas activée.
- **Secret** chiffré en AES-256-GCM avec une clé hors base (`DATA_ENCRYPTION_KEY`). Le contexte authentifié (AAD) lie le chiffré au compte : un secret copié vers un autre compte est illisible.
- **Anti-rejeu en deux couches, testées séparément :**
  1. otplib refuse un pas ≤ dernier pas accepté ;
  2. la mise à jour en base n'aboutit que si le pas est strictement supérieur (deux requêtes simultanées ne peuvent pas réussir avec le même code).
- **Tentatives :** 5 codes faux ferment l'étape en cours.
- **Perte du téléphone :** un administrateur réinitialise, ou la commande `pnpm admin:reset-mfa` si c'est le seul administrateur.

### Étapes d'authentification restantes
Une session porte au plus une restriction, par priorité : `MFA_PENDING`, `PASSWORD_CHANGE_REQUIRED`, `MFA_ENROLLMENT_REQUIRED`. Chaque route déclare les étapes qu'elle tolère ; par défaut, aucune. Pendant une étape, `/api/auth/me` renvoie une liste de permissions vide.

### CSRF
- Cookie `SameSite=Lax`.
- **Jeton de synchronisation** par session, dans l'en-tête `x-csrf-token`, exigé pour toute requête modifiante authentifiée ; comparaison à temps constant.
- **Vérification de l'en-tête `Origin`** sur toute requête modifiante, connexion comprise (contre la connexion forcée d'une victime au compte d'un attaquant).

### Permissions : catalogue et matrice dans le code
**Écart par rapport au plan** (tables `roles`, `permissions`, `role_permissions`). Le catalogue et la matrice des rôles système sont définis dans `packages/shared/src/permissions.ts`, et l'appartenance au cabinet porte le rôle.

Raisons :
- **une seule source de vérité**, partagée par le serveur et l'interface, sans synchronisation code/base ;
- **test exhaustif** (17 permissions × 3 rôles) contre une matrice écrite indépendamment ;
- **les rôles personnalisés par cabinet ne sont pas demandés au MVP.**

S'ils le deviennent, des tables seront ajoutées par migration, et le catalogue du code restera la liste des permissions possibles.

Contrôle en deux points :
- la route déclare la permission (refus 403 immédiat) ;
- le service appelle `authorize()`, pour que les autres appelants (tâches de fond, futurs points d'entrée) soient couverts.

### Isolation des tables d'authentification sans fonction `SECURITY DEFINER`
`users` est commune à la plateforme, et la connexion a lieu avant de connaître le cabinet. Plutôt que des fonctions privilégiées, trois variables de contexte supplémentaires, sur le modèle de `app.clinic_id`, ouvrent chacune une fenêtre minimale :

| Variable | Ce qu'elle rend visible |
|---|---|
| `app.auth_email` | le seul compte de cet e-mail |
| `app.user_id` | ses propres appartenances, hors contexte cabinet |
| `app.session_token_hash` | la seule session de ce jeton |

Sans variable, rien n'est visible. `email` et `status` de `users` ne sont pas modifiables par l'application (droits par colonne).

### Limitation du nombre de requêtes
- 300 requêtes par minute et par IP sur tout le serveur ; 10 par minute sur la connexion, le code TOTP et le mot de passe.
- Le stockage est en mémoire, donc propre à chaque instance : suffisant pour une seule instance d'API. Plusieurs instances exigeront un stockage partagé (Phase 13).

## Conséquences et limites connues
- **Plusieurs cabinets :**
  - un administrateur d'un cabinet A peut réinitialiser le mot de passe ou la double authentification d'un compte également membre d'un cabinet B, car ces éléments sont communs à la plateforme ;
  - le changement de mot de passe ne ferme que les sessions du cabinet courant.

  Sans effet pour un cabinet unique ; à revoir avant l'ouverture multi-cabinets (réinitialisations réservées à la plateforme).
- **Choix du cabinet :** un compte membre de plusieurs cabinets doit fournir `clinicId` à la connexion. Aucune interface de choix n'existe encore.
- **Compte déjà existant :** créer un compte avec un e-mail existant renvoie une erreur de conflit, ce qui révèle l'existence de l'adresse sur la plateforme (sensibilité faible, accepté).
- **Perte de `DATA_ENCRYPTION_KEY` :** elle rend illisibles tous les secrets TOTP. Il faudrait alors réinitialiser la double authentification de tous les comptes. La clé doit être sauvegardée dans le gestionnaire de secrets.
