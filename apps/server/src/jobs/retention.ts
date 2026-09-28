import { sql } from 'drizzle-orm';
import type { Logger } from '../config/logger';
import type { Database } from '../db/client';
import { withTenant } from '../db/tenant';
import { purgeEndedSessions } from '../modules/auth/session-retention';
import { purgeStaleDrafts } from '../modules/imports/imports.service';

/** File de la tâche quotidienne de conservation (planifiée par le worker). */
export const RETENTION_QUEUE = 'maintenance-retention';
/** Chaque nuit à 3 h 17 UTC (heure creuse en Europe). */
export const RETENTION_CRON = '17 3 * * *';

export interface RetentionReport {
  clinics: number;
  sessions: number;
  importDrafts: number;
}

/**
 * Conservation des données (docs/adr/0011) : pour chaque cabinet, dans son propre contexte
 * (withTenant, RLS inchangée), supprime les sessions terminées depuis plus de
 * `sessionRetentionDays` jours (30 par défaut) et les brouillons d'import de plus de 24 h. Le
 * journal ne reçoit que des compteurs.
 */
export async function runRetention(deps: {
  db: Database;
  logger: Logger;
  now?: () => Date;
  sessionRetentionDays?: number;
}): Promise<RetentionReport> {
  const now = (deps.now ?? (() => new Date()))();
  const ids = await deps.db.execute<{ id: string }>(sql`SELECT app.maintenance_clinic_ids() AS id`);
  const report: RetentionReport = { clinics: 0, sessions: 0, importDrafts: 0 };
  for (const { id } of ids.rows) {
    const counts = await withTenant(deps.db, id, async (tx) => ({
      sessions: await purgeEndedSessions(tx, id, now, deps.sessionRetentionDays),
      importDrafts: await purgeStaleDrafts(tx, id, now),
    }));
    report.clinics += 1;
    report.sessions += counts.sessions;
    report.importDrafts += counts.importDrafts;
  }
  deps.logger.info(
    { retention: report, sessionRetentionDays: deps.sessionRetentionDays ?? 30 },
    'conservation des données appliquée',
  );
  return report;
}
