import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestClinic, openTestDatabase } from '../../../../test/db';
import type { Clinic } from '../../../db/schema';
import { auditLogs } from '../../../db/schema';
import { withTenant } from '../../../db/tenant';
import { recordAudit } from '../audit.service';

describe("journal d'audit", () => {
  const t = openTestDatabase();
  let clinic: Clinic;
  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb);
  });
  afterAll(() => t.close());

  it('enregistre une action avec ses métadonnées', async () => {
    const actorId = '01a0de7a-0000-7000-8000-000000000001';
    const rows = await withTenant(t.appDb, clinic.id, async (tx) => {
      await recordAudit(tx, {
        actorType: 'USER',
        actorId,
        action: 'clinic.settings_update',
        entityType: 'clinic',
        entityId: clinic.id,
        changes: { name: { from: 'A', to: 'B' } },
        requestId: 'req-1',
        ip: '203.0.113.7',
      });
      return tx.select().from(auditLogs);
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      clinicId: clinic.id,
      actorType: 'USER',
      actorId,
      action: 'clinic.settings_update',
      changes: { name: { from: 'A', to: 'B' } },
      ip: '203.0.113.7',
    });
  });

  it("est annulé avec la transaction métier qui l'accompagne", async () => {
    await expect(
      withTenant(t.appDb, clinic.id, async (tx) => {
        await recordAudit(tx, { actorType: 'SYSTEM', actorId: null, action: 'import.discarded' });
        throw new Error('échec après audit');
      }),
    ).rejects.toThrow('échec après audit');
    const rows = await withTenant(t.appDb, clinic.id, (tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(sql`${auditLogs.action} = 'import.discarded'`),
    );
    expect(rows).toEqual([]);
  });

  it('rejette une action mal formée avant toute écriture', async () => {
    await expect(
      withTenant(t.appDb, clinic.id, (tx) =>
        recordAudit(tx, { actorType: 'SYSTEM', actorId: null, action: 'DROP TABLE' as never }),
      ),
    ).rejects.toThrow();
  });

  it('rejette une action ou un type d’élément absents du catalogue (chaque entrée a un libellé)', async () => {
    for (const entry of [
      { action: 'patient.exported' },
      { action: 'patient.updated', entityType: 'dossier' },
    ]) {
      await expect(
        withTenant(t.appDb, clinic.id, (tx) =>
          recordAudit(tx, { actorType: 'SYSTEM', actorId: null, ...entry } as never),
        ),
      ).rejects.toThrow();
    }
  });

  it('rejette une valeur non scalaire dans changes (pas de contenu libre imbriqué)', async () => {
    await expect(
      withTenant(t.appDb, clinic.id, (tx) =>
        recordAudit(tx, {
          actorType: 'SYSTEM',
          actorId: null,
          action: 'patient.updated',
          changes: { notes: { to: { secret: 'x' } as unknown as string } },
        }),
      ),
    ).rejects.toThrow();
  });

  it.each([
    ['UPDATE', sql`UPDATE audit_logs SET action = 'test.tampered'`],
    ['DELETE', sql`DELETE FROM audit_logs`],
    ['TRUNCATE', sql`TRUNCATE audit_logs`],
  ])('le rôle applicatif ne peut pas faire %s sur le journal', async (_name, statement) => {
    await expect(
      withTenant(t.appDb, clinic.id, (tx) => tx.execute(statement)),
    ).rejects.toMatchObject({
      cause: { code: '42501' },
    });
  });
});
