# Demandes d'information à Railway et Sentry (projets, non envoyés)

> **Ne pas envoyer sans l'accord du porteur du projet.** Aucun fournisseur n'a été contacté.

- Messages en anglais, langue du support des deux fournisseurs.
- Remplacer `[…]` avant envoi. Ne mettre **aucun secret**, aucun identifiant de projet, aucune donnée patient.
- Canal suggéré :
  - Railway : `team@railway.com`, ou demande d'accès au [Trust Center](https://trust.railway.com) (accord de confidentialité possible) ;
  - Sentry : support depuis le compte, ou les pages Legal & Compliance (DPA dans le produit).
- Joindre les réponses à [inventaire-et-ecarts.md](inventaire-et-ecarts.md) et au contrat (annexe 4).

Ce que nous savons déjà (DOC. FOURNISSEUR LUE pour Railway, DOC. FOURNISSEUR (RECHERCHE) pour Sentry), pour ne pas poser de question inutile :
- **Railway :**
  - DPA standard en libre-service ;
  - SOC 2 Type II et SOC 3 ;
  - sauvegardes du volume conservées 6, 27 et 89 jours ;
  - restauration à un instant donné par pgBackRest vers un bucket, environ 4 semaines ;
  - buckets hébergés par **Tigris**, chiffrés au repos, région choisie à la création ;
  - journaux : 7 jours (Hobby), 30 jours (Pro) ;
  - journaux HTTP avec adresse IP du client, navigateur et chemin ;
  - avec un BAA en vigueur, l'équipe de Railway n'accède plus directement aux services (BAA : option payante).
- **Sentry :**
  - région UE à **Francfort**, sauvegardes dans l'UE ;
  - certaines métadonnées de compte et d'organisation peuvent être stockées aux États-Unis ;
  - DPA dans le produit, sur toutes les offres ;
  - liste de sous-traitants publiée (dont AWS et Cloudflare).

## 1. Railway

**Résumé (français) :**
- DPA ;
- localisation de la base, des sauvegardes, des journaux et de l'archive de restauration ;
- sous-traitants ;
- accès depuis les États-Unis ;
- chiffrement au repos ;
- durées ;
- suppression après résiliation ;
- restauration à un instant donné ;
- enregistrement de la chaîne de requête dans les journaux HTTP ;
- lieu de terminaison TLS pour le trafic venant du Maroc.

> **Subject:** Data residency and data protection questions before onboarding (healthcare SaaS, Morocco)
>
> Hello Railway team,
>
> We are preparing to host a practice-management SaaS for dental clinics in Morocco on Railway, in the `europe-west4-drams3a` region (Amsterdam). The data includes patient health information, so our clinics must file data-transfer requests with the Moroccan data protection authority (CNDP, Law 09-08). We would be grateful for written answers to the following questions:
>
> 1. **DPA.** We have read the standard DPA at railway.com/legal/dpa. Does it apply to customers outside the EU (Morocco), and can it be signed on the Hobby or Pro plan? Is there a version that lists sub-processors and their locations?
> 2. **Primary location.** For a PostgreSQL service and its volume in `europe-west4-drams3a`, is all data at rest stored only in the Netherlands? Could any copy be made outside that region (failover, migration, maintenance)?
> 3. **Volume backups.** Where are volume backups (daily, weekly, monthly) physically stored? Same region and same provider as the volume?
> 4. **Point-in-time recovery.** The PITR archive is written to a Railway Bucket run on Tigris. If the bucket is created in an EU region, where exactly are its objects stored and replicated? Is Tigris listed as a sub-processor under the DPA?
> 5. **Logs.** Where are deployment logs and HTTP logs stored and processed? Do **HTTP logs record the full request URL including the query string**, or only the path? Retention is 7 days (Hobby) and 30 days (Pro): can logs be deleted earlier on request?
> 6. **Edge and TLS.** For users connecting from Morocco, in which region is TLS terminated and the request handled by Railway's edge (the `@edgeRegion` attribute)?
> 7. **Sub-processors.** Please share the current list of sub-processors with their roles and locations (infrastructure, storage, logging, support tooling).
> 8. **Access from the United States.** Can Railway employees or sub-processors located in the US (or elsewhere) access customer workloads, volumes, backups or logs? Under what conditions (support request, incident, abuse), and is such access logged and available to us? Without a BAA, what technical and contractual limits apply?
> 9. **Encryption at rest.** Are volumes and volume backups encrypted at rest (algorithm, key management)? Buckets are documented as encrypted at rest: same question for keys.
> 10. **Backup retention.** Please confirm the retention of each backup type, and whether any other copies exist (internal disaster recovery, replicas) with their own retention.
> 11. **Deletion after termination.** When we delete a volume, a bucket or the whole project, or close the workspace, how long until the data is irreversibly deleted from primary storage, backups, the PITR archive (we read 52 hours for buckets) and logs? Can you provide a deletion confirmation?
> 12. **Point-in-time recovery.** Please confirm that PITR is available on the Hobby and Pro plans for PostgreSQL in `europe-west4-drams3a`, and the effective recovery window.
>
> Thank you,
> [Name], [Company], [email]

## 2. Sentry

**Résumé (français) :**
- DPA ;
- région UE et localisation réelle des événements et des sauvegardes ;
- métadonnées stockées aux États-Unis ;
- sous-traitants ;
- transferts hors UE ;
- durées ;
- suppression ;
- chiffrement au repos.

> **Subject:** EU region data residency questions (healthcare SaaS, Morocco)
>
> Hello Sentry team,
>
> We plan to use Sentry (EU region, Developer or Team plan) for server-side error reporting of a practice-management SaaS for dental clinics in Morocco. By design, we send no personal data: no IP address, no user identifiers, no request bodies or query strings, only error types, stack traces, a service name and a request ID. Our clinics must still document every foreign recipient for the Moroccan data protection authority (CNDP, Law 09-08). Could you answer in writing:
>
> 1. **DPA.** Does the in-product DPA apply to customers outside the EU (Morocco)? Which version and date?
> 2. **EU region.** For an organization created in the EU region, confirm that error events, attachments and their backups are stored only in Frankfurt (Germany) or elsewhere in the EU.
> 3. **Metadata.** Which account, organization or integration metadata is stored in the US, and does any of it come from event payloads?
> 4. **Sub-processors.** Current list with roles and locations, in particular those processing EU-region event data (for example CDN or ingestion edge).
> 5. **Transfers outside the EU.** Can event data be accessed from outside the EU (support, engineering), and under which safeguards (SCCs, Data Privacy Framework)?
> 6. **Retention.** Retention of error events on the Developer and Team plans, and of backups.
> 7. **Deletion.** How long after deleting an issue, a project or the organization is the data irreversibly removed, backups included?
> 8. **Encryption at rest** for event storage and backups.
> 9. **Server-side scrubbing.** Is IP address storage disabled by default for events sent without a user context, and can we enforce it at the organization level?
>
> Thank you,
> [Name], [Company], [email]
