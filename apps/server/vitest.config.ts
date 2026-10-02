import { defineConfig } from 'vitest/config';

// Tâche de conservation : elle purge tous les cabinets de sa base avec l'horloge réelle. Ses
// tests ont leur propre base (un globalSetup par projet), sinon elle annulerait les brouillons
// d'import, datés par une horloge de test passée, d'autres fichiers exécutés en parallèle.
const RETENTION_TESTS = 'src/jobs/__tests__/retention.int.test.ts';

const integration = {
  globalSetup: ['test/global-setup.ts'],
  testTimeout: 30_000,
  hookTimeout: 60_000,
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.int.test.ts'],
        },
      },
      {
        // Tests d'intégration : base PostgreSQL réelle et jetable, rôle applicatif réel.
        test: {
          name: 'integration',
          include: ['src/**/*.int.test.ts'],
          exclude: [RETENTION_TESTS],
          ...integration,
        },
      },
      {
        test: { name: 'integration-retention', include: [RETENTION_TESTS], ...integration },
      },
    ],
  },
});
