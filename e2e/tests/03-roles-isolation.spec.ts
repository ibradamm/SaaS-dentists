import { expect, test, type Page } from '@playwright/test';
import { api, createPatient, nav, setupClinic, signIn, type Clinic } from '../support/app';
import { todayIn } from '../support/dates';
import { MEDICAL_NOTE, PATIENTS } from '../support/sentinels';

/*
 * Rôles et isolation vus depuis le navigateur : menus, pages refusées, appels directs refusés
 * par le serveur même en contournant l'interface, notes médicales, et un second cabinet qui ne
 * voit rien du premier.
 */
let clinic: Clinic;
let pages: Record<'ADMIN' | 'DENTIST' | 'SECRETARY', Page>;
let patientId = '';

test.beforeAll(async ({ browser }) => {
  clinic = await setupClinic(browser, 'Cabinet des Rôles');
  patientId = await createPatient(clinic.adminPage, ...PATIENTS.a);
  pages = {
    ADMIN: clinic.adminPage,
    DENTIST: await signIn(browser, clinic.dentist),
    SECRETARY: await signIn(browser, clinic.secretary),
  };
});

const MENUS = {
  SECRETARY: ["Aujourd'hui", 'Agenda', 'Patients', 'À encaisser', 'Statistiques', 'Disponibilités'],
  DENTIST: [
    "Aujourd'hui",
    'Agenda',
    'Patients',
    'À encaisser',
    'Revenus',
    'Statistiques',
    'Disponibilités',
  ],
  ADMIN: [
    "Aujourd'hui",
    'Agenda',
    'Patients',
    'À encaisser',
    'Revenus',
    'Statistiques',
    'Disponibilités',
    'Cabinet',
    'Utilisateurs',
    'Journal',
  ],
} as const;

const FORBIDDEN_PAGES = {
  SECRETARY: ['/utilisateurs', '/cabinet', '/revenus', '/journal', '/patients/import'],
  DENTIST: ['/utilisateurs', '/cabinet', '/journal', '/patients/import'],
  ADMIN: [],
} as const;

for (const role of ['ADMIN', 'DENTIST', 'SECRETARY'] as const) {
  test(`${role} : menu et pages selon ses permissions`, async () => {
    const page = pages[role];
    await page.goto('/');
    await expect(nav(page).getByRole('link')).toHaveText([...MENUS[role]]);
    for (const url of FORBIDDEN_PAGES[role]) {
      await page.goto(url);
      await expect(page.getByText("Vous n'avez pas accès à cette page."), url).toBeVisible();
    }
  });
}

test('appels directs refusés par le serveur, même en contournant l’interface', async () => {
  const today = todayIn();
  const cases: [keyof typeof pages, string, string, unknown?][] = [
    ['SECRETARY', 'GET', `/api/patients/${patientId}/medical-notes`],
    ['ADMIN', 'GET', `/api/patients/${patientId}/medical-notes`],
    ['SECRETARY', 'GET', `/api/finance/revenue?from=${today}&to=${today}`],
    ['SECRETARY', 'GET', `/api/audit-logs?from=${today}&to=${today}`],
    ['SECRETARY', 'GET', '/api/users'],
    ['SECRETARY', 'PATCH', '/api/clinic', { name: 'Détourné' }],
    ['DENTIST', 'GET', '/api/users'],
    ['DENTIST', 'GET', `/api/audit-logs?from=${today}&to=${today}`],
    [
      'DENTIST',
      'POST',
      '/api/imports',
      { kind: 'PATIENTS', fileName: 'x.csv', totalRows: 1, dateFormat: 'DD/MM/YYYY' },
    ],
  ];
  for (const [role, method, url, body] of cases) {
    const res = await api<{ error: { code: string } }>(pages[role], method, url, body);
    expect({ role, url, status: res.status }).toEqual({ role, url, status: 403 });
    expect(res.body.error.code).toBe('FORBIDDEN');
  }
});

test('notes médicales : le dentiste oui, la secrétaire non, l’administrateur seulement s’il est praticien, heure du cabinet', async () => {
  const dentist = pages.DENTIST;
  await dentist.goto(`/patients/${patientId}`);
  await dentist.getByRole('button', { name: 'Afficher les notes médicales' }).click();
  await dentist.getByLabel('Nouvelle note').fill(MEDICAL_NOTE);
  await dentist.getByRole('button', { name: 'Ajouter la note' }).click();
  await expect(dentist.getByText(MEDICAL_NOTE)).toBeVisible();
  await expect(dentist.getByText(/Denis Dentiste · \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/)).toBeVisible();
  const secretary = pages.SECRETARY;
  await secretary.goto(`/patients/${patientId}`);
  await expect(
    secretary.getByRole('heading', { name: `${PATIENTS.a[0].toUpperCase()} ${PATIENTS.a[1]}` }),
  ).toBeVisible();
  await expect(secretary.getByRole('heading', { name: 'Notes médicales' })).toHaveCount(0);
  await expect(secretary.getByText(MEDICAL_NOTE)).toHaveCount(0);

  // E18 : l'administrateur n'y accède que si son compte est lié à un praticien actif.
  const admin = pages.ADMIN;
  await admin.goto(`/patients/${patientId}`);
  await expect(
    admin.getByRole('heading', { name: `${PATIENTS.a[0].toUpperCase()} ${PATIENTS.a[1]}` }),
  ).toBeVisible();
  await expect(admin.getByRole('heading', { name: 'Notes médicales' })).toHaveCount(0);
  const me = await api<{ user: { id: string } }>(admin, 'GET', '/api/auth/me');
  const linked = await api(admin, 'POST', '/api/practitioners', {
    displayName: 'Dr Gérante',
    color: '#f97316',
    userId: me.body.user.id,
  });
  expect(linked.status).toBe(201);
  await admin.reload();
  await admin.getByRole('button', { name: 'Afficher les notes médicales' }).click();
  await expect(admin.getByText(MEDICAL_NOTE)).toBeVisible();
});

test('second cabinet : ne voit ni ne modifie rien du premier', async ({ browser }) => {
  const other = await setupClinic(browser, 'Cabinet Étanche');
  const page = other.adminPage;
  // Fiche du premier cabinet par son adresse : introuvable.
  await page.goto(`/patients/${patientId}`);
  await expect(page.getByRole('alert')).toContainText(/introuvable/i);
  await expect(page.getByText(PATIENTS.a[0].toUpperCase())).toHaveCount(0);
  // Recherche, liste, agenda : rien du premier cabinet.
  await page.getByPlaceholder('Rechercher un patient…').fill(PATIENTS.a[0].slice(0, 5));
  await page.goto('/patients');
  await expect(page.getByRole('heading', { name: 'Patients' })).toBeVisible();
  await expect(page.getByText(PATIENTS.a[0].toUpperCase())).toHaveCount(0);
  // Écritures sur les données du premier cabinet : 404, aucune modification.
  const writes = [
    await api(page, 'PATCH', `/api/patients/${patientId}`, { version: 1, lastName: 'Intrus' }),
    await api(page, 'POST', `/api/patients/${patientId}/archive`, { version: 1 }),
    await api(page, 'POST', `/api/appointments`, {
      practitionerId: clinic.practitioners.dentist,
      patientId,
      appointmentTypeId: clinic.types.consultation,
      start: `${todayIn()}T10:00`,
      allowOutsideAvailability: true,
    }),
  ];
  expect(writes.map((w) => w.status)).toEqual([404, 404, 404]);
  const still = await api<{ lastName: string; status: string }>(
    clinic.adminPage,
    'GET',
    `/api/patients/${patientId}`,
  );
  expect(still.body).toMatchObject({ lastName: PATIENTS.a[0], status: 'ACTIVE' });
  await page.context().close();
});
