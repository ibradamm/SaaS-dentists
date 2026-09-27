# Extensions futures (hors périmètre actuel)

Le périmètre actuel est le SaaS de gestion du cabinet, utilisé par le personnel (ADR 0004). Les extensions ci-dessous sont conçues mais **non développées**. Leur conception détaillée est archivée dans [`architecture-v1-whatsapp-agent.md`](architecture-v1-whatsapp-agent.md).

| Extension | Conception de référence (document archivé) | Prérequis à ajouter le moment venu |
|---|---|---|
| Messagerie WhatsApp avec les patients | Sections G (flux), H.2 (reprise par la secrétaire), D (tables `conversations`, `messages`, `handoffs`, `messaging_channels`, `whatsapp_templates`, `webhook_events`), L à N (Meta : politique, tarifs, risques) | Modèle de consentement par canal ; permissions `conversation.read` et `conversation.reply` ; port `MessagingPort` ; webhook signé ; vérification juridique (données de santé) |
| Agent IA de prise de rendez-vous | Sections E (pipeline), F (outils), D (`agent_runs`, `agent_tool_calls`, `clinic_knowledge`), N.2 (coûts) | Principal `AGENT` avec permissions propres ; créneaux « réservés en attente » (statut `HELD`) ; suite d'évaluation |
| Google Calendar (copie de l'agenda) | Section H.3 (synchronisation, conflits, compte propriétaire du cabinet) | Port `CalendarPort` ; tables `calendar_connections`, `calendar_event_links` |
| Rappels aux patients (SMS, e-mail, WhatsApp) | Section G.4 | Modèle de consentement ; fournisseur d'envoi ; table `notifications` |
| Portail patient | Section I (rôle PATIENT prévu) | Principal patient distinct du personnel |
| Export CSV des statistiques et des revenus (demandé le 2026-09-27, après la Phase 8) | ADR 0010 : les agrégats et le journal des encaissements sont déjà calculés par le serveur, période et praticien compris | Route d'export (texte CSV, séparateur « ; », encodage UTF-8 avec BOM pour les tableurs), mêmes permissions que l'écran ; export tracé dans l'audit ; neutralisation des formules (cellules commençant par `=`, `+`, `-`, `@`) |
| Reçu patient (demandé le 2026-09-27, après la Phase 7) | ADR 0009 : chaque paiement porte déjà montant, moyen, instant d'encaissement, auteur, patient et acte | Numérotation continue par cabinet, sans trou (table de séquences verrouillée) ; document non modifiable produit par le worker (outbox) ; mentions obligatoires selon le pays (question L1) ; reçu d'annulation si le paiement est annulé ; permission de réimpression |

## Fondations conservées dans le code

Elles ne contiennent aucune fonctionnalité WhatsApp, mais évitent toute refonte le jour où une extension est ajoutée :

- **File de tâches pg-boss et outbox transactionnelle** (`apps/server/src/jobs/queue.ts`, `enqueue`) et **processus worker**. Tout envoi externe sera enfilé dans la transaction métier, puis rejoué en cas de panne.
- **Contrôle d'autorisation dans les services** (`authorize`) et **contexte cabinet utilisable hors HTTP** (`withTenant`). Un webhook ou un agent passera par les mêmes règles que l'interface.
- **Types d'acteur d'audit `USER`, `AGENT`, `SYSTEM`**, qui permettent déjà de tracer un acteur automatisé.
- **Contacts patients au format international E.164**, indexés par cabinet et numéro : base d'une identification par numéro de téléphone.
- **Chiffrement applicatif** (`secret-box`), réutilisable pour des identifiants d'intégration.
