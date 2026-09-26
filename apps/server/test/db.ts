import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { inject } from 'vitest';
import { provisionClinic, type ProvisionClinicInput } from '../src/db/admin/clinics';
import { createDb, createPool, type Database } from '../src/db/client';

export interface TestDatabase {
  /** Rôle applicatif : celui de l'API et du worker, soumis à la RLS. */
  appPool: pg.Pool;
  appDb: Database;
  /** Rôle propriétaire : préparation des données (création de cabinets). */
  ownerPool: pg.Pool;
  ownerDb: Database;
  close(): Promise<void>;
}

export function openTestDatabase(options: { appPoolMax?: number } = {}): TestDatabase {
  const { appUrl, ownerUrl } = inject('database');
  const appPool = createPool({
    connectionString: appUrl,
    max: options.appPoolMax ?? 4,
    applicationName: 'dental-test-app',
  });
  const ownerPool = createPool({
    connectionString: ownerUrl,
    max: 2,
    applicationName: 'dental-test-owner',
  });
  return {
    appPool,
    appDb: createDb(appPool),
    ownerPool,
    ownerDb: createDb(ownerPool),
    close: async () => {
      await Promise.all([appPool.end(), ownerPool.end()]);
    },
  };
}

export function createTestClinic(db: Database, overrides: Partial<ProvisionClinicInput> = {}) {
  return provisionClinic(db, {
    name: `Cabinet test ${randomBytes(3).toString('hex')}`,
    timezone: 'Europe/Paris',
    locale: 'fr-FR',
    currency: 'EUR',
    countryCode: 'FR',
    ...overrides,
  });
}
