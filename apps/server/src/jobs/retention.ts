import { eq, sql } from 'drizzle-orm';
import type { Logger } from '../config/logger';
import type { Database, Transaction } from '../db/client';
import { clinics } from '../db/schema';
import { withTenant } from '../db/tenant';
import { purgeEndedSessions } from '../modules/auth/session-retention';
import { purgeStaleDrafts } from '../modules/imports/imports.service';

/** File de la tâche quotidienne de conservation (planifiée par le worker). */
export const RETENTION_QUEUE = 'maintenance-retention';
/** Chaque nuit à 3 h 17 UTC (heure creuse en Europe). */
export const RETENTION_CRON = '17 3 * * *';

export interface RetentionReport {
  clinics: number;
  /** Cabinets sous conservation pour litige : rien n'y est supprimé (docs/adr/0014). */
  legalHolds: number;
  sessions: number;
  importDrafts: number;
}

/**
 * Conservation des données (docs/adr/0011) : pour chaque cabinet, dans son propre contexte
 * (withTenant, RLS inchangée), supprime les sessions terminées depuis plus de
 * `sessionRetentionDays` jours (30 par défaut) et les brouillons d'import de plus de 24 h. Un
 * cabinet sous conservation pour litige est sauté (docs/adr/0014). Le journal ne reçoit que des
 * compteurs.
 */
export async function runRetention(deps: {
  db: Database;
  logger: Logger;
  now?: () => Date;
  sessionRetentionDays?: number;
}): Promise<RetentionReport> {
  const now = (deps.now ?? (() => new Date()))();
  const ids = await deps.db.execute<{ id: string }>(sql`SELECT app.maintenance_clinic_ids() AS id`);
  const report: RetentionReport = { clinics: 0, legalHolds: 0, sessions: 0, importDrafts: 0 };
  for (const { id } of ids.rows) {
    const counts = await withTenant(deps.db, id, async (tx) =>
      (await legalHoldSince(tx, id))
        ? null
        : {
            sessions: await purgeEndedSessions(tx, id, now, deps.sessionRetentionDays),
            importDrafts: await purgeStaleDrafts(tx, id, now),
          },
    );
    report.clinics += 1;
    if (!counts) {
      report.legalHolds += 1;
      continue;
    }
    report.sessions += counts.sessions;
    report.importDrafts += counts.importDrafts;
  }
  deps.logger.info(
    { retention: report, sessionRetentionDays: deps.sessionRetentionDays ?? 30 },
    'conservation des données appliquée',
  );
  return report;
}

async function legalHoldSince(tx: Transaction, clinicId: string): Promise<Date | null> {
  const [clinic] = await tx
    .select({ since: clinics.legalHoldSince })
    .from(clinics)
    .where(eq(clinics.id, clinicId));
  return clinic?.since ?? null;
}

/**
 * Durées de revue (docs/conformite/tableau-de-conservation.md) : facultatives, en jours. Elles
 * ne déclenchent aucune suppression ; elles mesurent ce qui les dépasse, pour décision du
 * cabinet. Une suppression automatique demande une durée validée juridiquement, puis un code
 * et des tests dédiés (docs/adr/0014).
 */
export interface RetentionReviewDurations {
  patientInactiveDays?: number | undefined;
  billingDays?: number | undefined;
  auditLogDays?: number | undefined;
  importRowsDays?: number | undefined;
}

export interface RetentionReviewLine {
  category: 'patients' | 'charges' | 'payments' | 'audit_logs' | 'import_rows';
  /** Point de départ de la durée, en clair. */
  from: string;
  records: number;
  oldest: string | null;
  durationDays: number | null;
  /** Enregistrements au-delà de la durée ; null si aucune durée n'est configurée. */
  beyond: number | null;
}

/** Revue de conservation d'un cabinet (rôle applicatif, dans withTenant) : lecture seule. */
export async function reviewRetention(
  tx: Transaction,
  clinicId: string,
  now: Date,
  durations: RetentionReviewDurations,
): Promise<RetentionReviewLine[]> {
  const measure = async (
    category: RetentionReviewLine['category'],
    from: string,
    days: number | undefined,
    startedAt: ReturnType<typeof sql>,
  ): Promise<RetentionReviewLine> => {
    const cutoff = days === undefined ? null : new Date(now.getTime() - days * 86_400_000);
    const { rows } = await tx.execute<{ records: number; oldest: string | null; beyond: number }>(
      sql`SELECT count(*)::int AS records, min(started_at)::text AS oldest,
                 count(*) FILTER (WHERE started_at < ${cutoff?.toISOString() ?? null}::timestamptz)::int AS beyond
          FROM (${startedAt}) s`,
    );
    const row = rows[0]!;
    return {
      category,
      from,
      records: row.records,
      oldest: row.oldest,
      durationDays: days ?? null,
      beyond: cutoff ? row.beyond : null,
    };
  };
  return [
    await measure(
      'patients',
      'dernier rendez-vous, ou création de la fiche',
      durations.patientInactiveDays,
      sql`SELECT greatest(p.created_at, max(a.start_at)) AS started_at
          FROM patients p
          LEFT JOIN appointments a ON a.clinic_id = p.clinic_id AND a.patient_id = p.id
          WHERE p.clinic_id = ${clinicId} GROUP BY p.id, p.created_at`,
    ),
    await measure(
      'charges',
      'création de l’acte',
      durations.billingDays,
      sql`SELECT created_at AS started_at FROM charges WHERE clinic_id = ${clinicId}`,
    ),
    await measure(
      'payments',
      'date de l’encaissement',
      durations.billingDays,
      sql`SELECT received_at AS started_at FROM payments WHERE clinic_id = ${clinicId}`,
    ),
    await measure(
      'audit_logs',
      'date de l’action',
      durations.auditLogDays,
      sql`SELECT created_at AS started_at FROM audit_logs WHERE clinic_id = ${clinicId}`,
    ),
    await measure(
      'import_rows',
      'date de l’import',
      durations.importRowsDays,
      sql`SELECT b.created_at AS started_at
          FROM import_rows r JOIN import_batches b ON b.clinic_id = r.clinic_id AND b.id = r.batch_id
          WHERE r.clinic_id = ${clinicId}`,
    ),
  ];
}
