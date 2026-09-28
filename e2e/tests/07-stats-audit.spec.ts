import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  api,
  createPatient,
  selectContaining,
  setupClinic,
  signIn,
  type Clinic,
} from '../support/app';
import { addDays, todayIn } from '../support/dates';
import { sql } from '../support/db';
import { PATIENTS } from '../support/sentinels';

/*
 * Statistiques et journal comparés à un calcul SQL indépendant : chiffres du tableau de bord,
 * filtre par praticien, journal filtré par utilisateur, historique d'un élément.
 */
let clinic: Clinic;
let dentist: Page;
let cancelledId = '';
const today = todayIn();
const yesterday = addDays(today, -1);
const percent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });
const euros = (cents: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);

test.beforeAll(async ({ browser }) => {
  clinic = await setupClinic(browser, 'Cabinet des Chiffres');
  dentist = await signIn(browser, clinic.dentist);
  const ids = [];
  for (const key of ['a', 'b', 'c', 'd'] as const) {
    ids.push(await createPatient(clinic.adminPage, PATIENTS[key][0], PATIENTS[key][1]));
  }
  // Hier : trois rendez-vous du dentiste (honoré, absent, annulé), un de l'hygiéniste (honoré).
  const plan = [
    [clinic.practitioners.dentist, ids[0], '09:00', 'COMPLETED'],
    [clinic.practitioners.dentist, ids[1], '10:00', 'NO_SHOW'],
    [clinic.practitioners.dentist, ids[2], '11:00', 'CANCELLED'],
    [clinic.practitioners.hygienist, ids[3], '09:00', 'COMPLETED'],
  ] as const;
  for (const [practitionerId, patientId, time, status] of plan) {
    const created = await api<{ id: string; version: number }>(
      clinic.adminPage,
      'POST',
      '/api/appointments',
      {
        practitionerId,
        patientId,
        appointmentTypeId: clinic.types.consultation,
        start: `${yesterday}T${time}`,
        allowOutsideAvailability: true,
      },
    );
    expect(created.status).toBe(201);
    // Statuts posés par le dentiste : ils apparaîtront sous son nom dans le journal.
    const changed = await api(dentist, 'POST', `/api/appointments/${created.body.id}/status`, {
      version: created.body.version,
      status,
      reason: status === 'CANCELLED' ? 'À la demande du patient' : null,
    });
    expect(changed.status).toBe(200);
    if (status === 'CANCELLED') cancelledId = created.body.id;
  }
  // 50 € dus pour le premier, 30 € encaissés.
  const charge = await api(dentist, 'POST', '/api/charges', {
    idempotencyKey: randomUUID(),
    patientId: ids[0],
    practitionerId: clinic.practitioners.dentist,
    label: 'Consultation',
    amountCents: 5000,
    payment: { amountCents: 3000, method: 'CASH' },
  });
  expect(charge.status).toBe(201);
});

async function expected(practitionerId?: string) {
  const [row] = await sql<{
    completed: number;
    noShow: number;
    cancelled: number;
    revenue: number;
    remaining: number;
  }>(
    `select
       count(*) filter (where a.status = 'COMPLETED')::int as "completed",
       count(*) filter (where a.status = 'NO_SHOW')::int as "noShow",
       count(*) filter (where a.status = 'CANCELLED')::int as "cancelled",
       (select coalesce(sum(p.amount_cents), 0)::int from payments p
          left join charges c on c.id = p.charge_id
         where p.clinic_id = $1 and p.status = 'RECORDED'
           and (p.received_at at time zone 'Europe/Paris')::date between $2::date and $3::date
           and ($4::uuid is null or c.practitioner_id = $4)) as "revenue",
       (select coalesce(sum(c.amount_cents), 0)::int - coalesce((select sum(amount_cents)
          from payments where clinic_id = $1 and status = 'RECORDED'), 0)::int
          from charges c where c.clinic_id = $1 and c.status = 'OPEN') as "remaining"
       from appointments a
      where a.clinic_id = $1
        and (a.start_at at time zone 'Europe/Paris')::date between $2::date and $3::date
        and ($4::uuid is null or a.practitioner_id = $4)`,
    [clinic.id, yesterday, today, practitionerId ?? null],
  );
  return row!;
}

const tile = (page: Page, label: string) => page.locator('dt', { hasText: label }).locator('..');

test('tableau de bord : chaque chiffre affiché = calcul SQL indépendant', async () => {
  const db = await expected();
  expect(db).toEqual({ completed: 2, noShow: 1, cancelled: 1, revenue: 3000, remaining: 2000 });
  await dentist.goto(`/statistiques?vue=custom&du=${yesterday}&au=${today}`);
  await expect(tile(dentist, 'Revenus encaissés')).toContainText(euros(db.revenue));
  await expect(tile(dentist, 'Rendez-vous honorés').locator('dd').first()).toHaveText(
    String(db.completed),
  );
  await expect(tile(dentist, 'Taux de présence').locator('dd').first()).toHaveText(
    percent.format(db.completed / (db.completed + db.noShow)),
  );
  await expect(tile(dentist, 'Rendez-vous annulés').locator('dd').first()).toHaveText(
    String(db.cancelled),
  );
  await expect(tile(dentist, 'Restant à encaisser')).toContainText(euros(db.remaining));
});

test('filtre par praticien : chiffres du seul praticien, identiques au calcul SQL', async () => {
  const db = await expected(clinic.practitioners.dentist);
  expect(db).toMatchObject({ completed: 1, noShow: 1, cancelled: 1, revenue: 3000 });
  await dentist.goto(`/statistiques?vue=custom&du=${yesterday}&au=${today}`);
  await selectContaining(dentist.getByLabel('Praticien'), 'Dr Denis');
  await expect(dentist.getByText('Filtré sur un praticien')).toBeVisible();
  await expect(tile(dentist, 'Rendez-vous honorés').locator('dd').first()).toHaveText('1');
  await expect(tile(dentist, 'Taux de présence').locator('dd').first()).toHaveText(
    percent.format(0.5),
  );
  await expect(tile(dentist, 'Revenus encaissés')).toContainText(euros(db.revenue));
});

test('journal : filtre par utilisateur et historique d’un élément = base de données', async () => {
  const admin = clinic.adminPage;
  const [counts] = await sql<{ byDentist: number; history: number }>(
    `select
       (select count(*)::int from audit_logs a join users u on u.id = a.actor_id
         where a.clinic_id = $1 and u.full_name = 'Denis Dentiste'
           and (a.created_at at time zone 'Europe/Paris')::date = $2::date) as "byDentist",
       (select count(*)::int from audit_logs
         where clinic_id = $1 and entity_type = 'appointment' and entity_id = $3) as "history"`,
    [clinic.id, today, cancelledId],
  );
  await admin.goto(`/journal?du=${today}&au=${today}`);
  await selectContaining(admin.getByLabel('Utilisateur'), 'Denis Dentiste');
  await admin.getByRole('button', { name: 'Filtrer' }).click();
  const entries = admin.getByRole('list', { name: 'Entrées du journal' }).getByRole('listitem');
  await expect(entries).toHaveCount(counts!.byDentist);
  // Historique du rendez-vous annulé : création et dérogation (saisi a posteriori, hors
  // horaires) par l'administrateur, annulation par le dentiste.
  expect(counts!.history).toBe(3);
  await entries
    .filter({ hasText: `${PATIENTS.c[0].toUpperCase()} ${PATIENTS.c[1]}` })
    .filter({ hasText: 'Statut de rendez-vous modifié' })
    .getByRole('button', { name: 'Historique de cet élément' })
    .click();
  await expect(admin.getByText('Historique d’un seul élément')).toBeVisible();
  await expect(entries).toHaveCount(counts!.history);
  await expect(entries.nth(0)).toContainText('Statut de rendez-vous modifié');
  await expect(entries.nth(0)).toContainText('Denis Dentiste');
  await expect(entries.filter({ hasText: 'Rendez-vous hors horaires' })).toContainText(
    'Anne Admin',
  );
  await expect(entries.filter({ hasText: 'Rendez-vous créé' })).toContainText('Anne Admin');
  // Le motif saisi n'est jamais recopié.
  await expect(admin.locator('main')).not.toContainText('À la demande du patient');
});
