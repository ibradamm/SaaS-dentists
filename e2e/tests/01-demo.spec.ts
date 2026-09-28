import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  DESKTOP,
  PHONE,
  TABLET,
  api,
  createAdmin,
  createClinic,
  horizontalOverflow,
  login,
  nav,
  selectContaining,
  type Account,
} from '../support/app';
import { book, expectSaved, openAppointment } from '../support/agenda';
import { sql } from '../support/db';
import { addDays, frDate, nextWorkday, todayIn } from '../support/dates';
import { PATIENTS } from '../support/sentinels';

/*
 * Scénario de démonstration (docs/demo.md) : un cabinet neuf, créé par les commandes
 * d'administration de production, jusqu'à son usage quotidien. Tout passe par l'interface,
 * comme le feraient l'administrateur, la secrétaire et le dentiste ; la base est contrôlée par
 * des requêtes SQL indépendantes.
 */

const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];

test.describe.configure({ mode: 'serial' });

test('cabinet neuf → usage quotidien', async ({ browser }) => {
  test.setTimeout(8 * 60_000);
  const today = todayIn();
  const day1 = nextWorkday(today);
  const day2 = nextWorkday(day1);
  let clinicId = '';
  let admin: Account;
  let adminPage: Page;
  const accounts: Partial<Record<'dentist' | 'secretary', Account>> = {};

  await test.step('1. Cabinet créé par l’exploitant (commandes de production)', async () => {
    clinicId = createClinic('Cabinet des Lilas');
    admin = createAdmin(clinicId, 'Anne Martin');
    const [row] = await sql<{ name: string; timezone: string; status: string }>(
      'SELECT name, timezone, status FROM clinics WHERE id = $1',
      [clinicId],
    );
    expect(row).toEqual({ name: 'Cabinet des Lilas', timezone: 'Europe/Paris', status: 'ACTIVE' });
  });

  await test.step('2. Première connexion de l’administratrice : mot de passe, double authentification', async () => {
    adminPage = await (await browser.newContext({ viewport: DESKTOP })).newPage();
    await login(adminPage, admin);
    // Mise en route proposée tant que le cabinet n'est pas prêt.
    const setup = adminPage.getByRole('region', { name: /Mise en route/ });
    await expect(setup).toBeVisible();
    await expect(setup).toContainText(/praticien/i);
  });

  await test.step('3. Profil du cabinet', async () => {
    await nav(adminPage).getByRole('link', { name: 'Cabinet' }).click();
    await adminPage.getByLabel('Adresse', { exact: true }).fill('12 rue des Lilas');
    await adminPage.getByLabel('Code postal').fill('75011');
    await adminPage.getByLabel('Ville').fill('Paris');
    await adminPage.getByLabel('Téléphone').fill('01 45 67 89 10');
    await adminPage.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(adminPage.getByText('Profil enregistré.')).toBeVisible();
  });

  await test.step('4. Comptes du dentiste et de la secrétaire', async () => {
    await nav(adminPage).getByRole('link', { name: 'Utilisateurs' }).click();
    for (const [key, fullName, role, roleLabel] of [
      ['dentist', 'Paul Lefort', 'DENTIST', 'Dentiste'],
      ['secretary', 'Julie Roche', 'SECRETARY', 'Secrétaire'],
    ] as const) {
      const email = `${key}.${Date.now()}@lilas.e2e.test`;
      const form = adminPage.locator('form', { has: adminPage.getByLabel('Nom complet') });
      await form.getByLabel('Nom complet').fill(fullName);
      await form.getByLabel('Adresse e-mail').fill(email);
      await form.getByLabel('Rôle').selectOption({ label: roleLabel });
      await form.getByRole('button', { name: 'Ajouter', exact: true }).click();
      const shown = adminPage.getByText('Mot de passe temporaire pour').locator('..');
      await expect(shown).toContainText(email);
      const password = (await shown.locator('code').innerText()).trim();
      accounts[key] = { email, password, fullName, role, temporary: true };
      await adminPage.getByRole('button', { name: "J'ai transmis le mot de passe" }).click();
    }
    const list = adminPage.getByRole('list', { name: 'Liste des utilisateurs' });
    await expect(list).toContainText('Paul Lefort');
    await expect(list).toContainText('Julie Roche');
  });

  await test.step('5. Praticiens et types de rendez-vous', async () => {
    await adminPage.goto('/cabinet/praticiens');
    await adminPage.getByLabel('Nom affiché').fill('Dr Lefort');
    await selectContaining(adminPage.getByLabel('Compte de connexion lié'), 'Paul Lefort');
    await adminPage.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await expect(adminPage.getByRole('list', { name: 'Praticiens' })).toContainText('Dr Lefort');
    await adminPage.getByLabel('Nom affiché').fill('Hygiéniste Hélène');
    await adminPage.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await expect(adminPage.getByRole('list', { name: 'Praticiens' })).toContainText(
      'Hygiéniste Hélène',
    );

    await adminPage.goto('/cabinet/types-de-rendez-vous');
    for (const [name, minutes] of [
      ['Consultation', '30'],
      ['Détartrage', '45'],
    ] as const) {
      await adminPage.getByLabel('Nom', { exact: true }).fill(name);
      await adminPage.getByLabel('Durée (minutes)').fill(minutes);
      await adminPage.getByRole('button', { name: 'Ajouter', exact: true }).click();
      await expect(adminPage.getByRole('list', { name: 'Types de rendez-vous' })).toContainText(
        name,
      );
    }
  });

  await test.step('6. Horaires du Dr Lefort : du lundi au vendredi, 9 h - 12 h et 14 h - 18 h', async () => {
    await nav(adminPage).getByRole('link', { name: 'Disponibilités' }).click();
    await adminPage.getByLabel('Praticien').selectOption({ label: 'Dr Lefort' });
    await adminPage.getByRole('tab', { name: 'Horaires' }).click();
    await expect(adminPage.getByRole('heading', { name: 'Modifier les horaires' })).toBeVisible();
    for (const day of WEEKDAYS) {
      const group = adminPage.getByRole('group', { name: day });
      await group.getByRole('button', { name: 'Ajouter une plage' }).click();
      await group.getByRole('button', { name: 'Ajouter une plage' }).click();
      await adminPage.getByLabel(`${day}, début de la plage 2`).fill('14:00');
      await adminPage.getByLabel(`${day}, fin de la plage 2`).fill('18:00');
    }
    await adminPage
      .getByRole('button', { name: `Enregistrer à partir du ${frDate(today)}` })
      .click();
    await expect(adminPage.getByText('Horaires enregistrés.')).toBeVisible();
    const [row] = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM working_intervals wi
         JOIN working_schedules ws ON ws.id = wi.schedule_id
         JOIN practitioners p ON p.id = ws.practitioner_id
        WHERE p.clinic_id = $1 AND p.display_name = 'Dr Lefort'`,
      [clinicId],
    );
    expect(row?.n).toBe(10);
  });

  const yesterday = addDays(today, -1);

  await test.step('7. Absence du Dr Lefort (formation) le ' + frDate(day2), async () => {
    await adminPage.getByRole('tab', { name: 'Absences et blocages' }).click();
    await adminPage.getByLabel('Du', { exact: true }).fill(day2);
    await adminPage.getByLabel('Au (inclus)', { exact: true }).fill(day2);
    await adminPage.getByLabel('Libellé (facultatif)').fill('Formation');
    await adminPage.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await expect(adminPage.getByText(`Le ${frDate(day2)}`)).toBeVisible();
  });

  await test.step('8. Import des patients de l’ancien logiciel (CSV)', async () => {
    await nav(adminPage).getByRole('link', { name: 'Patients' }).click();
    await adminPage.getByRole('link', { name: 'Importer un fichier' }).click();
    await adminPage
      .getByLabel('Choisir le fichier')
      .setInputFiles(path.join(import.meta.dirname, '../fixtures/patients.csv'));
    await expect(adminPage.getByLabel('Nom (obligatoire)', { exact: true })).toBeVisible();
    await adminPage.getByRole('button', { name: 'Vérifier les 6 lignes' }).click();
    // 4 fiches valides ; une ligne sans prénom ; un doublon dans le fichier.
    await adminPage.getByRole('button', { name: 'Importer 4 patient(s)' }).click();
    await expect(adminPage.getByText(/4 patient\(s\) importé\(s\)/)).toBeVisible();
    const [row] = await sql<{ n: number; at: string }>(
      `SELECT (SELECT count(*)::int FROM patients
                WHERE clinic_id = $1 AND created_source = 'IMPORT') AS n,
              (SELECT to_char(created_at AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY HH24:MI')
                 FROM import_batches WHERE clinic_id = $1) AS at`,
      [clinicId],
    );
    expect(row?.n).toBe(4);
    // Heure de l'import dans le fuseau du cabinet, pas celui du poste (bug corrigé en Phase 10).
    await expect(adminPage.getByText(`patients.csv · ${row?.at}`)).toBeVisible();
  });

  let secretary: Page;
  await test.step('9. Secrétaire (tablette) : première connexion, fiche patient', async () => {
    secretary = await (await browser.newContext({ viewport: TABLET })).newPage();
    await login(secretary, accounts.secretary!);
    await nav(secretary).getByRole('link', { name: 'Patients' }).click();
    await secretary.getByRole('link', { name: 'Nouveau patient' }).click();
    const [last, first] = PATIENTS.f;
    await secretary.getByLabel('Nom', { exact: true }).fill(last);
    await secretary.getByLabel('Prénom', { exact: true }).fill(first);
    await secretary.getByLabel('Date de naissance', { exact: true }).fill('1992-04-18');
    await secretary.getByLabel('Téléphone', { exact: true }).fill('06 55 44 33 22');
    await secretary.getByRole('button', { name: 'Créer la fiche' }).click();
    await expect(
      secretary.getByRole('heading', { name: `${last.toUpperCase()} ${first}` }),
    ).toBeVisible();
  });

  await test.step('10. Rendez-vous : prise, conflit, hors horaires, absence, passé', async () => {
    const [a, b, c, d] = [PATIENTS.a, PATIENTS.b, PATIENTS.c, PATIENTS.d];
    await book(secretary, { patient: a[0], practitioner: 'Dr Lefort', date: day1, time: '10:00' });
    await expectSaved(secretary);
    // Créneau déjà pris : refus, rien d'enregistré.
    let panel = await book(secretary, {
      patient: b[0],
      practitioner: 'Dr Lefort',
      date: day1,
      time: '10:15',
    });
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Confirmer quand même' })).toHaveCount(0);
    // Hors horaires : enregistré seulement après confirmation explicite.
    panel = await book(secretary, {
      patient: b[0],
      practitioner: 'Dr Lefort',
      date: day1,
      time: '19:00',
    });
    await panel.getByRole('button', { name: 'Confirmer quand même' }).click();
    await expectSaved(secretary);
    // Pendant l'absence : refusé, aucune confirmation possible.
    panel = await book(secretary, {
      patient: b[0],
      practitioner: 'Dr Lefort',
      date: day2,
      time: '10:00',
    });
    await expect(panel.getByRole('alert')).toContainText(/absen/i);
    await expect(panel.getByRole('button', { name: 'Confirmer quand même' })).toHaveCount(0);
    // Hier (saisie a posteriori) : confirmation, puis honoré / absent par le dentiste.
    for (const [patient, time] of [
      [c[0], '10:00'],
      [d[0], '11:00'],
    ] as const) {
      panel = await book(secretary, { patient, practitioner: 'Dr Lefort', date: yesterday, time });
      await panel.getByRole('button', { name: 'Confirmer quand même' }).click();
      await expectSaved(secretary);
    }
    const rows = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM appointments WHERE clinic_id = $1 AND status = 'SCHEDULED'`,
      [clinicId],
    );
    expect(rows[0]?.n).toBe(4);
  });

  let dentist: Page;
  await test.step('11. Dentiste (téléphone) : première connexion, rendez-vous d’hier honoré et absent', async () => {
    dentist = await (await browser.newContext({ viewport: PHONE })).newPage();
    await login(dentist, accounts.dentist!);
    let details = await openAppointment(dentist, yesterday, /Dr Lefort, 10:00/);
    await details.getByRole('button', { name: 'Marquer honoré' }).click();
    await expect(details.getByRole('button', { name: 'Remettre à « Prévu »' })).toBeVisible();
    details = await openAppointment(dentist, yesterday, /Dr Lefort, 11:00/);
    await details.getByRole('button', { name: 'Marquer patient absent' }).click();
    await expect(details.getByText('Patient absent', { exact: true })).toBeVisible();
    expect(await horizontalOverflow(dentist)).toBeLessThanOrEqual(0);
  });

  await test.step('12. Encaissement : acte, paiement partiel, complément, annulation motivée', async () => {
    const details = await openAppointment(dentist, yesterday, /Dr Lefort, 10:00/);
    await details.getByRole('link', { name: 'Encaisser' }).click();
    const section = dentist.getByRole('region', { name: 'Paiements' });
    const form = dentist.getByRole('form', { name: 'Nouvel acte à encaisser' });
    await form.getByLabel('Montant dû (EUR)').fill('60');
    await form.getByLabel('Montant encaissé (EUR)').fill('20');
    await form.getByLabel('Moyen de paiement').selectOption('CASH');
    await form.getByRole('button', { name: /^Enregistrer et encaisser 20,00/ }).click();
    await expect(section.getByText(/Restant dû : 40,00.€/)).toBeVisible();
    // Complément par carte, puis annulé (erreur de moyen de paiement) et réglé par chèque.
    for (const method of ['CARD', 'CHECK']) {
      await section.getByRole('button', { name: 'Encaisser : Consultation' }).click();
      const pay = dentist.getByRole('form', { name: 'Encaisser : Consultation' });
      await pay.getByLabel('Moyen de paiement').selectOption(method);
      await pay.getByRole('button', { name: /^Encaisser 40,00/ }).click();
      await expect(section.getByText(/Paiement de 40,00.€ encaissé/)).toBeVisible();
      if (method === 'CARD') {
        await section.getByRole('button', { name: /^Annuler le paiement de 40,00/ }).click();
        await section.getByLabel('Motif (obligatoire)').fill('Erreur de moyen de paiement');
        await section.getByRole('button', { name: 'Confirmer l’annulation du paiement' }).click();
        await expect(section.getByText(/Paiement de 40,00.€ annulé\./)).toBeVisible();
      }
    }
    const [paid] = await sql<{ recorded: number; voided: number }>(
      `SELECT coalesce(sum(amount_cents) FILTER (WHERE status = 'RECORDED'), 0)::int AS recorded,
              coalesce(sum(amount_cents) FILTER (WHERE status = 'VOIDED'), 0)::int AS voided
         FROM payments WHERE clinic_id = $1`,
      [clinicId],
    );
    expect(paid).toEqual({ recorded: 6000, voided: 4000 });
  });

  await test.step('13. Secrétaire : acte partiellement payé, liste « À encaisser »', async () => {
    const [last, first] = PATIENTS.b;
    await secretary.goto('/patients');
    await secretary
      .getByRole('link', { name: new RegExp(`${last.toUpperCase()} ${first}`) })
      .click();
    const section = secretary.getByRole('region', { name: 'Paiements' });
    await section.getByRole('button', { name: 'Nouvel acte à encaisser' }).click();
    const form = secretary.getByRole('form', { name: 'Nouvel acte à encaisser' });
    await form.getByLabel('Libellé').fill('Détartrage');
    await form.getByLabel('Montant dû (EUR)').fill('45');
    await form.getByLabel('Montant encaissé (EUR)').fill('15');
    await form.getByLabel('Moyen de paiement').selectOption('CASH');
    await form.getByRole('button', { name: /^Enregistrer et encaisser 15,00/ }).click();
    await expect(section.getByText(/Restant dû : 30,00.€/)).toBeVisible();
    await nav(secretary).getByRole('link', { name: 'À encaisser' }).click();
    await expect(
      secretary.getByRole('list', { name: 'Patients avec un restant dû' }),
    ).toContainText(/BRISSAC Hugo.*30,00.€/s);
  });

  await test.step('14. Statistiques du dentiste = calcul SQL indépendant', async () => {
    await dentist.setViewportSize(DESKTOP);
    await dentist.goto(`/statistiques?du=${yesterday}&au=${today}`);
    const [expected] = await sql<{ cents: number; completed: number }>(
      `SELECT (SELECT coalesce(sum(amount_cents), 0)::int FROM payments
                WHERE clinic_id = $1 AND status = 'RECORDED') AS cents,
              (SELECT count(*)::int FROM appointments
                WHERE clinic_id = $1 AND status = 'COMPLETED') AS completed`,
      [clinicId],
    );
    expect(expected).toEqual({ cents: 7500, completed: 1 });
    const tile = (label: string) => dentist.locator('dt', { hasText: label }).locator('..');
    await expect(tile('Revenus encaissés')).toContainText(/75,00.€/);
    await expect(tile('Rendez-vous honorés')).toContainText('1');
    await expect(tile('Taux de présence')).toContainText(/50.%/);
  });

  await test.step('15. Journal : qui a fait quoi', async () => {
    await nav(adminPage).getByRole('link', { name: 'Journal' }).click();
    await adminPage.getByLabel('Action').selectOption({ label: 'Paiement annulé' });
    await adminPage.getByRole('button', { name: 'Filtrer' }).click();
    const entries = adminPage
      .getByRole('list', { name: 'Entrées du journal' })
      .getByRole('listitem');
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toContainText('Paul Lefort');
    await expect(entries.first()).toContainText(PATIENTS.c.join(' '));
    await adminPage.getByLabel('Action').selectOption({ label: 'Import validé' });
    await adminPage.getByRole('button', { name: 'Filtrer' }).click();
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toContainText('Anne Martin');
  });

  await test.step('16. Usage quotidien : recherche rapide d’un patient, fiche', async () => {
    await secretary.goto('/');
    await secretary.getByPlaceholder('Rechercher un patient…').fill(PATIENTS.c[0].slice(0, 6));
    await secretary
      .getByRole('link', { name: new RegExp(PATIENTS.c[0].toUpperCase()) })
      .first()
      .click();
    await expect(
      secretary.getByRole('heading', { name: `${PATIENTS.c[0].toUpperCase()} ${PATIENTS.c[1]}` }),
    ).toBeVisible();
    expect(await horizontalOverflow(secretary)).toBeLessThanOrEqual(0);
  });
  void api;
});
