import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  api,
  createPatient,
  DESKTOP,
  horizontalOverflow,
  nav,
  PHONE,
  setupClinic,
  signIn,
  TABLET,
  type Clinic,
} from '../support/app';
import { addDays, todayIn } from '../support/dates';
import { sql } from '../support/db';
import { PATIENTS } from '../support/sentinels';

/*
 * Encaissements en conditions réelles : acte depuis l'agenda, paiements partiels, double clic,
 * réponse perdue, deux encaissements simultanés du restant dû, annulations motivées réservées
 * au dentiste, revenus et « À encaisser » comparés à la base.
 */
let clinic: Clinic;
let secretary: Page;
let dentist: Page;
let appointmentId = '';
const ids = { a: '', b: '' };
const today = todayIn();
const yesterday = addDays(today, -1);

test.beforeAll(async ({ browser }) => {
  clinic = await setupClinic(browser, 'Cabinet des Encaissements');
  ids.a = await createPatient(clinic.adminPage, ...PATIENTS.a);
  ids.b = await createPatient(clinic.adminPage, ...PATIENTS.b);
  const created = await api<{ id: string }>(clinic.adminPage, 'POST', '/api/appointments', {
    practitionerId: clinic.practitioners.dentist,
    patientId: ids.a,
    appointmentTypeId: clinic.types.consultation,
    start: `${yesterday}T10:00`,
    allowOutsideAvailability: true,
  });
  expect(created.status).toBe(201);
  appointmentId = created.body.id;
  secretary = await signIn(browser, clinic.secretary, { viewport: TABLET });
  dentist = await signIn(browser, clinic.dentist, { viewport: DESKTOP });
});

const payments = (page: Page) => page.getByRole('region', { name: 'Paiements' });

/** État de la base : actes et paiements d'un patient (centimes). */
async function ledger(patientId: string) {
  return sql<{
    label: string;
    charge: number;
    status: string;
    paid: number;
    voided: number;
    n: number;
  }>(
    `select c.label, c.amount_cents as charge, c.status,
            coalesce(sum(p.amount_cents) filter (where p.status = 'RECORDED'), 0)::int as paid,
            coalesce(sum(p.amount_cents) filter (where p.status = 'VOIDED'), 0)::int as voided,
            count(p.id)::int as n
       from charges c left join payments p on p.charge_id = c.id and p.clinic_id = c.clinic_id
      where c.clinic_id = $1 and c.patient_id = $2
      group by c.id order by c.created_at`,
    [clinic.id, patientId],
  );
}

test('secrétaire (tablette) : de l’agenda à l’encaissement ; double clic et réponse perdue sans doublon', async () => {
  await secretary.goto(`/agenda?vue=jour&date=${yesterday}`);
  await secretary.getByRole('button', { name: /^Dr Denis, 10:00–10:30 AUBERTIN Léonie/ }).click();
  await secretary
    .getByRole('complementary', { name: 'Rendez-vous' })
    .getByRole('link', { name: 'Encaisser' })
    .click();
  const form = secretary.getByRole('form', { name: 'Nouvel acte à encaisser' });
  await expect(form.getByLabel('Rendez-vous (facultatif)')).toHaveValue(appointmentId);
  await expect(form.getByLabel('Libellé')).toHaveValue('Consultation');
  await form.getByLabel('Montant dû (EUR)').fill('60');
  await form.getByLabel('Montant encaissé (EUR)').fill('20');
  await form.getByLabel('Moyen de paiement').selectOption('CASH');
  await form.getByRole('button', { name: /^Enregistrer et encaisser 20,00/ }).dblclick();
  await expect(
    payments(secretary).getByText(
      /Acte « Consultation » enregistré, 20,00.€ encaissé\. Restant dû : 40,00.€\./,
    ),
  ).toBeVisible();
  expect(await ledger(ids.a)).toEqual([
    { label: 'Consultation', charge: 6000, status: 'OPEN', paid: 2000, voided: 0, n: 1 },
  ]);

  // Complément : le restant est proposé, un dépassement est bloqué avant l'envoi.
  await payments(secretary).getByRole('button', { name: 'Encaisser : Consultation' }).click();
  const pay = secretary.getByRole('form', { name: 'Encaisser : Consultation' });
  await expect(pay.getByLabel('Montant encaissé (EUR)')).toHaveValue('40,00');
  await pay.getByLabel('Montant encaissé (EUR)').fill('45');
  await pay.getByLabel('Moyen de paiement').selectOption('CARD');
  await expect(pay.getByRole('button', { name: /^Encaisser/ })).toBeDisabled();
  await pay.getByLabel('Montant encaissé (EUR)').fill('15,5');

  // Réponse perdue : le serveur enregistre, le navigateur ne reçoit rien ; le nouvel essai
  // réutilise la clé d'idempotence et ne crée rien de plus.
  let lose = true;
  await secretary.route(
    (url) => url.pathname === '/api/payments',
    async (route) => {
      if (route.request().method() !== 'POST' || !lose) return route.fallback();
      lose = false;
      await route.fetch();
      await route.abort('connectionreset');
    },
  );
  await pay.getByRole('button', { name: /^Encaisser 15,50/ }).click();
  await expect(pay.getByText(/Vérifiez votre connexion/)).toBeVisible();
  await pay.getByRole('button', { name: /^Encaisser 15,50/ }).click();
  await expect(
    payments(secretary).getByText(
      /Paiement de 15,50.€ encaissé\. Restant dû sur l’acte : 24,50.€\./,
    ),
  ).toBeVisible();
  await secretary.unrouteAll();
  expect(await ledger(ids.a)).toEqual([
    { label: 'Consultation', charge: 6000, status: 'OPEN', paid: 3550, voided: 0, n: 2 },
  ]);
  // Aucune annulation proposée à la secrétaire.
  await expect(payments(secretary).getByRole('button', { name: /^Annuler/ })).toHaveCount(0);
});

test('secrétaire : annulations et revenus refusés par le serveur, même en contournant l’interface', async () => {
  const [payment] = await sql<{ id: string }>(
    'select id from payments where clinic_id = $1 and patient_id = $2 limit 1',
    [clinic.id, ids.a],
  );
  const [charge] = await sql<{ id: string }>(
    'select id from charges where clinic_id = $1 and patient_id = $2 limit 1',
    [clinic.id, ids.a],
  );
  const statuses = [
    (await api(secretary, 'POST', `/api/payments/${payment?.id}/void`, { reason: 'Contournement' }))
      .status,
    (await api(secretary, 'POST', `/api/charges/${charge?.id}/cancel`, { reason: 'Contournement' }))
      .status,
    (await api(secretary, 'GET', `/api/finance/revenue?from=${today}&to=${today}`)).status,
    (await api(secretary, 'GET', `/api/finance/payments?from=${today}&to=${today}`)).status,
  ];
  expect(statuses).toEqual([403, 403, 403, 403]);
  await secretary.goto('/revenus');
  await expect(secretary.getByText("Vous n'avez pas accès à cette page.")).toBeVisible();
  expect(await ledger(ids.a)).toMatchObject([{ status: 'OPEN', paid: 3550, voided: 0 }]);
});

test('deux encaissements simultanés du restant dû : un seul accepté, jamais plus que dû', async () => {
  for (const page of [secretary, dentist]) {
    await page.goto(`/patients/${ids.a}`);
    await payments(page).getByRole('button', { name: 'Encaisser : Consultation' }).click();
    await page
      .getByRole('form', { name: 'Encaisser : Consultation' })
      .getByLabel('Moyen de paiement')
      .selectOption('CHECK');
  }
  const buttons = [secretary, dentist].map((p) =>
    p
      .getByRole('form', { name: 'Encaisser : Consultation' })
      .getByRole('button', { name: /^Encaisser 24,50/ }),
  );
  await Promise.all(buttons.map((b) => b.click()));
  const outcomes = await Promise.all(
    [secretary, dentist].map(async (p) => {
      const ok = payments(p).getByText(/Paiement de 24,50.€ encaissé/);
      const ko = p.getByRole('form', { name: 'Encaisser : Consultation' }).getByRole('alert');
      await expect(ok.or(ko).first()).toBeVisible();
      return (await ok.isVisible()) ? 'accepté' : 'refusé';
    }),
  );
  expect(outcomes.sort()).toEqual(['accepté', 'refusé']);
  expect(await ledger(ids.a)).toEqual([
    { label: 'Consultation', charge: 6000, status: 'OPEN', paid: 6000, voided: 0, n: 3 },
  ]);
});

test('dentiste : annulation motivée d’un paiement, acte payé immédiatement, acte annulé', async () => {
  await dentist.goto(`/patients/${ids.a}`);
  const history = payments(dentist).getByRole('list', { name: 'Paiements : Consultation' });
  await history.getByRole('button', { name: /^Annuler le paiement de 15,50/ }).click();
  const confirm = payments(dentist).getByRole('button', {
    name: 'Confirmer l’annulation du paiement',
  });
  await expect(confirm).toBeDisabled();
  await payments(dentist).getByLabel('Motif (obligatoire)').fill('Erreur de moyen de paiement');
  await confirm.click();
  await expect(payments(dentist).getByText(/Paiement de 15,50.€ annulé\./)).toBeVisible();
  await expect(history.getByRole('button', { name: /^Annuler le paiement de 15,50/ })).toHaveCount(
    0,
  );
  const [voided] = await sql<{ id: string }>(
    `select id from payments where clinic_id = $1 and status = 'VOIDED'`,
    [clinic.id],
  );
  const again = await api<{ error: { code: string } }>(
    dentist,
    'POST',
    `/api/payments/${voided?.id}/void`,
    { reason: 'Encore' },
  );
  expect(again.status).toBe(409);
  expect(await ledger(ids.a)).toEqual([
    { label: 'Consultation', charge: 6000, status: 'OPEN', paid: 4450, voided: 1550, n: 3 },
  ]);

  // Patient sans rendez-vous : acte de 1 234,56 € payé par chèque, puis acte non payé annulé.
  await dentist.goto(`/patients/${ids.b}`);
  await payments(dentist).getByRole('button', { name: 'Nouvel acte à encaisser' }).click();
  let form = dentist.getByRole('form', { name: 'Nouvel acte à encaisser' });
  await form.getByLabel('Libellé').fill('Détartrage');
  await form.getByLabel('Montant dû (EUR)').fill('1 234,56');
  await form.getByLabel('Moyen de paiement').selectOption('CHECK');
  await form.getByRole('button', { name: /^Enregistrer et encaisser 1.234,56/ }).click();
  await expect(
    payments(dentist).getByText(/Acte « Détartrage » enregistré, 1.234,56.€ encaissé\./),
  ).toBeVisible();
  await payments(dentist).getByRole('button', { name: 'Nouvel acte à encaisser' }).click();
  form = dentist.getByRole('form', { name: 'Nouvel acte à encaisser' });
  await form.getByLabel('Libellé').fill('Radio panoramique');
  await form.getByLabel('Montant dû (EUR)').fill('0,29');
  await form.getByLabel(/Encaisser maintenant/).uncheck();
  await form.getByRole('button', { name: 'Enregistrer l’acte' }).click();
  await expect(
    payments(dentist).getByText(/Acte « Radio panoramique » enregistré\./),
  ).toBeVisible();
  await payments(dentist)
    .getByRole('button', { name: 'Annuler l’acte : Radio panoramique' })
    .click();
  await payments(dentist).getByLabel('Motif (obligatoire)').fill('Acte non réalisé');
  await payments(dentist).getByRole('button', { name: 'Confirmer l’annulation de l’acte' }).click();
  await expect(payments(dentist).getByText('Acte « Radio panoramique » annulé.')).toBeVisible();
  await expect(
    payments(dentist).getByRole('button', { name: 'Annuler l’acte : Détartrage' }),
  ).toHaveCount(0);
  expect(await ledger(ids.b)).toEqual([
    { label: 'Détartrage', charge: 123456, status: 'OPEN', paid: 123456, voided: 0, n: 1 },
    { label: 'Radio panoramique', charge: 29, status: 'CANCELLED', paid: 0, voided: 0, n: 0 },
  ]);
});

test('revenus du jour et « À encaisser » : chiffres affichés = base de données', async () => {
  const [db] = await sql<{ total: number; count: number; voided: number; remaining: number }>(
    `select
       (select coalesce(sum(amount_cents), 0)::int from payments
         where clinic_id = $1 and status = 'RECORDED'
           and (received_at at time zone 'Europe/Paris')::date = $2::date) as total,
       (select count(*)::int from payments
         where clinic_id = $1 and status = 'RECORDED'
           and (received_at at time zone 'Europe/Paris')::date = $2::date) as count,
       (select coalesce(sum(amount_cents), 0)::int from payments
         where clinic_id = $1 and status = 'VOIDED'
           and (received_at at time zone 'Europe/Paris')::date = $2::date) as voided,
       (select coalesce(sum(c.amount_cents - coalesce(p.paid, 0)), 0)::int
          from charges c
          left join (select charge_id, sum(amount_cents) as paid from payments
                      where clinic_id = $1 and status = 'RECORDED' group by charge_id) p
            on p.charge_id = c.id
         where c.clinic_id = $1 and c.status <> 'CANCELLED') as remaining`,
    [clinic.id, today],
  );
  // 20 + 24,50 + 1 234,56 encaissés ; 15,50 annulé ; restant 15,50 (60 − 44,50).
  expect(db).toEqual({ total: 127906, count: 3, voided: 1550, remaining: 1550 });
  const euros = (cents: number) =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);

  await nav(dentist).getByRole('link', { name: 'Revenus' }).click();
  await dentist.getByRole('button', { name: 'Aujourd’hui' }).click();
  const tiles = dentist.locator('main dl').first();
  await expect(tiles).toContainText(euros(db!.total));
  await expect(tiles).toContainText('3 paiements');
  await expect(tiles).toContainText(euros(db!.remaining));
  await expect(tiles).toContainText(euros(db!.voided));

  await nav(secretary).getByRole('link', { name: 'À encaisser' }).click();
  await expect(
    secretary.getByText(`Restant dû de tout le cabinet : ${euros(db!.remaining)}`),
  ).toBeVisible();
  const rows = secretary
    .getByRole('list', { name: 'Patients avec un restant dû' })
    .getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('AUBERTIN Léonie');
  await expect(rows.first()).toContainText(euros(1550));
});

test('comptes et revenus en largeur de téléphone : aucun débordement', async () => {
  await dentist.setViewportSize(PHONE);
  for (const path of ['/revenus', '/encaissements', `/patients/${ids.a}`, `/patients/${ids.b}`]) {
    await dentist.goto(path);
    await expect(dentist.locator('main h1, main h2').first()).toBeVisible();
    await dentist.waitForLoadState('networkidle');
    expect({ path, overflow: await horizontalOverflow(dentist) }).toEqual({ path, overflow: 0 });
  }
  await dentist.setViewportSize(DESKTOP);
});

test('autre cabinet : aucune donnée financière de celui-ci', async ({ browser }) => {
  const other = await setupClinic(browser, 'Cabinet Voisin');
  const [charge] = await sql<{ id: string }>(
    'select id from charges where clinic_id = $1 limit 1',
    [clinic.id],
  );
  const page = other.adminPage;
  const statuses = [
    (await api(page, 'GET', `/api/patients/${ids.a}/account`)).status,
    (
      await api(page, 'POST', '/api/payments', {
        idempotencyKey: randomUUID(),
        chargeId: charge?.id,
        amountCents: 100,
        method: 'CASH',
      })
    ).status,
    (await api(page, 'POST', `/api/charges/${charge?.id}/cancel`, { reason: 'Intrusion' })).status,
  ];
  expect(statuses).toEqual([404, 404, 404]);
  await page.goto('/encaissements');
  await expect(page.getByText('Aucun montant restant dû.')).toBeVisible();
  expect(await ledger(ids.a)).toMatchObject([{ status: 'OPEN', paid: 4450 }]);
  await page.context().close();
});
