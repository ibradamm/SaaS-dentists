import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { api, createPatient, nav, setupClinic, signIn, type Clinic } from '../support/app';
import { todayIn } from '../support/dates';
import { sql } from '../support/db';
import { PATIENTS } from '../support/sentinels';

/*
 * Fiches patients et reprise de l'ancien logiciel : doublons signalés, double envoi, réponse
 * perdue, import XLSX (dates et téléphones d'Excel), annulation d'un import qui conserve les
 * fiches déjà utilisées, et import réservé à l'administrateur.
 */
let clinic: Clinic;
let secretary: Page;

test.beforeAll(async ({ browser }) => {
  clinic = await setupClinic(browser, 'Cabinet des Fiches');
  secretary = await signIn(browser, clinic.secretary);
});

async function patientsNamed(lastName: string) {
  return sql<{ id: string; first: string; birth: string | null; source: string }>(
    `select id, first_name as first, birth_date::text as birth, created_source as source
       from patients where clinic_id = $1 and last_name = $2 and status = 'ACTIVE'
      order by created_at`,
    [clinic.id, lastName],
  );
}

async function fillNewPatient(page: Page, lastName: string, firstName: string) {
  await page.goto('/patients/nouveau');
  await page.getByLabel('Nom', { exact: true }).fill(lastName);
  await page.getByLabel('Prénom', { exact: true }).fill(firstName);
}

test('homonyme signalé avant la création ; « Créer quand même » crée une seconde fiche', async () => {
  const [last, first] = PATIENTS.a;
  await createPatient(clinic.adminPage, last, first);
  await fillNewPatient(secretary, last, first);
  await secretary.getByRole('button', { name: 'Créer la fiche' }).click();
  await expect(secretary.getByText('Patient(s) similaire(s) déjà enregistré(s) :')).toBeVisible();
  await expect(
    secretary.getByRole('link', { name: `${last.toUpperCase()} ${first}` }),
  ).toBeVisible();
  expect(await patientsNamed(last)).toHaveLength(1);
  await secretary.getByRole('button', { name: 'Créer quand même' }).click();
  await expect(
    secretary.getByRole('heading', { name: `${last.toUpperCase()} ${first}` }),
  ).toBeVisible();
  expect(await patientsNamed(last)).toHaveLength(2);
});

test('double clic sur « Créer la fiche » : une seule fiche (bug corrigé en Phase 10)', async () => {
  const [last, first] = PATIENTS.b;
  await fillNewPatient(secretary, last, first);
  await secretary.getByRole('button', { name: 'Créer la fiche' }).dblclick();
  await expect(
    secretary.getByRole('heading', { name: `${last.toUpperCase()} ${first}` }),
  ).toBeVisible();
  // Laisse à un éventuel second envoi le temps d'aboutir avant de compter.
  await secretary.waitForLoadState('networkidle');
  expect(await patientsNamed(last)).toHaveLength(1);
});

test('réponse perdue à la création : le nouvel essai montre la fiche déjà créée', async () => {
  const [last, first] = PATIENTS.c;
  let lose = true;
  await secretary.route(
    (url) => url.pathname === '/api/patients',
    async (route) => {
      if (route.request().method() !== 'POST' || !lose) return route.fallback();
      lose = false;
      await route.fetch();
      await route.abort('connectionreset');
    },
  );
  await fillNewPatient(secretary, last, first);
  await secretary.getByRole('button', { name: 'Créer la fiche' }).click();
  await expect(secretary.getByRole('alert')).toContainText('Vérifiez votre connexion');
  // Nouvel essai : la recherche de doublons trouve la fiche enregistrée malgré l'erreur.
  await secretary.getByRole('button', { name: 'Créer la fiche' }).click();
  await expect(secretary.getByText('Patient(s) similaire(s) déjà enregistré(s) :')).toBeVisible();
  await secretary.unrouteAll();
  expect(await patientsNamed(last)).toHaveLength(1);
});

test('import XLSX : dates et téléphones d’Excel, ligne invalide signalée, historique', async () => {
  const admin = clinic.adminPage;
  await nav(admin).getByRole('link', { name: 'Patients' }).click();
  await admin.getByRole('link', { name: 'Importer un fichier' }).click();
  await admin
    .getByLabel('Choisir le fichier')
    .setInputFiles(path.join(import.meta.dirname, '../fixtures/patients.xlsx'));
  await expect(admin.getByLabel('Nom (obligatoire)', { exact: true })).toBeVisible();
  await admin.getByRole('button', { name: 'Vérifier les 4 lignes' }).click();
  await admin.getByRole('button', { name: 'Importer 3 patient(s)' }).click();
  await expect(admin.getByText(/3 patient\(s\) importé\(s\)/)).toBeVisible();
  const rows = await sql<{ last: string; birth: string | null; phones: string | null }>(
    `select p.last_name as last, p.birth_date::text as birth,
            string_agg(c.phone_e164, ',') as phones
       from patients p left join patient_contacts c on c.patient_id = p.id
      where p.clinic_id = $1 and p.created_source = 'IMPORT'
      group by p.id order by p.last_name`,
    [clinic.id],
  );
  expect(rows).toEqual([
    { last: 'Delpierre', birth: '2015-01-03', phones: '+33612345678' },
    { last: 'Esquirol', birth: '1992-07-14', phones: '+33612345678' },
    { last: 'Guillemot', birth: '1988-11-30', phones: '+33612345678' },
  ]);
});

test('annulation d’import : fiches non modifiées supprimées, fiche déjà utilisée conservée', async () => {
  const admin = clinic.adminPage;
  const [used] = await patientsNamed(PATIENTS.d[0]);
  const booked = await api(admin, 'POST', '/api/appointments', {
    practitionerId: clinic.practitioners.dentist,
    patientId: used?.id,
    appointmentTypeId: clinic.types.consultation,
    start: `${todayIn()}T23:00`,
    allowOutsideAvailability: true,
  });
  expect(booked.status).toBe(201);
  const dialogs: string[] = [];
  admin.on('dialog', (d) => dialogs.push(d.message()));
  await admin.goto('/patients/import');
  const item = admin.getByRole('listitem').filter({ hasText: 'patients.xlsx' });
  await item.getByRole('button', { name: 'Annuler cet import' }).click();
  await expect(item).toContainText('supprimé(s)');
  expect(dialogs).toContain(
    "2 patient(s) supprimé(s). 1 patient(s) modifié(s) depuis l'import ont été conservés.",
  );
  expect(await patientsNamed(PATIENTS.e[0])).toHaveLength(0);
  expect(await patientsNamed(PATIENTS.g[0])).toHaveLength(0);
  expect(await patientsNamed(PATIENTS.d[0])).toHaveLength(1);
});

test('secrétaire : import refusé (interface et serveur) ; recherche sans accents', async () => {
  await secretary.goto('/patients');
  await expect(secretary.getByRole('link', { name: 'Importer un fichier' })).toHaveCount(0);
  await secretary.goto('/patients/import');
  await expect(secretary.getByText("Vous n'avez pas accès à cette page.")).toBeVisible();
  const res = await api(secretary, 'POST', '/api/imports', {
    kind: 'PATIENTS',
    fileName: 'x.csv',
    totalRows: 1,
    dateFormat: 'DD/MM/YYYY',
  });
  expect(res.status).toBe(403);
  // « mael » trouve « Maël ».
  await secretary.goto('/patients');
  await secretary.getByRole('searchbox', { name: /^Rechercher \(nom/ }).fill('mael');
  const list = secretary.getByRole('list', { name: 'Liste des patients' });
  await expect(list.getByRole('link', { name: /DELPIERRE Maël/ })).toBeVisible();
  await expect(list.getByRole('link')).toHaveCount(1);
});
