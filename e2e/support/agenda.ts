import { expect, type Locator, type Page } from '@playwright/test';
import { selectContaining } from './app';

export interface Booking {
  patient: string;
  practitioner: string;
  date: string;
  time: string;
  type?: string;
}

/** Remplit le panneau « Nouveau rendez-vous » de l'agenda, sans l'envoyer. */
export async function fillAppointment(page: Page, options: Booking) {
  await page.goto(`/agenda?date=${options.date}`);
  await page.getByRole('button', { name: 'Nouveau rendez-vous' }).click();
  const panel = page.getByRole('complementary', { name: 'Nouveau rendez-vous' });
  await panel.getByLabel('Patient', { exact: true }).fill(options.patient);
  await panel.getByRole('list', { name: 'Patients trouvés' }).getByRole('button').first().click();
  await selectContaining(panel.getByLabel('Praticien'), options.practitioner);
  await panel.getByLabel('Date', { exact: true }).fill(options.date);
  await panel.getByLabel('Heure').fill(options.time);
  if (options.type) await selectContaining(panel.getByLabel('Type de rendez-vous'), options.type);
  return panel;
}

export const saveButton = (panel: Locator) =>
  panel.getByRole('button', { name: 'Enregistrer le rendez-vous' });

/** Prise de rendez-vous par l'interface (panneau « Nouveau rendez-vous » de l'agenda). */
export async function book(page: Page, options: Booking) {
  const panel = await fillAppointment(page, options);
  await saveButton(panel).click();
  return panel;
}

export async function expectSaved(page: Page) {
  await expect(page.getByText('Rendez-vous enregistré.')).toBeVisible();
}

/** Ouvre le détail d'un rendez-vous de la grille du jour. */
export async function openAppointment(page: Page, date: string, label: RegExp) {
  // Vue jour explicite : sur son propre agenda, le dentiste arrive sinon en vue semaine.
  await page.goto(`/agenda?vue=jour&date=${date}`);
  await page.getByRole('button', { name: label }).click();
  return page.getByRole('complementary', { name: 'Rendez-vous' });
}
