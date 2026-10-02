import { parseArgs } from 'node:util';
import { loadMigrateConfig } from '../../config/env';
import { provisionClinic } from '../admin/clinics';
import { createDb, createPool } from '../client';

// Usage : pnpm admin:create-clinic --name "Cabinet X" --timezone Europe/Paris --locale fr-FR --currency EUR --country FR
const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    timezone: { type: 'string' },
    locale: { type: 'string' },
    currency: { type: 'string' },
    country: { type: 'string' },
  },
});
const config = loadMigrateConfig();
const pool = createPool({
  connectionString: config.DATABASE_MIGRATION_URL,
  max: 1,
  applicationName: 'dental-admin',
});
try {
  const clinic = await provisionClinic(createDb(pool), {
    name: values.name ?? '',
    timezone: values.timezone ?? '',
    locale: values.locale ?? '',
    currency: values.currency ?? '',
    countryCode: values.country ?? '',
  });
  console.log(`Cabinet créé : ${clinic.id}`);
} finally {
  await pool.end();
}
