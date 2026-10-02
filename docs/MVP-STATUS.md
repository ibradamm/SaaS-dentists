# État du MVP

- **Version :** `v0.1.0-mvp` (tag Git), 2026-10-02.
- **Statut :** MVP technique terminé, produit gelé. **Aucun déploiement**, aucune donnée réelle, aucune dépense.

### TERMINÉ

Chaque point est couvert par des tests automatiques exécutés en CI (unitaires, intégration sur PostgreSQL réel, parcours Playwright sur le build de production).

- **Comptes et accès :**
  - rôles administrateur, dentiste, secrétaire ;
  - double authentification TOTP (administrateur, dentiste) ;
  - verrouillage après échecs ;
  - sessions révocables.
- **Isolation entre cabinets :**
  - RLS forcée sur toutes les tables, en plus du filtre explicite `clinic_id` ;
  - toutes les routes vérifiées automatiquement (matrice de sécurité, test inter-cabinets).
- **Patients :**
  - fiche, contacts, archivage ;
  - recherche, y compris les noms en arabe et en tifinagh ;
  - homonymes signalés avant création ;
  - import CSV ou Excel annulable.
- **Notes médicales :** chiffrées, lecture tracée. Accès :
  - dentiste : oui ;
  - administrateur : seulement s'il est lui-même praticien actif du cabinet (E18) ;
  - secrétaire : jamais.
- **Recherches hors de l'adresse (E19) :** le texte cherché (nom, téléphone, date de naissance) n'apparaît dans aucune adresse ni aucun journal.
- **Cabinet :**
  - praticiens et types de rendez-vous ;
  - horaires datés, absences, blocages ;
  - fuseau du cabinet, y compris l'heure légale marocaine (données 2026c, Node 22.23.3).
- **Agenda :**
  - vues jour et semaine, créneaux libres ;
  - double réservation impossible, y compris en base ;
  - dérogations confirmées et tracées ;
  - création rejouable sans doublon.
- **Paiements :**
  - actes, encaissements partiels, restant dû ;
  - annulations motivées ;
  - liste « À encaisser », revenus ;
  - montants en centimes, aucune modification ni suppression, création rejouable sans doublon.
- **Tableau de bord et statistiques :** activité, occupation, absences, patients, revenus, selon les permissions.
- **Journal d'audit** consultable par l'administrateur, sans contenu saisi.
- **Journaux applicatifs** sans aucune donnée saisie (contrôle automatique en fin de parcours).
- **Fin de contrat :**
  - export de restitution ;
  - suspension ;
  - conservation pour litige ;
  - purge sur instruction (simulation par défaut) ;
  - revue de conservation sans suppression.
- **Purges techniques :** sessions terminées après 30 jours, brouillons d'import après 24 heures. Elles sont suspendues pour un cabinet sous conservation pour litige.
- **Livraison :**
  - images Docker de production (versions épinglées) ;
  - pile staging locale en HTTPS, exécutée en CI ;
  - configuration Railway prête (`.railway/railway.ts`).

### HORS MVP

Repoussé volontairement ; aucun de ces points n'est un bug connu.

| Point | Résumé | Détail |
|---|---|---|
| E9 | Clé d'identité des lignes d'un import validé conservée sans limite | `docs/conformite/decisions-a-prendre.md` |
| E10 | Effacement d'une fiche sur demande du patient (aujourd'hui : archivage seulement) | idem, attend aussi l'avis juridique |
| E11 | Export des données d'un seul patient (droit d'accès) | idem |
| E12 | Chiffrement des textes libres hors notes médicales | idem |
| E13 | Adresse IP des postes dans les journaux de l'API | idem |
| E14 | Commandes d'exploitation tracées dans le journal du cabinet | idem |
| E15 | Notice d'information du personnel ; durée des comptes désactivés | idem |
| E17 | Procédure écrite d'incident (violation de données) | idem, à écrire avant la production |

Extensions non commencées :
- WhatsApp, agent IA, Google Calendar (`docs/future/`) ;
- paiement en ligne (Stripe) ;
- reçus et factures ;
- exports CSV supplémentaires ;
- nouvelles statistiques ;
- refonte graphique.

### BLOQUÉ EXTERNEMENT

| Blocage | Ce qui manque | Référence |
|---|---|---|
| Validation juridique | Avis d'un juriste marocain sur 10 questions ; formalités CNDP de chaque cabinet ; contrat et notice signés et validés | `docs/conformite/dossier-juriste.md` |
| Choix de l'hébergeur | Railway (Pays-Bas, prêt) ou hébergeur au Maroc ; dépend de l'avis juridique sur le transfert | `docs/conformite/hebergement-maroc.md` |
| Staging réel | Jamais déployé | `docs/operations/deploiement-staging.md` |
| Sentry réel | Code prêt et testé sans réseau ; jamais vérifié avec un vrai projet Sentry | `sentry:check` |
| Sauvegarde et restauration hébergées | Restauration testée en local et en CI, jamais chez un hébergeur | `docs/operations/sauvegarde-restauration.md` |
| Budget | Aucun accordé (staging Railway estimé à 5 à 7 $ par mois) | ADR 0013 |

### COMMENT DÉPLOYER PLUS TARD

1. Faire lever les blocages juridiques :
   - avis du juriste ;
   - formalité CNDP de chaque cabinet ;
   - contrat signé, notice affichée ;
   - procédure d'incident écrite (E17).
2. Choisir l'hébergeur et accorder le budget.
3. Staging, en suivant `docs/operations/deploiement-staging.md` :
   1. projet, secrets et clé de chiffrement **sauvegardée hors de l'hébergeur** (`docs/operations/cle-de-chiffrement.md`) ;
   2. déploiement du tag `v0.1.0-mvp` ;
   3. cabinet fictif (`Africa/Casablanca`, `MAD`).
4. Vérifier sur le staging, dans l'ordre :
   1. `check:deployment` (HTTPS, en-têtes, CORS, cookies, adresse du client, limitation) ;
   2. `staging:timings` ;
   3. `APP_ENV=staging pnpm --filter @dental/server sentry:check` ;
   4. une restauration de sauvegarde ;
   5. la fin de contrat complète avec un cabinet fictif.
5. Production : même procédure, dans un projet distinct, avec de nouveaux secrets.
6. Créer les vrais cabinets : `admin:create-clinic`, puis `admin:create-admin`.

### COMMENT RELANCER LE DÉVELOPPEMENT

```bash
git checkout v0.1.0-mvp            # ou la branche de travail
nvm use                            # Node 22.23.3 (.nvmrc), obligatoire pour l'heure marocaine
corepack enable && pnpm install
pnpm setup:env                     # crée .env et une clé de chiffrement locale
pnpm dev:db                        # PostgreSQL local (ou docker compose -f infra/docker-compose.yml up -d)
pnpm db:bootstrap && pnpm db:migrate && pnpm db:seed
pnpm dev:api                       # trois terminaux : API, worker, interface
pnpm dev:worker
pnpm dev:web                       # http://127.0.0.1:5173

# Vérification complète (identique à la CI), puis les parcours de bout en bout
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm check:bundle
pnpm e2e
```

Règles de contribution : `CLAUDE.md` ; architecture : `docs/ARCHITECTURE.md`.
