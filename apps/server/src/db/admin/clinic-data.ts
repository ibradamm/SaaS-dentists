import { sql } from 'drizzle-orm';
import type pg from 'pg';
import type { SecretBox } from '../../lib/secret-box';
import { noteContext } from '../../modules/patients/patients.service';
import type { Database } from '../client';
import { withTenant } from '../tenant';

/**
 * Catalogue des données d'un cabinet (docs/adr/0014). Toute table du schéma public est soit
 * propre à un cabinet (colonne clinic_id), soit globale ; un test refuse toute table non
 * classée. L'export de restitution et la purge après résiliation parcourent ce catalogue :
 * une table oubliée ici ne serait ni restituée ni supprimée.
 *
 * Ordre : parents avant enfants (clés étrangères). La purge le parcourt à l'envers.
 */
export const CLINIC_TABLES = [
  'clinic_memberships',
  'sessions',
  'practitioners',
  'appointment_types',
  'working_schedules',
  'working_intervals',
  'availability_blocks',
  'import_batches',
  'import_rows',
  'patients',
  'patient_contacts',
  'patient_medical_notes',
  'appointments',
  'charges',
  'payments',
  'audit_logs',
] as const;
export type ClinicTable = (typeof CLINIC_TABLES)[number];

/**
 * Tables sans clinic_id : le cabinet lui-même, les comptes (rattachés par clinic_memberships,
 * un compte pouvant appartenir à plusieurs cabinets) et le référentiel des statuts.
 */
export const GLOBAL_TABLES = ['clinics', 'users', 'appointment_statuses'] as const;

/** Non restituée : jetons de session et données de sécurité du service. */
const NOT_EXPORTED: readonly ClinicTable[] = ['sessions'];

export const EXPORT_FORMAT = 'dental-export/1';

export interface ClinicExport {
  format: typeof EXPORT_FORMAT;
  generatedAt: string;
  clinicId: string;
  /** Ce qui n'est pas restitué, et pourquoi. */
  notExported: Record<string, string>;
  counts: Record<string, number>;
  data: Record<string, Record<string, unknown>[]>;
}

/**
 * Export complet d'un cabinet pour restitution (fin de contrat, demande du cabinet). Rôle
 * applicatif et withTenant : la RLS garantit qu'aucune ligne d'un autre cabinet n'en fait
 * partie. Les lignes sont converties en JSON par PostgreSQL (dates « AAAA-MM-JJ », instants
 * avec leur décalage), sans conversion dans le fuseau du serveur. Les notes médicales sont
 * déchiffrées : le fichier produit est aussi sensible que le dossier patient. Les tables sont lues
 * l'une après l'autre : l'ensemble n'est cohérent que si le cabinet est suspendu (aucune
 * écriture), ce que prévoit la procédure de fin de contrat.
 */
export async function exportClinicData(
  db: Database,
  clinicId: string,
  secretBox: SecretBox,
  now: Date = new Date(),
): Promise<ClinicExport> {
  return withTenant(db, clinicId, async (tx) => {
    const rows = async (query: ReturnType<typeof sql>) =>
      (await tx.execute<{ row: Record<string, unknown> }>(query)).rows.map((r) => r.row);
    const clinic = await rows(
      sql`SELECT to_jsonb(c) AS row FROM clinics c WHERE c.id = ${clinicId}`,
    );
    if (clinic.length === 0) throw new Error(`Cabinet introuvable : ${clinicId}`);
    const data: ClinicExport['data'] = {
      clinics: clinic,
      // Comptes : identité et statut seulement, jamais les secrets d'authentification.
      users: await rows(sql`
        SELECT jsonb_build_object('id', u.id, 'email', u.email, 'full_name', u.full_name,
                                  'status', u.status, 'created_at', u.created_at) AS row
        FROM users u JOIN clinic_memberships m ON m.user_id = u.id
        WHERE m.clinic_id = ${clinicId} ORDER BY u.id`),
    };
    for (const table of CLINIC_TABLES) {
      if (NOT_EXPORTED.includes(table)) continue;
      data[table] = await rows(
        sql`SELECT to_jsonb(t) AS row FROM ${sql.identifier(table)} t WHERE t.clinic_id = ${clinicId} ORDER BY t.id`,
      );
    }
    data.patient_medical_notes = (data.patient_medical_notes ?? []).map(
      ({ content_enc, ...note }) => ({
        ...note,
        content: secretBox.decrypt(String(content_enc), noteContext(String(note.id))),
      }),
    );
    return {
      format: EXPORT_FORMAT,
      generatedAt: now.toISOString(),
      clinicId,
      notExported: {
        sessions: 'jetons et données de sécurité du service',
        'users.*':
          'secrets d’authentification (empreinte du mot de passe, double authentification)',
      },
      counts: Object.fromEntries(Object.entries(data).map(([table, list]) => [table, list.length])),
      data,
    };
  });
}

export interface PurgeResult {
  clinicId: string;
  clinicName: string;
  executed: boolean;
  deleted: Record<string, number>;
}

export class PurgeRefused extends Error {
  override name = 'PurgeRefused';
}

/**
 * Suppression de toutes les données d'un cabinet après résiliation, sur instruction
 * (docs/operations/fin-de-contrat.md) : jamais déclenchée par une durée. Connexion
 * administrateur (seule à pouvoir supprimer le journal d'audit et les dossiers malgré la RLS) ;
 * chaque requête filtre par clinic_id, dans une seule transaction.
 *
 * Refusée si le cabinet n'est pas suspendu, s'il est sous conservation pour litige, ou si la
 * confirmation ne reproduit pas exactement son nom. Sans `execute`, la transaction est annulée
 * après les suppressions : la simulation donne les volumes exacts et prouve que la purge passe.
 * Les comptes rattachés à ce seul cabinet sont supprimés ; les autres perdent leur rattachement.
 */
export async function purgeClinicData(
  admin: pg.PoolClient,
  input: { clinicId: string; confirmName: string; execute: boolean },
): Promise<PurgeResult> {
  await admin.query('BEGIN');
  try {
    const { rows: role } = await admin.query<{ bypass: boolean }>(
      'SELECT rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user',
    );
    if (!role[0]?.bypass) throw new PurgeRefused('connexion administrateur requise');
    const { rows } = await admin.query<{
      name: string;
      status: string;
      legal_hold_since: Date | null;
    }>('SELECT name, status, legal_hold_since FROM clinics WHERE id = $1 FOR UPDATE', [
      input.clinicId,
    ]);
    const clinic = rows[0];
    if (!clinic) throw new PurgeRefused('cabinet introuvable');
    if (clinic.legal_hold_since) throw new PurgeRefused('cabinet sous conservation pour litige');
    if (clinic.status !== 'SUSPENDED') throw new PurgeRefused('cabinet non suspendu');
    if (input.confirmName !== clinic.name) {
      throw new PurgeRefused('la confirmation ne reproduit pas le nom du cabinet');
    }

    const { rows: members } = await admin.query<{ user_id: string }>(
      'SELECT user_id FROM clinic_memberships WHERE clinic_id = $1',
      [input.clinicId],
    );
    const deleted: Record<string, number> = {};
    for (const table of [...CLINIC_TABLES].reverse()) {
      const result = await admin.query(
        `DELETE FROM ${admin.escapeIdentifier(table)} WHERE clinic_id = $1`,
        [input.clinicId],
      );
      deleted[table] = result.rowCount ?? 0;
    }
    const orphans = await admin.query(
      `DELETE FROM users u WHERE u.id = ANY($1::uuid[])
         AND NOT EXISTS (SELECT 1 FROM clinic_memberships m WHERE m.user_id = u.id)`,
      [members.map((m) => m.user_id)],
    );
    deleted.users = orphans.rowCount ?? 0;
    const removed = await admin.query('DELETE FROM clinics WHERE id = $1', [input.clinicId]);
    deleted.clinics = removed.rowCount ?? 0;

    await admin.query(input.execute ? 'COMMIT' : 'ROLLBACK');
    return {
      clinicId: input.clinicId,
      clinicName: clinic.name,
      executed: input.execute,
      deleted,
    };
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
}
