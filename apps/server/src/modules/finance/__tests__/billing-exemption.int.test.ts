import { randomBytes, randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorFor } from '../../../../test/actors';
import { META, createUser, testClock } from '../../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../../test/db';
import { auditLogs, type Clinic } from '../../../db/schema';
import { withTenant } from '../../../db/tenant';
import { createSecretBox } from '../../../lib/secret-box';
import { createAppointmentsService } from '../../appointments/appointments.service';
import type { UserActor } from '../../auth/auth.types';
import { createPatientsService } from '../../patients/patients.service';
import { createPractitionersService } from '../../scheduling/practitioners.service';
import { createFinanceService } from '../finance.service';

/**
 * Rendez-vous « sans facturation » (docs/adr/0010, section 10) : un rendez-vous gratuit ne compte
 * pas comme oubli d'encaissement ; la mention et un acte ouvert s'excluent, y compris en cas de
 * saisies simultanées.
 */
describe('rendez-vous sans facturation', () => {
  const t = openTestDatabase({ appPoolMax: 6 });
  const clock = testClock(new Date('2026-09-28T08:00:00Z'));
  const deps = { db: t.appDb, now: clock.now };
  const finance = createFinanceService(deps);
  const appointmentsService = createAppointmentsService(deps);
  const practitionersService = createPractitionersService(deps);
  const patientsService = createPatientsService({
    ...deps,
    secretBox: createSecretBox(randomBytes(32)),
  });
  let clinic: Clinic;
  let admin: UserActor;
  let secretary: UserActor;
  let otherAdmin: UserActor;
  let practitioner: string;
  let type: string;
  let hour = 0;

  async function completedAppointment() {
    const patient = (
      await patientsService.create(
        secretary,
        { lastName: 'Gratuit', firstName: `N${hour}`, contacts: [] },
        META,
      )
    ).id;
    const appointment = await appointmentsService.create(
      secretary,
      {
        practitionerId: practitioner,
        patientId: patient,
        appointmentTypeId: type,
        // Rendez-vous passés, un par heure : jamais de chevauchement.
        start: `2026-09-${String(10 + Math.floor(hour / 8)).padStart(2, '0')}T${String(9 + (hour++ % 8)).padStart(2, '0')}:00`,
        allowOutsideAvailability: true,
      },
      META,
    );
    await appointmentsService.changeStatus(
      secretary,
      appointment.id,
      { version: appointment.version, status: 'COMPLETED', reason: null },
      META,
    );
    return { patient, appointmentId: appointment.id };
  }
  const charge = (patientId: string, appointmentId: string) =>
    finance.createCharge(
      secretary,
      {
        idempotencyKey: randomUUID(),
        patientId,
        appointmentId,
        label: 'Contrôle',
        amountCents: 3000,
      },
      META,
    );

  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris' });
    admin = actorFor((await createUser(t.ownerDb, clinic.id, 'ADMIN')).id, 'ADMIN', clinic.id);
    secretary = actorFor(
      (await createUser(t.ownerDb, clinic.id, 'SECRETARY')).id,
      'SECRETARY',
      clinic.id,
    );
    const other = await createTestClinic(t.ownerDb);
    otherAdmin = actorFor((await createUser(t.ownerDb, other.id, 'ADMIN')).id, 'ADMIN', other.id);
    practitioner = (
      await practitionersService.createPractitioner(
        admin,
        { displayName: 'Dr Gratuit', color: '#0ea5e9' },
        META,
      )
    ).id;
    type = (
      await practitionersService.createType(
        admin,
        { name: 'Contrôle', durationMinutes: 30, color: '#0ea5e9' },
        META,
      )
    ).id;
  });
  afterAll(() => t.close());

  it('la secrétaire marque puis rétablit ; chaque changement est tracé ; sans effet si déjà fait', async () => {
    const { appointmentId } = await completedAppointment();
    expect(
      await finance.setBillingExempt(secretary, appointmentId, { billingExempt: true }, META),
    ).toEqual({ appointmentId, billingExempt: true });
    // Même demande une seconde fois : rien ne change, rien n'est tracé en plus.
    await finance.setBillingExempt(secretary, appointmentId, { billingExempt: true }, META);
    await finance.setBillingExempt(secretary, appointmentId, { billingExempt: false }, META);
    const audit = await withTenant(t.appDb, clinic.id, (tx) =>
      tx
        .select({ action: auditLogs.action, changes: auditLogs.changes })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityId, appointmentId),
            eq(auditLogs.action, 'appointment.billing_exempt'),
          ),
        )
        .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id)),
    );
    expect(audit.map((a) => a.changes)).toEqual([
      { billingExempt: { from: false, to: true } },
      { billingExempt: { from: true, to: false } },
    ]);
  });

  it('mention et acte ouvert s’excluent ; un acte annulé libère la mention', async () => {
    const a = await completedAppointment();
    await finance.setBillingExempt(secretary, a.appointmentId, { billingExempt: true }, META);
    await expect(charge(a.patient, a.appointmentId)).rejects.toMatchObject({ code: 'CONFLICT' });

    const b = await completedAppointment();
    const { charge: open } = await charge(b.patient, b.appointmentId);
    await expect(
      finance.setBillingExempt(secretary, b.appointmentId, { billingExempt: true }, META),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await finance.cancelCharge(admin, open.id, { reason: 'Contrôle gratuit' }, META);
    expect(
      await finance.setBillingExempt(secretary, b.appointmentId, { billingExempt: true }, META),
    ).toMatchObject({ billingExempt: true });
  });

  it('rendez-vous annulé ou d’un autre cabinet : refus', async () => {
    const patient = (
      await patientsService.create(
        secretary,
        { lastName: 'Annule', firstName: 'X', contacts: [] },
        META,
      )
    ).id;
    const cancelled = await appointmentsService.create(
      secretary,
      {
        practitionerId: practitioner,
        patientId: patient,
        appointmentTypeId: type,
        start: '2026-10-05T09:00',
        allowOutsideAvailability: true,
      },
      META,
    );
    await appointmentsService.changeStatus(
      secretary,
      cancelled.id,
      { version: cancelled.version, status: 'CANCELLED', reason: null },
      META,
    );
    await expect(
      finance.setBillingExempt(secretary, cancelled.id, { billingExempt: true }, META),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const { appointmentId } = await completedAppointment();
    await expect(
      finance.setBillingExempt(otherAdmin, appointmentId, { billingExempt: true }, META),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      finance.setBillingExempt(secretary, randomUUID(), { billingExempt: true }, META),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('mention et saisie d’un acte simultanées : la saisie attend, puis est refusée', async () => {
    const a = await completedAppointment();
    const first = await t.appPool.connect();
    try {
      await first.query('BEGIN');
      await first.query("SELECT set_config('app.clinic_id', $1, true)", [clinic.id]);
      await first.query('UPDATE appointments SET billing_exempt = true WHERE id = $1', [
        a.appointmentId,
      ]);
      const pending = charge(a.patient, a.appointmentId).then(
        () => 'accepté',
        (e: { code?: string }) => e.code,
      );
      for (let i = 0; i < 50; i += 1) {
        const { rows } = await t.ownerPool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()",
        );
        if (rows[0]!.n > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await first.query('COMMIT');
      expect(await pending).toBe('CONFLICT');
    } finally {
      first.release();
    }
    expect((await finance.account(secretary, a.patient)).charges).toHaveLength(0);
  });
});
