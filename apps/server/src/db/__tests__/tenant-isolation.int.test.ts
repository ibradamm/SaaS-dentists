import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestClinic, openTestDatabase } from '../../../test/db';
import { recordAudit } from '../../modules/audit/audit.service';
import type { Clinic } from '../schema';
import { auditLogs, clinics } from '../schema';
import { withTenant } from '../tenant';

describe('isolation entre cabinets (RLS)', () => {
  const t = openTestDatabase({ appPoolMax: 1 });
  let clinicA: Clinic;
  let clinicB: Clinic;

  beforeAll(async () => {
    clinicA = await createTestClinic(t.ownerDb);
    clinicB = await createTestClinic(t.ownerDb);
    await withTenant(t.appDb, clinicB.id, (tx) =>
      recordAudit(tx, { actorType: 'SYSTEM', actorId: null, action: 'clinic.settings_update' }),
    );
  });
  afterAll(() => t.close());

  it('sans contexte cabinet, le rôle applicatif ne voit aucune ligne', async () => {
    expect(await t.appDb.select().from(clinics)).toEqual([]);
    expect(await t.appDb.select().from(auditLogs)).toEqual([]);
  });

  it('dans le contexte A, seul le cabinet A est visible', async () => {
    const rows = await withTenant(t.appDb, clinicA.id, (tx) => tx.select().from(clinics));
    expect(rows.map((r) => r.id)).toEqual([clinicA.id]);
  });

  it("dans le contexte A, les entrées d'audit de B sont invisibles", async () => {
    const rows = await withTenant(t.appDb, clinicA.id, (tx) => tx.select().from(auditLogs));
    expect(rows).toEqual([]);
  });

  it('une insertion prend le cabinet du contexte par défaut', async () => {
    const rows = await withTenant(t.appDb, clinicA.id, async (tx) => {
      await recordAudit(tx, {
        actorType: 'SYSTEM',
        actorId: null,
        action: 'clinic.settings_update',
      });
      return tx.select().from(auditLogs);
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.clinicId).toBe(clinicA.id);
  });

  it('une insertion pour un autre cabinet est refusée par la politique RLS', async () => {
    await expect(
      withTenant(t.appDb, clinicA.id, (tx) =>
        tx
          .insert(auditLogs)
          .values({ clinicId: clinicB.id, actorType: 'SYSTEM', action: 'test.cross_tenant' }),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it("une mise à jour d'un autre cabinet n'affecte aucune ligne", async () => {
    const updated = await withTenant(t.appDb, clinicA.id, (tx) =>
      tx.update(clinics).set({ name: 'Piraté' }).where(eq(clinics.id, clinicB.id)).returning(),
    );
    expect(updated).toEqual([]);
    const [b] = await withTenant(t.appDb, clinicB.id, (tx) => tx.select().from(clinics));
    expect(b?.name).toBe(clinicB.name);
  });

  it('le contexte disparaît à la fin de la transaction, même sur la même connexion', async () => {
    await withTenant(t.appDb, clinicA.id, (tx) => tx.select().from(clinics));
    // Pool limité à une connexion : la requête suivante réutilise la même session.
    const [row] = await t.appDb
      .execute<{ clinic: string | null }>(sql`SELECT app.current_clinic_id()::text AS clinic`)
      .then((r) => r.rows);
    expect(row?.clinic).toBeNull();
    expect(await t.appDb.select().from(clinics)).toEqual([]);
  });

  it('le contexte est annulé avec la transaction en cas d’erreur', async () => {
    await expect(
      withTenant(t.appDb, clinicA.id, () => Promise.reject(new Error('échec métier'))),
    ).rejects.toThrow('échec métier');
    expect(await t.appDb.select().from(clinics)).toEqual([]);
  });

  it('un identifiant de cabinet invalide est refusé avant toute requête', async () => {
    await expect(withTenant(t.appDb, "x' OR 1=1 --", () => Promise.resolve())).rejects.toThrow();
  });

  it('le rôle applicatif ne peut pas créer de cabinet', async () => {
    await expect(
      withTenant(t.appDb, clinicA.id, (tx) =>
        tx.insert(clinics).values({
          id: clinicA.id,
          name: 'x',
          timezone: 'Europe/Paris',
          locale: 'fr-FR',
          currency: 'EUR',
          countryCode: 'FR',
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('le rôle applicatif ne peut pas modifier les colonnes réservées (statut, devise)', async () => {
    await expect(
      withTenant(t.appDb, clinicA.id, (tx) =>
        tx.update(clinics).set({ status: 'SUSPENDED' }).where(eq(clinics.id, clinicA.id)),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('updated_at est maintenu par la base lors d’une modification autorisée', async () => {
    const [before] = await withTenant(t.appDb, clinicA.id, (tx) => tx.select().from(clinics));
    const [after] = await withTenant(t.appDb, clinicA.id, (tx) =>
      tx
        .update(clinics)
        .set({ name: 'Cabinet A renommé' })
        .where(eq(clinics.id, clinicA.id))
        .returning(),
    );
    expect(after?.updatedAt.getTime()).toBeGreaterThan(before?.updatedAt.getTime() ?? 0);
  });
});
