# ADR 0004 — Recentrage du périmètre sur le SaaS de gestion du cabinet

- Statut : accepté (2026-09-27), décision du porteur du projet
- Remplace : le périmètre de l'architecture v1 (archivée dans `docs/future/`)

## Décision

Le produit est construit d'abord comme un **SaaS de gestion de cabinet dentaire, indépendant et complet**, utilisé par le dentiste et la secrétaire.

**Retiré du développement :** WhatsApp (webhooks, intégration Meta, messages, modèles de messages), l'agent conversationnel IA, et Google Calendar, absent de la liste des priorités.

## Changements appliqués (2026-09-27)

| Élément | Traitement |
|---|---|
| Permissions `conversation.read` et `conversation.reply` | Supprimées du catalogue ; matrice et tests mis à jour (17 permissions, dont `data.import`) |
| Consentement WhatsApp sur les contacts patients (colonne, contrat, audits) | Supprimé avant tout commit ; migrations 0006 à 0008 régénérées (jamais poussées) |
| Source de création de patient `AGENT` | Supprimée (`STAFF`, `IMPORT`) |
| Placeholders `.env.example` (Anthropic, WhatsApp, Google) et commentaires | Supprimés ou reformulés |
| Conception WhatsApp, agent et Google Calendar | Archivée sans modification dans `docs/future/architecture-v1-whatsapp-agent.md` |
| Type d'acteur d'audit `AGENT` (migration 0001, déjà appliquée) | Conservé : migration immuable, et désignation générique d'un acteur automatisé |
| File de tâches, outbox, worker, `authorize`, `withTenant`, contacts E.164, chiffrement | Conservés comme fondations (`docs/future/README.md`) |

## Vérification
- Aucune route, aucun écran et aucun test commité n'utilisaient les éléments supprimés.
- Après le retrait : typage, lint, 230 tests et builds verts.
- La base locale a dû être recréée, car elle contenait les anciennes versions des migrations 0006 à 0008. L'exécuteur strict a refusé de l'utiliser en l'état, comme prévu par l'ADR 0002.

## Conséquences
- Les invariants liés à l'agent disparaissent : réservation en deux temps avec confirmation du patient, interdiction pour l'agent d'inventer un créneau. Les rendez-vous sont créés par le personnel, sans statut « en attente » (`HELD`).
- **Ordre des phases :** voir ARCHITECTURE.md, section H.
- **Réintroduire une extension** demande :
  - une nouvelle décision ;
  - les prérequis listés dans `docs/future/README.md` ;
  - une vérification juridique pour la messagerie avec les patients (données de santé).
