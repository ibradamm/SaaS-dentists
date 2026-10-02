import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestClinic, openTestDatabase } from '../../../test/db';
import type { Clinic } from '../../db/schema';
import { auditLogs } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { recordAudit } from '../../modules/audit/audit.service';
import { createRuntimeJobQueue, enqueue } from '../queue';

const QUEUE = 'test.outbox';

describe('outbox transactionnelle (pg-boss, rôle applicatif)', () => {
  const t = openTestDatabase();
  const logger = pino({ level: 'silent' });
  let boss: PgBoss;
  let clinic: Clinic;
  const errors: unknown[] = [];

  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb);
    boss = createRuntimeJobQueue(inject('database').appUrl, logger);
    boss.on('error', (error) => errors.push(error));
    await boss.start();
  });
  afterAll(async () => {
    await boss.stop({ graceful: false });
    await t.close();
  });

  it('une tâche enfilée dans une transaction validée existe, avec l’écriture métier', async () => {
    const jobId = await withTenant(t.appDb, clinic.id, async (tx) => {
      await recordAudit(tx, { actorType: 'SYSTEM', actorId: null, action: 'import.created' });
      return enqueue(boss, tx, QUEUE, { clinicId: clinic.id, kind: 'commit' });
    });
    const job = await boss.getJobById<{ kind: string }>(QUEUE, jobId);
    expect(job?.data.kind).toBe('commit');
  });

  it('une tâche enfilée dans une transaction annulée n’existe pas, pas plus que l’écriture', async () => {
    let jobId: string | undefined;
    await expect(
      withTenant(t.appDb, clinic.id, async (tx) => {
        await recordAudit(tx, {
          actorType: 'SYSTEM',
          actorId: null,
          action: 'import.discarded',
        });
        jobId = await enqueue(boss, tx, QUEUE, { clinicId: clinic.id, kind: 'rollback' });
        throw new Error('échec métier après enfilage');
      }),
    ).rejects.toThrow('échec métier');
    expect(jobId).toBeDefined();
    expect(await boss.getJobById(QUEUE, jobId!)).toBeNull();
    const audits = await withTenant(t.appDb, clinic.id, (tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(sql`${auditLogs.action} = 'import.discarded'`),
    );
    expect(audits).toEqual([]);
  });

  it('le worker (rôle applicatif) traite les tâches validées, jamais la tâche annulée', async () => {
    const seen = new Set<string>();
    const done = new Promise<void>((resolve) => {
      void boss.work<{ kind: string }>(QUEUE, { pollingIntervalSeconds: 0.5 }, (jobs) => {
        for (const job of jobs) seen.add(job.data.kind);
        if (seen.has('commit') && seen.has('process-me')) resolve();
        return Promise.resolve();
      });
    });
    await withTenant(t.appDb, clinic.id, (tx) =>
      enqueue(boss, tx, QUEUE, { clinicId: clinic.id, kind: 'process-me' }),
    );
    await Promise.race([
      done,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('tâches non traitées')), 15_000),
      ),
    ]);
    expect(seen.has('rollback')).toBe(false);
  });

  it('la maintenance de la file fonctionne avec les droits du rôle applicatif', async () => {
    await expect(boss.supervise()).resolves.toBeUndefined();
    expect(errors).toEqual([]);
  });
});
