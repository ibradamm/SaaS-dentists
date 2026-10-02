# ADR 0009 — Paiements et revenus encaissés

- Statut : accepté (2026-09-27), mis en œuvre en Phase 7
- **Décisions du porteur du projet :**
  1. le chiffre d'affaires correspond aux sommes réellement encaissées ;
  2. le montant prévu ou dû se distingue du montant réellement payé ;
  3. les paiements partiels sont possibles ;
  4. le restant à payer est visible ;
  5. pas de dépenses au MVP.
- **Fondations :**
  - permissions `payment.read`, `payment.write`, `payment.void`, `finance.reports.read` (ADR 0003, réponses O9 : la secrétaire n'annule pas de paiement et ne voit pas le chiffre d'affaires) ;
  - isolation (ADR 0001), audit, fuseau du cabinet (ADR 0006).

## 1. Modèle

Deux notions distinctes, deux tables :

| Table | Rôle | Exemple |
|---|---|---|
| `charges` — **montant dû** (« acte à encaisser ») | Ce que le patient doit, pour un acte, un rendez-vous ou un devis accepté. Lié au patient ; en option à un rendez-vous et à un praticien | « Couronne céramique », 600 € |
| `payments` — **encaissement** | Somme réellement reçue, rattachée à **un** montant dû. Plusieurs paiements par montant dû : c'est le paiement partiel | 200 € en carte le 27/09, puis 400 € en chèque le 15/10 |

- **Pas de paiement « flottant » (sans montant dû).** Un acompte est un paiement partiel sur le montant dû prévu (le devis). Ainsi, le restant dû est le même partout :
  - par acte : montant dû − paiements valides ;
  - par patient : somme sur ses actes ouverts.
- **Un paiement ne couvre qu'un montant dû.** Un patient qui règle deux actes en une fois donne lieu à deux paiements. Étendre à la ventilation d'un paiement sur plusieurs actes est un ajout pur (table `payment_allocations`), sans refonte.

## 2. Statuts

| Objet | Statut enregistré | Statut calculé (jamais stocké, donc jamais incohérent) |
|---|---|---|
| Montant dû | `OPEN` (ouvert), `CANCELLED` (annulé) | À payer (rien de payé) ; Partiellement payé ; Payé (payé = dû) |
| Paiement | `RECORDED` (encaissé), `VOIDED` (annulé) | — |

## 3. Invariants et mécanismes

| # | Invariant | Garanti par |
|---|---|---|
| F1 | Montants entiers en centimes, strictement positifs, plafonnés (1 000 000 €) ; aucun nombre à virgule, du navigateur à la base | `integer` + `CHECK` en base ; schéma Zod `int()` ; saisie et affichage par chaînes de caractères (`packages/shared/src/money.ts`) |
| F2 | Paiement et montant dû du même patient, du même cabinet, dans la même devise | Clés étrangères composites `(clinic_id, charge_id, patient_id)` ; devise copiée du cabinet et vérifiée par déclencheur |
| F3 | **Jamais plus payé que dû** : somme des paiements valides d'un montant dû ≤ ce montant | **Base** : déclencheur à l'insertion, qui verrouille la ligne du montant dû (`FOR UPDATE`) puis recalcule la somme. Deux encaissements simultanés sont donc sérialisés |
| F4 | Pas de paiement sur un montant dû annulé ; pas d'annulation d'un montant dû qui a des paiements valides | Base : mêmes déclencheurs, même verrou |
| F5 | **Aucune modification silencieuse** : ni montant, ni patient, ni moyen de paiement, ni date ne changent après coup ; seules transitions possibles : `OPEN → CANCELLED` et `RECORDED → VOIDED`, avec motif obligatoire, définitives | Droits par colonne (aucun `UPDATE` sur les montants), aucun `DELETE`, déclencheurs qui refusent toute autre transition, contraintes de cohérence (motif, date et auteur présents ssi annulé) |
| F6 | **Pas de double enregistrement** (double clic, réseau qui renvoie la requête) | Clé d'idempotence fournie par le client pour chaque saisie, unique par cabinet en base ; une même clé renvoie le même objet, ou un refus si le contenu diffère. Le service verrouille le montant dû avant de chercher la clé : un second envoi simultané attend le premier et le renvoie |
| F7 | Isolation entre cabinets | `clinic_id`, RLS forcée, clés composites, filtre explicite (ADR 0001) |
| F8 | Trace de chaque action financière | Audit dans la même transaction : création, encaissement, annulation. Montants et identifiants enregistrés ; jamais le libellé, la référence ni le motif en clair |

**Corrections :**
- un montant dû erroné s'annule (s'il n'a pas de paiement valide) puis se ressaisit ;
- un paiement erroné s'annule puis se ressaisit ;
- tout reste visible dans l'historique, barré, avec l'auteur et la date.

Au MVP, l'annulation d'un paiement corrige une **erreur de saisie** : l'argent n'a jamais été reçu. Le remboursement d'une somme réellement reçue est une autre opération, hors périmètre (section 8).

## 4. Date d'encaissement

- La date d'un paiement est l'**instant de son enregistrement**, fixé par le serveur. Il n'y a pas de date saisie : impossible d'antidater un encaissement dans une période déjà consultée.
- Un chèque reçu la veille et saisi le lendemain compte le jour de la saisie.

## 5. Permissions

| Action | Permission | Rôles |
|---|---|---|
| Compte d'un patient (dû, payé, restant dû, historique) ; liste des patients qui doivent de l'argent | `payment.read` | Administrateur, dentiste, secrétaire |
| Créer un montant dû ; enregistrer un paiement | `payment.write` | Administrateur, dentiste, secrétaire |
| **Annuler** un paiement ou un montant dû | `payment.void` | Administrateur, dentiste |
| Revenus encaissés et journal des encaissements d'une période | `finance.reports.read` | Administrateur, dentiste |

- **Annulation d'un montant dû.** Elle réduit ce que doit le patient : elle demande le même niveau de confiance que l'annulation d'un paiement (`payment.void`). La secrétaire signale une erreur de saisie au dentiste.
- **Revenus du cabinet entier.** Le dentiste voit les revenus de tout le cabinet, ventilés par praticien, car la permission n'est pas limitée à son propre agenda. Une limitation « ses propres revenus » s'ajouterait comme pour les horaires (ADR 0006).
- Chaque contrôle est fait dans le service (`authorize`) ; la route déclare aussi la permission ; l'interface ne fait que masquer.

## 6. Revenus encaissés

- **Période** : dates locales du cabinet, converties par `local-time.ts`.
- **Revenus** : somme des paiements `RECORDED` dont l'instant d'enregistrement tombe dans la période.
- **Ventilations** :
  - par moyen de paiement (espèces, carte, chèque, virement, autre) ;
  - par praticien, celui du montant dû ; « sans praticien » sinon ;
  - par jour.
- **Transparence** : les paiements annulés de la période sont affichés à part (nombre et montant), jamais comptés.
- **Restant dû** : total des montants dus ouverts moins les paiements valides, à l'instant de la consultation.

## 7. Parcours

1. **Après un rendez-vous** : « Encaisser » depuis la fiche du rendez-vous, ou depuis la fiche patient. Le lien au rendez-vous, son praticien et le libellé (type de rendez-vous) sont préremplis ; le montant se saisit (les types de rendez-vous n'ont pas de tarif). La saisie du montant payé crée le montant dû et le paiement **dans une seule transaction**. Si le rendez-vous a déjà un acte ouvert, l'écran le signale : le complément s'encaisse sur cet acte plutôt que dans un second.
2. **Paiement partiel** : saisir moins que le dû. Le restant apparaît aussitôt ; « Encaisser » sur l'acte propose ensuite le restant.
3. **Acompte sur devis** : créer le montant dû du devis, encaisser une partie.
4. **Relance** : la liste « À encaisser » donne les patients qui doivent de l'argent, du plus ancien au plus récent.
5. **Revenus** (dentiste, administrateur) : période, total, ventilations, journal.

## 7 bis. Interface et double saisie (mis en œuvre en Phase 7)

- **Clé d'idempotence côté navigateur.** Chaque formulaire de saisie tire une clé (UUID v4) à l'ouverture et la garde tant que l'issue d'un envoi est inconnue (réseau coupé, réponse perdue, erreur 5xx) : un nouvel essai renvoie donc la saisie déjà enregistrée. La clé change après un succès, ou après un refus du serveur (4xx), où rien n'a été créé avec elle. Vérifié dans Chromium en coupant la réponse d'un encaissement déjà enregistré : le nouvel essai n'a pas créé de second paiement.
- **Aucun moyen de paiement par défaut** : un moyen erroné fausserait les revenus par moyen sans que personne ne le remarque.
- **Montants saisis en texte** (« 45,50 », « 1 234,56 ») et convertis en centimes sur la chaîne ; le dépassement du restant dû est signalé avant l'envoi, la base reste juge.
- **Dates et heures** affichées dans le fuseau du cabinet, quel que soit celui du poste.
- **Annulations** : motif obligatoire (3 caractères au moins) ; l'élément annulé reste visible, barré, avec auteur, date et motif.

## 7 ter. Conséquences à connaître

- **Revenus d'une période passée.** Ils sont calculés à la consultation : si un paiement de septembre est annulé en octobre, les revenus de septembre baissent d'autant, et l'annulation apparaît dans « Paiements annulés » de septembre. C'est cohérent avec l'usage de l'annulation (erreur de saisie, argent jamais reçu). Une clôture de période (revenus figés) serait une fonctionnalité distincte, à décider.
- **Annulation et encaissement simultanés sur le même acte.** Les deux verrouillent la ligne du montant dû : le second attend le premier, puis est refusé (acte déjà payé, ou acte annulé). Testé dans les deux ordres, en base.

## 8. Hors périmètre de la Phase 7

- **Dépenses** (décision du porteur du projet).
- **Remboursements** d'une somme réellement encaissée, remises et avoirs.
- **Factures et reçus** (documents), TVA, tiers payant et organismes de remboursement.
- **Ventilation d'un paiement** sur plusieurs actes (section 1).
- **Plusieurs devises** dans un même cabinet : la devise est fixée à la création du cabinet.

## 9. Options écartées

| Option | Raison |
|---|---|
| Montants en `numeric` ou en nombres à virgule | Arrondis ; le centime entier est exact et suffit |
| Statut « payé » stocké sur le montant dû | Pourrait diverger des paiements ; il se calcule |
| Paiement modifiable (montant, moyen) | Modification silencieuse d'une donnée financière ; on annule et on ressaisit |
| Date d'encaissement saisie librement | Permettrait d'antidater dans une période close |
| Contrôle « jamais plus payé que dû » seulement dans le code | Ne résiste pas à deux saisies simultanées ; la base verrouille et vérifie |
| Paiement sans montant dû (avoir « flottant ») | Deux restants dus différents (par acte, par patient) ; l'acompte sur devis couvre le besoin |

## 10. Réponses du porteur du projet (validation de la Phase 7, 2026-09-27)

| # | Question | Réponse | Conséquence dans le code |
|---|---|---|---|
| 1 | Revenus visibles par le dentiste | Tout le cabinet, réparti par praticien. Une limitation de certains praticiens à leurs propres revenus doit rester possible | Toute lecture de revenus (page « Revenus », journal, tableau de bord) passe par une seule fonction de **périmètre** (`revenueScope`) qui renvoie aujourd'hui « tout le cabinet ». La limitation s'ajoutera par une permission `finance.reports.read_own` et une seconde branche de cette fonction (praticiens liés au compte), sans toucher aux requêtes |
| 2 | Annulation d'un acte par la secrétaire | Refusée, même non payé | Inchangé : `payment.void` réservé à l'administrateur et au dentiste |
| 3 | Clôture de période | Pas au MVP ; doit pouvoir s'ajouter sans refonte | Voir ci-dessous |
| 4 | Reçu patient | Plus tard, sans bloquer les phases en cours | Ajouté aux extensions futures (`docs/future/README.md`) |

**Pourquoi la clôture de période s'ajoutera sans refonte :**
- les données nécessaires existent déjà et ne changent jamais : instant d'encaissement (`received_at`), instant d'annulation (`voided_at`, `cancelled_at`), montants ;
- les revenus d'une période « tels que connus à une date T » se recalculent donc exactement : paiements reçus dans la période, sauf ceux annulés avant T ;
- le calcul des revenus est centralisé dans le service des finances ; la clôture n'aura qu'un seul endroit à modifier.

**Forme prévue de la clôture (non développée) :**
1. une table `finance_periods` (cabinet, mois, date de clôture, auteur), en ajout seul ;
2. la clôture fige la période : ses revenus sont lus « tels que connus à la date de clôture » ;
3. un paiement d'une période close annulé ensuite apparaît comme **correction** dans la période de son annulation, au lieu de modifier la période close ;
4. une permission dédiée (`finance.period.close`) pour clôturer.

