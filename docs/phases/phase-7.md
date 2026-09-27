# Phase 7 — Paiements et revenus encaissés : rapport

Date : 2026-09-27. Statut : **code et tests locaux terminés** ; résultat de la CI GitHub consigné dans le résumé de fin de phase. En attente de validation avant la Phase 8.

**Décisions du porteur du projet (validation de la Phase 6) :**
- le chiffre d'affaires correspond aux sommes réellement encaissées ;
- le montant prévu ou dû se distingue du montant réellement payé ;
- les paiements partiels sont possibles ;
- le restant à payer est visible ;
- pas de dépenses au MVP.

L'analyse (modèle, statuts, invariants, permissions, parcours) est l'ADR 0009.

## Livré

| Élément | Emplacement |
|---|---|
| Analyse : deux objets (montant dû, encaissement), statuts enregistrés et calculés, invariants F1 à F8, date d'encaissement, permissions, revenus, parcours, options écartées | `docs/adr/0009-paiements-et-revenus.md` |
| **Montants en centimes entiers** : saisie en texte (« 45,50 », « 1 234,56 ») convertie sur la chaîne, affichage par chaîne décimale exacte, plafond de 1 000 000 € ; aucun nombre à virgule du navigateur à la base | `packages/shared/src/money.ts` |
| Contrats partagés : compte du patient, montant dû, paiement, annulations motivées, « À encaisser », revenus et journal | `packages/shared/src/finance.ts` |
| Tables `charges` et `payments` : clés composites (même cabinet, même patient, rendez-vous du même patient), contraintes de montant, de devise et de cohérence des annulations | `db/schema/finance.ts`, migration 0013 |
| **Garanties en base** : RLS forcée ; droits par colonne (seules les colonnes d'annulation sont modifiables, aucune suppression) ; déclencheurs qui n'autorisent que `OPEN → CANCELLED` et `RECORDED → VOIDED` ; verrou du montant dû puis contrôle « payé ≤ dû » à chaque encaissement | migration 0014 |
| Service : compte, acte avec paiement immédiat facultatif (une transaction), encaissement, annulations, « À encaisser », revenus (jours du cabinet), journal ; clé d'idempotence par saisie ; audit sans texte libre | `modules/finance/finance.service.ts` |
| API : 8 routes, permission déclarée et vérifiée dans le service | `api/routes/finance.ts` |
| Annulation d'import : un patient qui a un acte ou un paiement est conservé | `modules/imports/imports.service.ts` |
| **Fiche patient, section « Paiements »** : dû, payé, restant dû ; actes avec leur état (à payer, partiellement payé, payé, annulé) ; historique des paiements (moyen, référence, date et heure du cabinet, auteur) ; « Nouvel acte à encaisser » avec paiement immédiat partiel ou total ; « Encaisser » sur un acte (restant proposé) ; annulations avec motif pour le dentiste et l'administrateur ; « Restant dû » dans le résumé en tête | `pages/finance/PatientAccount.tsx`, `pages/patients/PatientSummary.tsx` |
| **Depuis l'agenda** : « Encaisser » dans la fiche d'un rendez-vous ouvre le formulaire prérempli (rendez-vous, libellé, praticien) ; un acte déjà ouvert pour ce rendez-vous est signalé | `pages/agenda/AppointmentDetails.tsx` |
| **« À encaisser »** : patients qui doivent de l'argent, du plus ancien acte ouvert au plus récent, et total du cabinet | `pages/finance/ReceivablesPage.tsx` |
| **« Revenus »** (dentiste, administrateur) : aujourd'hui, 7 derniers jours, ce mois-ci, mois précédent ou période libre (un an au plus) ; total encaissé, restant dû du cabinet, paiements annulés à part ; répartition par moyen, par praticien, par jour ; journal des encaissements | `pages/finance/RevenuePage.tsx` |

### Permissions appliquées

| | Administrateur | Dentiste | Secrétaire |
|---|---|---|---|
| Voir le compte d'un patient, « À encaisser » | oui | oui | oui |
| Saisir un acte, encaisser (y compris partiellement) | oui | oui | oui |
| Annuler un paiement ou un acte | oui | oui | **non** (403) |
| Revenus et journal des encaissements | oui | oui | **non** (403) |

Chaque refus est vérifié côté serveur (tests HTTP et appels directs depuis Chromium) ; l'interface ne fait que masquer.

## Vérifications exécutées

Environnement : Node 22.22, PostgreSQL 16 local, Chromium 1194.

| Vérification | Résultat |
|---|---|
| Formatage, lint, typage | OK |
| Tests `packages/shared` | 73/73 |
| Tests `apps/server` : unitaires | 81/81 |
| Tests `apps/server` : intégration (base jetable, rôle applicatif réel) | 231/231 |
| Tests `apps/web` | 104/104 |
| Tests par mutation (voir ci-dessous) | 21 failles introduites, 21 détectées |
| Parcours réels dans Chromium, version de production, ordinateur, tablette et téléphone, deux cabinets | OK |
| Build, dérive schéma/migrations, `pnpm audit --prod` | OK ; aucune dérive ; aucune vulnérabilité connue |
| Budget du chargement initial (`pnpm check:bundle`) | 143 ko compressés pour un budget de 160 ko (142 ko en Phase 6) ; les pages de finances sont chargées à la demande |

### Concurrence et doubles soumissions

| Cas | Niveau | Résultat |
|---|---|---|
| Deux encaissements simultanés qui dépasseraient le dû | Base (deux connexions réelles), service, navigateur (secrétaire et dentiste sur le même acte) | Le second attend le verrou puis est refusé ; jamais plus payé que dû |
| Annulation d'un acte et encaissement simultanés, dans les deux ordres | Base | Le second attend puis est refusé (acte déjà payé, ou acte annulé) ; jamais un acte annulé portant un paiement valide |
| Double envoi de la même saisie (même clé) | Service, HTTP (201 puis 200, même identifiant), navigateur (double clic) | Un seul acte, un seul paiement |
| Même saisie pour **tout** le restant, premier envoi pas encore validé | Service (transaction tenue ouverte, déterministe) | Le second attend le verrou, trouve le paiement du premier et le renvoie (200), sans faux « dépasse le restant dû » |
| Même clé sur deux actes différents au même instant | Service (déterministe) | Refus 409, jamais d'erreur 500 |
| Réponse perdue : le serveur enregistre, le navigateur ne reçoit rien, l'utilisatrice réessaie | Interface (tests), navigateur (réponse coupée) | Même clé renvoyée, saisie existante retournée, aucun doublon |
| Même clé, contenu différent | Service, HTTP | Refus 409, rien n'est modifié |
| Double annulation du même paiement | Service, navigateur | Une seule annulation ; la seconde reçoit 409 |

### Tests par mutation

Chaque faille a été introduite seule, les tests concernés rejoués, puis le fichier restauré (script hors dépôt).

| # | Faille introduite | Détectée par |
|---|---|---|
| F1 | Base : montant dû non verrouillé avant le calcul du restant | Tests de concurrence en base (3) |
| F2 | Base : plus de contrôle « payé ≤ dû » | Base, service (concurrence) |
| F3 | Base : montant d'un paiement modifiable (droit de colonne) | Base |
| F4 | Base : paiement annulé remis en « encaissé » | Base |
| F5 | Base : acte payé annulable | Base, service |
| F6 | Service : insertion sans `ON CONFLICT` (idempotence) | Service (même clé sur deux actes au même instant) |
| F7 | Permissions : la secrétaire peut annuler un paiement | Matrice des permissions, service, HTTP |
| F8 | Service : annulation vérifiée avec le droit de saisie | Service, HTTP |
| F9 | Service : revenus comptant les paiements annulés | Service, HTTP |
| F10 | Service : jours des revenus dans le fuseau du serveur | Service |
| F11 | Service : libellé recopié dans l'audit | Service |
| F12 | Import : annulation d'import sans tenir compte des actes | Service |
| F13 | Montants : conversion par nombre à virgule (1,15 → 114) | Tests des montants |
| F14 | Interface : nouvelle clé à chaque envoi | Interface (double clic, réponse perdue) |
| F15 | Interface : nouvelle clé après une issue incertaine | Interface |
| F16 | Interface : annulation proposée à la secrétaire | Interface |
| F17 | Interface : moyen de paiement choisi d'office | Interface |
| F18 | Interface : dépassement du restant dû non signalé | Interface |
| F19 | Interface : restant dû absent du résumé de la fiche | Interface |
| F20 | Interface : page « Revenus » ouverte à `payment.read` | Interface |
| F21 | Service : montant dû non verrouillé avant la recherche de la clé | Service (même saisie, premier envoi pas encore validé) |

### Parcours réels dans Chromium

Conditions :
- version de production (`vite build` puis `vite preview`), navigateur réglé sur New York, cabinets à Paris ;
- dimanche 27 septembre, vers 16 h 45 à Paris ;
- deux cabinets de démonstration, A et B.

1. **Secrétaire (tablette 820 × 1180) :**
   - menu : « À encaisser », pas de « Revenus » ;
   - agenda → rendez-vous de 10 h → « Encaisser » → fiche patient, formulaire ouvert : rendez-vous « 27/09/2026 à 10:00 · Consultation · Dr Démo » présélectionné, libellé « Consultation », focus sur le montant ;
   - acte de 60 € avec 20 € en espèces, **validé par un double clic** : un acte, un paiement ; totaux 60 / 20 / 40 ; résumé en tête « Restant dû 40,00 € » ;
   - « Encaisser » propose 40,00 ; 45 est refusé avant l'envoi ; 15,50 en carte ;
   - **réponse coupée** après enregistrement par le serveur : message « Vérifiez votre connexion », nouvel essai → « Paiement de 15,50 € encaissé », deux paiements au total (pas trois) ;
   - heures affichées en heure de Paris (16:44) sur un poste réglé sur New York ;
   - aucune annulation proposée ; appels directs (annuler un paiement, annuler un acte, revenus, journal) : 403 ;
   - « À encaisser » : DURAND Alice, 24,50 €, « 1 acte ouvert · depuis le 27/09/2026 ».
2. **Secrétaire et dentiste encaissent le restant (24,50 €) au même instant :** un seul accepté ; l'autre voit « Le montant dépasse le restant dû de cet acte (0,00 €) » ; restant 0.
3. **Dentiste (ordinateur) :**
   - annule le paiement de 15,50 € : motif exigé ; paiement barré avec « Annulé le … par Démo dentiste — motif : … » ; restant dû recalculé (15,50 €) ; une seconde annulation par l'API reçoit 409 ;
   - nouvel acte sans rendez-vous : « Détartrage » à 1 234,56 € payé par chèque (référence « CHQ 0042 »), praticien choisi ; puis « Radio panoramique » à 0,29 € sans paiement, annulé avec motif ; l'acte payé n'offre pas d'annulation ; montants stockés : 123456 et 29 centimes ;
   - « Revenus », ce mois-ci : 1 279,06 € (3 paiements), restant dû du cabinet 15,50 €, paiements annulés 15,50 € (1, non comptés) ; par moyen chèque 1 259,06 €, espèces 20,00 € ; journal avec le paiement annulé barré ; « Aujourd'hui » ; période inversée refusée avec un message.
4. **Téléphone (390 × 844) :** aucun débordement horizontal sur « Revenus », « À encaisser » et les deux fiches patients.
5. **Cabinet B :** « À encaisser » vide ; compte et encaissement sur les données du cabinet A : 404 ; annulation : 403 (droit vérifié avant toute lecture, rien n'est révélé).
6. **Audit du cabinet A (lu en base) :** 3 `charge.created`, 4 `payment.recorded`, 1 `payment.voided`, 1 `charge.cancelled`, soit exactement les saisies réelles malgré le double clic, la réponse perdue et la concurrence ; aucun libellé, référence ni motif en clair.

## Défauts trouvés et corrigés pendant la phase

1. **Migration 0013 refusée** : la clé étrangère composite vers `appointments` précédait la contrainte d'unicité qu'elle référence. Ordre corrigé dans la migration (non encore appliquée ailleurs qu'en local).
2. **Test HTTP erroné** : il attendait 409 pour l'annulation d'un acte d'un autre cabinet ; 404 est la bonne réponse (aucune divulgation). Test corrigé.
3. **Espaces insécables écrits en clair** dans une expression régulière de `money.ts` (lint `no-irregular-whitespace`) : remplacés par leurs échappements.
4. **Test manquant** : la concurrence entre annulation d'un acte et encaissement n'était pas couverte. Ajoutée dans les deux ordres ; la mutation F1 la fait échouer.
5. **Double envoi simultané pour la totalité du restant dû : refus à tort** (trouvé par la CI, test HTTP, alors qu'il passait en local).
   - Le second envoi ne voyait pas encore le paiement du premier, puis le déclencheur, qui s'exécute avant la détection du conflit de clé, le refusait comme dépassement : 409 « dépasse le restant dû » au lieu de 200. Aucun doublon en base, mais une erreur affichée à tort.
   - Correction : le service verrouille le montant dû avant de chercher la clé d'idempotence ; le second envoi attend le premier, trouve sa saisie et la renvoie.
   - Test déterministe ajouté (transaction tenue ouverte), vérifié en échec sur l'ancien code ; test HTTP rejoué 15 fois sans échec ; mutation F21.
6. **Avertissement de troncature du journal** calculé par comparaison de deux requêtes distinctes (faux positif possible si un paiement arrive entre les deux) : remplacé par une limite partagée (`MAX_JOURNAL_PAYMENTS`).

## Écarts par rapport au plan

1. **Pas de dépenses** (décision du porteur du projet) : la table `expenses` prévue en v2 n'est pas créée.
2. **Pas de tarif par type de rendez-vous** : le montant de l'acte se saisit à chaque fois. Un tarif par défaut serait un ajout simple si le besoin se confirme.

## Limites connues

- **Revenus d'une période passée :** calculés à la consultation. L'annulation ultérieure d'un paiement les réduit (ADR 0009, section 7 ter). Pas de clôture de période.
- **Correction d'un montant dû déjà payé :** annuler ses paiements, puis l'acte, puis ressaisir. C'est le prix de l'absence de modification silencieuse.
- **Date d'encaissement :** l'instant de la saisie ; un chèque reçu la veille compte le jour de la saisie.
- **Journal :** 1 000 paiements affichés au plus par période (les totaux portent sur toute la période) ; « À encaisser » : 500 patients au plus.
- **Hors périmètre :** remboursements, remises, factures et reçus, TVA, tiers payant, ventilation d'un paiement sur plusieurs actes, plusieurs devises.
- **Champs date :** leur format suit la langue du navigateur (limite déjà notée en Phase 6).
- **Parcours Chromium :** toujours exécutés depuis un script hors dépôt (automatisation en Phase 10).

## Questions ouvertes

1. **Revenus visibles par le dentiste :** tout le cabinet, ventilé par praticien (choix actuel), ou seulement les siens ?
2. **Annulation d'un acte par la secrétaire :** refusée aujourd'hui, comme l'annulation d'un paiement (`payment.void`). À confirmer.
3. **Clôture de période** (revenus figés d'un mois passé) : à prévoir ou non.
4. **Reçu remis au patient** : à prévoir ou non (hors périmètre de cette phase).
