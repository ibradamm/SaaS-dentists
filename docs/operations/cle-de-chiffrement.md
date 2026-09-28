# Clé de chiffrement des données sensibles (`DATA_ENCRYPTION_KEY`)

## Ce qu'elle protège

La clé chiffre en AES-256-GCM, dans la base :
- les notes médicales (`patient_medical_notes.content_enc`) ;
- les secrets de double authentification (`users.mfa_secret_enc`).

Chaque valeur chiffrée est liée à sa ligne : une valeur copiée vers une autre ligne ne se déchiffre pas.

**Sans la clé, ces données sont perdues.** Une sauvegarde PostgreSQL seule ne suffit pas à les restaurer, et c'est voulu : un vol de la base, ou d'une sauvegarde, ne livre pas les notes médicales.

## Règles

| Règle | Vérification |
|---|---|
| Jamais dans Git, jamais dans un fichier versionné, jamais dans les journaux | gitleaks (index, dépôt, historique) en CI. Le contrôle final des parcours de bout en bout cherche la clé de l'exécution dans les journaux de l'API et du worker |
| Variable secrète du gestionnaire de l'hébergeur (`DATA_ENCRYPTION_KEY`), une par environnement | Staging et production ont des clés différentes : une clé de staging ne déchiffre rien de la production |
| Sauvegardée hors de PostgreSQL, dans un coffre distinct de celui des sauvegardes de la base | Le test `10-backup-restore` vérifie que la sauvegarde (`pg_dump`) ne contient pas la clé |
| 32 octets aléatoires, en base64 | L'API et le worker refusent de démarrer avec une clé d'une autre taille (`env.test.ts`) |

## Génération (une fois par environnement)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Sur un poste de confiance :
1. Copier la valeur directement dans le gestionnaire de secrets de l'hébergeur.
2. La copier aussi dans le coffre de sauvegarde, par exemple un gestionnaire de mots de passe d'équipe avec deux personnes habilitées.
3. Ne jamais l'écrire ailleurs (terminal partagé, messagerie, ticket).

Noter l'**empreinte** de la clé, qui ne révèle pas la clé :

```bash
printf %s "$DATA_ENCRYPTION_KEY" | sha256sum | cut -c1-16
```

Consigner l'empreinte avec la date de création dans le registre d'exploitation.

## Restauration (procédure testée)

Scénario : la base est restaurée depuis une sauvegarde (incident, retour à un instant donné, changement d'hébergeur).

1. Restaurer la base (procédure de l'hébergeur ; la sauvegarde PostgreSQL ne contient pas la clé).
2. Récupérer la clé dans le coffre de sauvegarde.
3. Vérifier son empreinte avec le registre.
4. La placer dans `DATA_ENCRYPTION_KEY` du nouvel environnement.
5. Démarrer l'API et le worker.
6. Contrôler, avec un compte de test :
   - l'ouverture d'une note médicale de test ;
   - une connexion avec double authentification.

Ce scénario est vérifié à chaque exécution des parcours de bout en bout, sur la pile locale seulement : `e2e/tests/10-backup-restore.spec.ts`.
- **Clé conservée :** une note médicale créée par l'application, lue dans une base restaurée depuis `pg_dump`, se déchiffre avec la clé conservée à part.
- **Autre clé :** le déchiffrement échoue. Le chiffrement est authentifié : aucune donnée n'est rendue fausse en silence.

**Reste à faire en Phase 11 :** le même exercice sur l'hébergement réel, avec la clé tirée du coffre de sauvegarde et non de l'environnement de test.

## Perte de la clé

Les notes médicales et les secrets de double authentification deviennent illisibles. Il n'existe aucune récupération.
- **Double authentification :** l'administrateur la réinitialise pour chaque compte (`pnpm admin:reset-mfa`, ou la page « Utilisateurs »).
- **Notes médicales :** elles sont perdues. C'est pourquoi la clé doit exister en deux exemplaires, dans deux lieux distincts.

## Fuite de la clé

1. Générer une nouvelle clé.
2. Rechiffrer les données.
3. Retirer l'ancienne clé.

**Limite actuelle :** l'application ne gère qu'une clé à la fois (format `v1`). Le rechiffrement demande une commande dédiée, encore à écrire :
- lire avec l'ancienne clé et réécrire avec la nouvelle, dans une transaction par cabinet ;
- ajouter un identifiant de clé au format.

Tant que cette commande n'existe pas, une fuite impose une intervention de développement. C'est un risque ouvert, consigné dans le rapport d'audit pré-production.
