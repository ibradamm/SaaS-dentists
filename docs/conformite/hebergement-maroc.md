# Hébergement au Maroc : recherche documentaire

- **Date :** 2026-10-01.
- **Nature :** recherche documentaire uniquement. **Aucun compte créé, aucune souscription, aucune dépense, aucun fournisseur contacté.**
- **Sources :** pages des fournisseurs et presse, connues par des extraits de moteur de recherche. Seule la documentation de Railway a été **lue** directement (connecteur de documentation).
- **Niveau de confiance :** indiqué pour chaque option. Tout chiffre ou service est à confirmer par un devis écrit avant décision.

## Ce que l'architecture demande

| Besoin | Usage dans le produit |
|---|---|
| PostgreSQL 16 | Base unique ; RLS ; rôles distincts (applicatif, propriétaire, administrateur) ; extensions `btree_gist` (contraintes d'exclusion) et `pg_trgm` (recherche) : à confirmer chez tout service géré |
| Exécution de conteneurs (Node 22) | API Fastify (une seule instance), worker, commande `migrate` ponctuelle ; images Docker déjà prêtes |
| Interface statique | Caddy (image prête) |
| TLS | Certificat pour le domaine public |
| Sauvegardes et restauration | Instantanés, restauration à un instant donné souhaitée (procédure : [sauvegarde-restauration.md](../operations/sauvegarde-restauration.md)) |
| Chiffrement | Au repos chez l'hébergeur ; notes médicales déjà chiffrées par l'application |
| Supervision | Journaux, état de santé ; Sentry facultatif |

Deux familles d'offres :
- **plateforme gérée** : comme Railway, l'hébergeur fournit la base, les sauvegardes et les déploiements ;
- **machines virtuelles** : nous installons et maintenons tout. Le fichier `infra/staging-local/compose.yml` est un point de départ, mais il faut ajouter le TLS réel, des sauvegardes vers un stockage séparé, les mises à jour du système et la supervision. C'est une charge d'exploitation permanente.

## Options

| Option | Localisation des données | Prix public | PostgreSQL | Sauvegardes, restauration | Certifications | Limites | Confiance |
|---|---|---|---|---|---|---|---|
| **Oracle Cloud (OCI), région Casablanca** | Casablanca (datacenters N+ONE). Région ouverte le 7 avril 2026 ; seconde région prévue à Settat | Grille OCI publique ; prix et gratuité (« Always Free ») dans cette région **non vérifiés** | Service géré « OCI Database with PostgreSQL » existant ; **disponibilité à Casablanca non vérifiée** | Sauvegardes du service géré si disponible ; stockage objet | Certifications OCI mondiales (ISO 27001, SOC…) ; attestation propre à la région inconnue | Société américaine (Oracle) : lois extraterritoriales ; complexité d'OCI (réseau, IAM) ; région récente | Moyenne (presse, annonce d'Oracle) |
| **OVHcloud, Local Zone Maroc** (avec Maroc Datacenter) | Maroc ; la ville diffère selon les sources (**Rabat** ou Casablanca) | Grille publique OVHcloud ; prix de la Local Zone non vérifié | **Pas de base gérée en Local Zone** (documentation OVHcloud via recherche) : PostgreSQL à installer sur une machine | À organiser soi-même (stockage bloc, stockage objet : disponibilité à confirmer) | Certifications OVHcloud (ISO 27001…) ; périmètre de la Local Zone inconnu | Ni répartiteur de charge, ni supervision gérée en Local Zone (selon un extrait) ; société française | Moyenne |
| **inwi Business Cloud** (VPS, datacenter virtuel OpenStack ou VMware, sauvegarde et reprise en service) | Maroc : datacenters Tier III (Rabat Technopolis, Settat, Marrakech) | VPS de **119 à 879 MAD par mois** ; datacenter virtuel et sauvegarde sur devis | Aucun service géré trouvé : PostgreSQL à installer | Offre de sauvegarde gérée par inwi ; reprise après sinistre | ISO 27001, PCI-DSS, Tier III (Uptime Institute) ; disponibilité annoncée 99,98 % | Société marocaine ; exploitation à notre charge sur VPS ; tarifs entreprise opaques | Moyenne |
| **Maroc Telecom, MT-Cloud** (VPS, VDS, datacenter virtuel) | Maroc (datacenter Tier III) | Non trouvé | Aucun service géré trouvé | Non documenté dans les extraits | Tier III | Informations publiques pauvres | Faible |
| **N+ONE Datacenters** (colocation, IaaS, cloud privé) | Maroc (Nouaceur, Settat) | Sur devis | Non | Selon contrat | Tier III, ISO 27001, PCI-DSS | Offre entreprise, dimensionnée pour plus grand que nous | Moyenne |
| **Petits hébergeurs** (Nindohost « Cloud Maroc », ADK Media, vps.ma…) | Annoncée au Maroc ; à vérifier au contrat | VPS dès 159 MAD HT par mois (ADK Media) | Non | Inconnu | Inconnues | Solidité, support et sauvegardes inconnus | Faible |
| AWS, Azure, Google Cloud | **Aucune région au Maroc** en 2026 (AWS : zone Wavelength avec Orange, réservée au réseau mobile) | — | — | — | — | Hors sujet pour la résidence au Maroc | Moyenne |
| *Référence* **Railway** (prévu) | **Pays-Bas** (Amsterdam) ; sous-traitant Tigris pour le stockage objet de l'archive de restauration (région choisie à la création) | Hobby **5 $ par mois** plus l'usage ; estimation staging 5 à 7 $ | Modèle PostgreSQL géré par Railway | Sauvegardes du volume (6, 27 et 89 jours) ; restauration à un instant donné (environ 4 semaines) ; restauration dans le même projet seulement | SOC 2 Type II, SOC 3 ; DPA ; BAA HIPAA en option payante | Société américaine ; personnel de Railway pouvant accéder aux services hors BAA ; journaux HTTP avec adresse IP et chemin (7 jours en Hobby, 30 en Pro) | **Élevée** (documentation lue) |

Le décret 2-24-921 (prestataires cloud qualifiés DGSSI) n'imposerait pas ces critères à un cabinet privé, selon notre **INTERPRÉTATION** ([sources.md](sources.md), section 3). Aucun prestataire ne serait encore qualifié (SOURCE SECONDAIRE).

## Comparaison avec Railway

Notes de 1 (défavorable) à 3 (favorable), relatives entre options. Ce sont nos appréciations, pas des mesures.

| Critère | Railway (Pays-Bas) | OCI Casablanca | OVHcloud Local Zone | inwi (VPS ou datacenter virtuel) |
|---|---|---|---|---|
| Coût (staging) | 3 : environ 5 à 7 $ par mois | 2 : à chiffrer ; peut-être gratuit si l'offre « Always Free » couvre la région | 2 : machines à petit prix probable | 2 : VPS dès 119 MAD par mois, plus le temps d'exploitation |
| Simplicité | 3 : déjà décrit dans `.railway/railway.ts` | 1 : plateforme complète, apprentissage | 2 : machines simples, tout à monter | 2 : idem |
| Sauvegardes | 3 : intégrées (6, 27, 89 jours) | 2 : intégrées **si** PostgreSQL géré est disponible | 1 : à construire | 2 : offre de sauvegarde gérée, sur devis |
| Restauration | 3 : à un instant donné, environ 4 semaines | 2 : selon le service | 1 : à construire et tester | 2 : selon l'offre |
| Résidence des données | 1 : Pays-Bas, société américaine | 3 : Maroc (société américaine) | 3 : Maroc (société française) | 3 : Maroc (société marocaine) |
| Contraintes loi 09-08 | 1 : demande de transfert par cabinet ; accès possibles depuis les États-Unis | 2 : pas de transfert pour l'hébergement ; accès de support d'Oracle à qualifier | 2 : idem, support d'OVHcloud (France, pays de la liste) | 3 : pas de transfert si l'exploitation reste au Maroc |
| Facilité de déploiement | 3 : prêt | 1 : à concevoir | 2 : `compose.yml` à adapter | 2 : idem |

## Lecture

- **Si le juriste confirme qu'un transfert vers les Pays-Bas est faisable** pour des données de santé, avec une demande par cabinet : Railway reste le plus simple et le moins cher, et il est prêt.
- **Si le transfert est refusé, trop lourd pour chaque cabinet, ou si vous voulez un argument commercial « données au Maroc »** :
  - **OCI Casablanca** est la seule option gérée trouvée au Maroc. Il faut d'abord confirmer que PostgreSQL géré y est disponible, et le prix ;
  - **inwi** ou **OVHcloud Local Zone** sont viables sur machines virtuelles, au prix d'une exploitation que nous assumons : système, sauvegardes, supervision, sécurité. Cette charge pèse sur une équipe réduite.
- Dans tous les cas, un hébergement au Maroc **ne dispense ni** de la déclaration ou autorisation du traitement, **ni** du contrat de sous-traitance, **ni** de l'examen des accès de support depuis l'étranger.

## Actions possibles (gratuites, sans engagement, sur votre accord)

1. Demander par écrit un **devis** et une **fiche de services** à OCI (région Casablanca, PostgreSQL géré ?), à inwi (VPS ou datacenter virtuel, sauvegarde) et à OVHcloud (Local Zone Maroc). Aucun compte n'est nécessaire.
2. Attendre l'avis du juriste sur le transfert (questions 3 à 5 du [dossier](dossier-juriste.md)) avant de choisir.

## Sources (extraits de recherche, sauf mention)

- Railway (**lue**) : [Compliance](https://docs.railway.com/enterprise/compliance), [Backups](https://docs.railway.com/volumes/backups), [Storage Buckets](https://docs.railway.com/storage-buckets), [Logs](https://docs.railway.com/observability/logs), [Point-in-Time Recovery](https://docs.railway.com/volumes/point-in-time-recovery).
- Oracle Casablanca : [DCD](https://www.datacenterdynamics.com/en/news/oracle-launches-cloud-region-in-casablanca-morocco/), [Morocco World News](https://www.moroccoworldnews.com/2026/04/286383/oracle-launches-its-first-hyperscaler-public-cloud-in-morocco/), [OCI Database with PostgreSQL](https://www.oracle.com/africa/cloud/postgresql/).
- OVHcloud : [communiqué Local Zone Maroc](https://corporate.ovhcloud.com/en/newsroom/news/local-zones-morocco/), [datacenter Maroc](https://www.ovhcloud.com/fr-ma/datacenter/africa/morocco/), [Le Matin, VPS au Maroc](https://lematin.ma/economie/ovhcloud-lance-ses-serveurs-prives-virtuels-au-maroc-des-lete-2025/273697).
- inwi : [Business Cloud](https://inwi.ma/en/entreprise/cloud-maroc), [VPS](https://inwi.ma/en/entreprise/vps), [VDC](https://inwi.ma/en/entreprise/vdc), [Tier III (LesEco)](https://leseco.ma/business/inwi-decroche-la-certification-tier-iii-pour-ses-data-centers.html).
- Maroc Telecom : [hébergement datacenter](https://www.iam.ma/entreprises/h%C3%A9bergement-datacenter).
- N+ONE : [Uptime Institute](https://uptimeinstitute.com/clients/nplusone), [à propos](https://nplusone.africa/about/).
- Hyperscalers : [Claro Digital](https://clarodigi.com/blog/aws-vs-azure-vs-google-cloud-morocco/), [AWS Wavelength et Orange (DCD)](https://www.datacenterdynamics.com/en/news/aws-launching-wavelength-zone-edge-location-in-morocco-and-senegal-with-orange/).
- Petits hébergeurs : [Nindohost](https://nindohost.ma/serveurs/cloud-maroc/), [ADK Media](https://adk-media.com/).
- DGSSI : [décret 2-24-921](https://www.dgssi.gov.ma/en/reglementations/decree-no-2-24-921-use-cloud-service-providers-entities-and-critical).
