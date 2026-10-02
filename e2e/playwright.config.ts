import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './support/env';

// Clé de chiffrement propre à l'exécution, connue du lanceur : la pile la reçoit par
// l'environnement, le contrôle final vérifie qu'elle n'apparaît dans aucun journal, et le test
// de restauration s'en sert pour relire les notes médicales d'une base restaurée. Les
// processus des tests héritent de la même valeur (évaluée une fois par le lanceur).
process.env.E2E_DATA_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

/**
 * Tests de bout en bout du produit (docs/phases/phase-10.md), sur la pile de production
 * (scripts/stack.ts). Aucune relance automatique d'un test en échec : un test instable doit se
 * voir. Poste de travail réglé à New York : l'affichage doit suivre le fuseau du cabinet.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './artifacts/results',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [
    ['list'],
    ['html', { outputFolder: 'artifacts/report', open: 'never' }],
    ['json', { outputFile: 'artifacts/results.json' }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    locale: 'fr-FR',
    timezoneId: 'America/New_York',
    viewport: { width: 1280, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node --import tsx scripts/stack.ts',
    url: `${BASE_URL}/health/ready`,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  globalTeardown: './support/global-teardown.ts',
});
