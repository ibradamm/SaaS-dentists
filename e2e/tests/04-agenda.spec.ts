import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  api,
  createPatient,
  createUserAccount,
  selectContaining,
  setupClinic,
  signIn,
  type Clinic,
} from '../support/app';
import { book, expectSaved, fillAppointment, openAppointment, saveButton } from '../support/agenda';
import { addDays, frDate, nextDstChange, nextWorkday, todayIn } from '../support/dates';
import { sql } from '../support/db';
import { PATIENTS } from '../support/sentinels';

/*
 * Agenda en conditions réelles : deux postes sur le même créneau, double clic, réseau coupé,
 * déplacement, modification concurrente, statuts, absence posée sur des rendez-vous, et
 * changement d'heure vu depuis un poste réglé sur un autre fuseau que le cabinet.
 */
let clinic: Clinic;
let secretary: Page;
let secretary2: Page;
const ids: Record<keyof typeof PATIENTS, string> = {
  a: '',
  b: '',
  c: '',
  d: '',
  e: '',
  f: '',
  g: '',
};
const today = todayIn();
const day1 = nextWorkday(today);
const day2 = nextWorkday(day1);

test.beforeAll(async ({ browser }) => {
  clinic = await setupClinic(browser, 'Cabinet de l’Agenda');
  for (const key of Object.keys(ids) as (keyof typeof PATIENTS)[]) {
    ids[key] = await createPatient(clinic.adminPage, PATIENTS[key][0], PATIENTS[key][1]);
  }
  const second = await createUserAccount(clinic.adminPage, 'SECRETARY', 'Solène Seconde');
  secretary = await signIn(browser, clinic.secretary);
  secretary2 = await signIn(browser, second);
});

/** Rendez-vous d'un patient : heure locale du cabinet, heure UTC et statut. */
async function appointmentsOf(patientId: string) {
  return sql<{ local: string; utc: string; status: string }>(
    `select to_char(start_at at time zone 'Europe/Paris', 'YYYY-MM-DD HH24:MI') as local,
            to_char(start_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as utc, status
       from appointments where clinic_id = $1 and patient_id = $2 order by start_at`,
    [clinic.id, patientId],
  );
}

/** Issue d'un envoi : « enregistré » ou le message de refus affiché dans le panneau. */
async function outcome(page: Page, panel: Locator): Promise<string> {
  const saved = page.getByText('Rendez-vous enregistré.');
  const refused = panel.getByRole('alert');
  await expect(saved.or(refused)).toBeVisible();
  return (await saved.isVisible()) ? 'enregistré' : (await refused.innerText()).trim();
}

const appointmentsPath = (url: URL) => url.pathname === '/api/appointments';

test('deux secrétaires envoient le même créneau au même instant : un seul rendez-vous', async () => {
  const [p1, p2] = await Promise.all([
    fillAppointment(secretary, {
      patient: PATIENTS.a[0],
      practitioner: 'Dr Denis',
      date: day1,
      time: '10:00',
    }),
    fillAppointment(secretary2, {
      patient: PATIENTS.b[0],
      practitioner: 'Dr Denis',
      date: day1,
      time: '10:15',
    }),
  ]);
  await Promise.all([saveButton(p1).click(), saveButton(p2).click()]);
  const results = [await outcome(secretary, p1), await outcome(secretary2, p2)];
  expect(results.filter((r) => r === 'enregistré')).toHaveLength(1);
  expect(results.find((r) => r !== 'enregistré')).toMatch(/déjà un rendez-vous|déjà pris/);
  const [a, b] = [await appointmentsOf(ids.a), await appointmentsOf(ids.b)];
  expect(a.length + b.length).toBe(1);
});

test('double clic sur « Enregistrer » : un seul rendez-vous, aucune erreur affichée', async () => {
  let posts = 0;
  secretary.on('request', (r) => {
    if (r.method() === 'POST' && appointmentsPath(new URL(r.url()))) posts += 1;
  });
  const panel = await fillAppointment(secretary, {
    patient: PATIENTS.c[0],
    practitioner: 'Dr Denis',
    date: day1,
    time: '14:00',
  });
  await saveButton(panel).dblclick();
  await expectSaved(secretary);
  await expect(panel.getByRole('alert')).toHaveCount(0);
  expect(await appointmentsOf(ids.c)).toEqual([
    { local: `${day1} 14:00`, utc: expect.any(String), status: 'SCHEDULED' },
  ]);
  // Le second clic arrive avant que le bouton soit désactivé : une seule requête part.
  expect(posts).toBe(1);
});

test('réseau coupé avant le serveur, puis nouvel essai : enregistré une fois', async () => {
  let cut = true;
  await secretary.route(appointmentsPath, async (route) => {
    if (route.request().method() !== 'POST' || !cut) return route.fallback();
    cut = false;
    await route.abort('internetdisconnected');
  });
  const panel = await fillAppointment(secretary, {
    patient: PATIENTS.d[0],
    practitioner: 'Dr Denis',
    date: day1,
    time: '15:00',
  });
  await saveButton(panel).click();
  await expect(panel.getByRole('alert')).toContainText('Vérifiez votre connexion et réessayez');
  expect(await appointmentsOf(ids.d)).toHaveLength(0);
  await saveButton(panel).click();
  await expectSaved(secretary);
  expect(await appointmentsOf(ids.d)).toHaveLength(1);
  await secretary.unrouteAll();
});

test('réponse perdue après enregistrement, puis nouvel essai : enregistré, sans doublon', async () => {
  let lose = true;
  await secretary.route(appointmentsPath, async (route) => {
    if (route.request().method() !== 'POST' || !lose) return route.fallback();
    lose = false;
    await route.fetch(); // la requête atteint le serveur ; la réponse n'arrive jamais
    await route.abort('connectionreset');
  });
  const keys: string[] = [];
  secretary.on('request', (r) => {
    if (r.method() === 'POST' && appointmentsPath(new URL(r.url()))) {
      keys.push((r.postDataJSON() as { idempotencyKey: string }).idempotencyKey);
    }
  });
  const panel = await fillAppointment(secretary, {
    patient: PATIENTS.e[0],
    practitioner: 'Dr Denis',
    date: day1,
    time: '16:00',
  });
  await saveButton(panel).click();
  await expect(panel.getByRole('alert')).toContainText('Vérifiez votre connexion et réessayez');
  await saveButton(panel).click();
  // Même clé d'idempotence : le serveur renvoie le rendez-vous créé par le premier envoi
  // (corrigé avant la production : auparavant « Le praticien a déjà un rendez-vous… »).
  expect(await outcome(secretary, panel)).toBe('enregistré');
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(await appointmentsOf(ids.e)).toHaveLength(1);
  await secretary.unrouteAll();
});

test('API : même saisie envoyée deux fois au même instant, clé réutilisée, nouvelle clé', async () => {
  // Patient et jour propres à ce test : les autres comptent les rendez-vous de leurs patients.
  const patientId = await createPatient(clinic.adminPage, PATIENTS.f[0], PATIENTS.f[1]);
  const day3 = nextWorkday(day2);
  const body = (start: string, key: string) => ({
    practitionerId: clinic.practitioners.hygienist,
    patientId,
    appointmentTypeId: clinic.types.consultation,
    start,
    idempotencyKey: key,
  });
  const key = randomUUID();
  // Deux requêtes identiques simultanées depuis le navigateur (hors regroupement du client).
  const both = await secretary.evaluate(
    async (payload) => {
      const csrf = ((await (await fetch('/api/auth/csrf')).json()) as { csrfToken: string })
        .csrfToken;
      const send = () =>
        fetch('/api/appointments', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify(payload),
        }).then(async (r) => ({ status: r.status, id: ((await r.json()) as { id?: string }).id }));
      return Promise.all([send(), send()]);
    },
    body(`${day3}T15:00`, key),
  );
  expect(both.map((r) => r.status).sort()).toEqual([200, 201]);
  expect(both[0]?.id).toBe(both[1]?.id);
  // Même clé, autre demande : refus explicite.
  const reused = await api<{ error: { code: string } }>(
    secretary,
    'POST',
    '/api/appointments',
    body(`${day3}T16:30`, key),
  );
  expect(reused.status).toBe(409);
  expect(reused.body.error.code).toBe('CONFLICT');
  // Nouvelle demande légitime, nouvelle clé : créée normalement.
  const fresh = await api(
    secretary,
    'POST',
    '/api/appointments',
    body(`${day3}T16:30`, randomUUID()),
  );
  expect(fresh.status).toBe(201);
  const rows = await sql<{ n: number }>(
    `select count(*)::int as n from appointments
      where clinic_id = $1 and patient_id = $2 and status = 'SCHEDULED'`,
    [clinic.id, patientId],
  );
  expect(rows[0]?.n).toBe(2);
});

test('déplacement vers un créneau libre proposé ; modification concurrente détectée', async () => {
  const created = await api<{ id: string; version: number }>(
    secretary,
    'POST',
    '/api/appointments',
    {
      practitionerId: clinic.practitioners.dentist,
      patientId: ids.f,
      appointmentTypeId: clinic.types.consultation,
      start: `${day2}T16:00`,
    },
  );
  expect(created.status).toBe(201);
  // L'administrateur a la fiche du rendez-vous ouverte…
  const admin = clinic.adminPage;
  const adminPanel = await openAppointment(admin, day2, /Dr Denis, 16:00–16:30 FABREGAS Noé/);
  await expect(adminPanel.getByRole('button', { name: 'Annuler le rendez-vous' })).toBeVisible();
  // … pendant que la secrétaire le déplace vers un créneau libre proposé.
  const panel = await openAppointment(secretary, day2, /Dr Denis, 16:00–16:30 FABREGAS Noé/);
  await panel.getByRole('button', { name: 'Modifier ou déplacer' }).click();
  const free = panel.getByRole('list', { name: 'Créneaux libres ce jour' });
  await expect(free.getByRole('button', { name: '09:00' })).toBeVisible();
  await free.getByRole('button', { name: '09:00' }).click();
  await panel.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  await expect(secretary.getByText('Rendez-vous modifié.')).toBeVisible();
  expect(await appointmentsOf(ids.f)).toMatchObject([
    { local: `${day2} 09:00`, status: 'SCHEDULED' },
  ]);
  // L'annulation par l'administrateur, sur une version dépassée, est refusée.
  await adminPanel.getByRole('button', { name: 'Annuler le rendez-vous' }).click();
  await adminPanel.getByRole('button', { name: "Confirmer l'annulation" }).click();
  await expect(adminPanel.getByRole('alert')).toContainText(
    "vient d'être modifié par quelqu'un d'autre",
  );
  await adminPanel.getByRole('button', { name: 'Recharger' }).click();
  await expect(adminPanel.getByText('09:00')).toBeVisible();
  expect(await appointmentsOf(ids.f)).toMatchObject([{ status: 'SCHEDULED' }]);
});

test('statuts : « honoré » impossible avant l’heure, annulation motivée qui libère le créneau', async () => {
  await book(secretary, {
    patient: PATIENTS.g[0],
    practitioner: 'Dr Denis',
    date: day2,
    time: '11:00',
  });
  await expectSaved(secretary);
  const panel = await openAppointment(secretary, day2, /Dr Denis, 11:00–11:30 GUILLEMOT Rose/);
  await expect(panel.getByRole('button', { name: 'Marquer honoré' })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Marquer patient absent' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Annuler le rendez-vous' }).click();
  await panel.getByLabel("Motif d'annulation (facultatif)").fill('À la demande du patient');
  await panel.getByRole('button', { name: "Confirmer l'annulation" }).click();
  await expect(panel.getByText('Annulé', { exact: true })).toBeVisible();
  // Le créneau libéré se réserve à nouveau.
  await book(secretary, {
    patient: PATIENTS.a[0],
    practitioner: 'Dr Denis',
    date: day2,
    time: '11:00',
  });
  await expectSaved(secretary);
  await secretary.goto(`/agenda?vue=jour&date=${day2}`);
  await expect(secretary.getByRole('button', { name: /11:00–11:30 GUILLEMOT Rose/ })).toHaveCount(
    0,
  );
  await secretary.getByLabel('Afficher les annulés').check();
  await expect(
    secretary.getByRole('button', { name: /11:00–11:30 GUILLEMOT Rose, Consultation, Annulé/ }),
  ).toBeVisible();
  expect(await appointmentsOf(ids.g)).toMatchObject([{ status: 'CANCELLED' }]);
});

test('absence posée sur des rendez-vous existants : signalés, jamais modifiés', async () => {
  const admin = clinic.adminPage;
  await admin.goto('/disponibilites');
  await selectContaining(admin.getByLabel('Praticien'), 'Dr Denis');
  await admin.getByRole('tab', { name: 'Absences et blocages' }).click();
  await admin.getByLabel('Du', { exact: true }).fill(day2);
  await admin.getByLabel('Au (inclus)', { exact: true }).fill(day2);
  await admin.getByLabel('Libellé (facultatif)').fill('Congrès');
  await admin.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const warning = admin.getByRole('alert').filter({ hasText: 'pendant cette absence' });
  await expect(warning).toContainText('2 rendez-vous prévus sont pendant cette absence');
  await expect(warning).toContainText(`${frDate(day2)} 09:00 · FABREGAS Noé`);
  await expect(warning).toContainText(`${frDate(day2)} 11:00 · AUBERTIN Léonie`);
  const rows = await sql<{ n: number }>(
    `select count(*)::int as n from appointments
      where clinic_id = $1 and status = 'SCHEDULED'
        and (start_at at time zone 'Europe/Paris')::date = $2::date`,
    [clinic.id, day2],
  );
  expect(rows[0]?.n).toBe(2);
});

test('changement d’heure : heures du cabinet exactes, poste réglé sur New York', async () => {
  // Semaine du passage à l'heure d'hiver à Paris : New York reste à l'heure d'été jusqu'au
  // dimanche suivant. L'écart entre les deux fuseaux passe de 6 h à 5 h.
  const change = nextDstChange(10, addDays(today, 2));
  const friday = addDays(change, -2);
  const monday = addDays(change, 1);
  for (const [key, date] of [
    ['b', friday],
    ['c', monday],
  ] as const) {
    await book(secretary, {
      patient: PATIENTS[key][0],
      practitioner: 'Hygiéniste',
      date,
      time: '10:00',
    });
    await expectSaved(secretary);
  }
  expect((await appointmentsOf(ids.b)).find((r) => r.local === `${friday} 10:00`)?.utc).toBe(
    `${friday} 08:00`,
  );
  expect((await appointmentsOf(ids.c)).find((r) => r.local === `${monday} 10:00`)?.utc).toBe(
    `${monday} 09:00`,
  );
  for (const [date, name] of [
    [friday, 'BRISSAC Hugo'],
    [monday, 'CASTAGNET Chloé'],
  ] as const) {
    await secretary.goto(`/agenda?vue=jour&date=${date}`);
    await expect(
      secretary.getByRole('button', { name: new RegExp(`Hygiéniste Hélène, 10:00–10:30 ${name}`) }),
    ).toBeVisible();
  }
  // Créneaux libres proposés le lundi : à partir de 9 h, heure du cabinet.
  const panel = await fillAppointment(secretary, {
    patient: PATIENTS.d[0],
    practitioner: 'Hygiéniste',
    date: monday,
    time: '09:00',
  });
  const free = panel.getByRole('list', { name: 'Créneaux libres ce jour' }).getByRole('button');
  await expect(free.first()).toHaveText('09:00');
  expect((await free.allInnerTexts()).slice(0, 4)).toEqual(['09:00', '09:15', '09:30', '10:30']);

  // Passage à l'heure d'été : 2 h 30 n'existe pas ce jour-là, refus explicite.
  const spring = nextDstChange(3, today);
  const refused = await book(secretary, {
    patient: PATIENTS.d[0],
    practitioner: 'Hygiéniste',
    date: spring,
    time: '02:30',
  });
  await expect(refused.getByRole('alert')).toContainText(
    "Cette heure n'existe pas ce jour-là (changement d'heure)",
  );
  await expect(refused.getByRole('button', { name: 'Confirmer quand même' })).toHaveCount(0);
  expect((await appointmentsOf(ids.d)).filter((r) => r.local.startsWith(spring))).toHaveLength(0);
});
