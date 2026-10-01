import { eq, sql } from 'drizzle-orm';
import { loadRetentionReviewConfig } from '../../config/env';
import { reviewRetention } from '../../jobs/retention';
import { createDb, createPool } from '../client';
import { clinics } from '../schema';
import { withTenant } from '../tenant';

// Revue de conservation (docs/conformite/tableau-de-conservation.md), rôle applicatif :
//   node dist/retention-report.js
// Lecture seule : volumes, plus ancien enregistrement et, pour chaque durée RETENTION_REVIEW_*
// configurée, ce qui la dépasse. Aucune suppression (durées non validées, docs/adr/0014).
const config = loadRetentionReviewConfig();
const pool = createPool({
  connectionString: config.DATABASE_URL,
  max: 1,
  applicationName: 'dental-retention-review',
});
const durations = {
  patientInactiveDays: config.RETENTION_REVIEW_PATIENT_INACTIVE_DAYS,
  billingDays: config.RETENTION_REVIEW_BILLING_DAYS,
  auditLogDays: config.RETENTION_REVIEW_AUDIT_LOG_DAYS,
  importRowsDays: config.RETENTION_REVIEW_IMPORT_ROWS_DAYS,
};
try {
  const db = createDb(pool);
  const now = new Date();
  const ids = await db.execute<{ id: string }>(sql`SELECT app.maintenance_clinic_ids() AS id`);
  for (const { id } of ids.rows) {
    await withTenant(db, id, async (tx) => {
      const [clinic] = await tx
        .select({ name: clinics.name, hold: clinics.legalHoldSince })
        .from(clinics)
        .where(eq(clinics.id, id));
      const hold = clinic?.hold ? `depuis le ${clinic.hold.toISOString()}` : 'non';
      console.log(`Cabinet « ${clinic?.name} » (${id}) — conservation pour litige : ${hold}`);
      for (const line of await reviewRetention(tx, id, now, durations)) {
        const duration = line.durationDays === null ? 'non définie' : `${line.durationDays} j`;
        console.log(
          `  ${line.category} : ${line.records}, plus ancien ${line.oldest ?? '—'} (${line.from}) ; ` +
            `durée de revue ${duration} ; au-delà ${line.beyond ?? '—'}`,
        );
      }
    });
  }
  console.log('Aucune suppression : revue seulement (durées non validées juridiquement).');
} finally {
  await pool.end();
}
