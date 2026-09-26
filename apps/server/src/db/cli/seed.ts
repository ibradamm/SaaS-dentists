import { loadMigrateConfig } from '../../config/env';
import { provisionClinic } from '../admin/clinics';
import { createDb, createPool } from '../client';

// Données de démonstration pour le développement local uniquement.
const config = loadMigrateConfig();
if (config.APP_ENV !== 'development') {
  console.error(`Seed refusé : APP_ENV=${config.APP_ENV} (autorisé uniquement en development).`);
  process.exit(1);
}
const pool = createPool({
  connectionString: config.DATABASE_MIGRATION_URL,
  max: 1,
  applicationName: 'dental-seed',
});
try {
  const clinic = await provisionClinic(createDb(pool), {
    name: 'Cabinet de démonstration',
    timezone: 'Europe/Paris',
    locale: 'fr-FR',
    currency: 'EUR',
    countryCode: 'FR',
  });
  console.log(`Cabinet de démonstration créé : ${clinic.id}`);
} finally {
  await pool.end();
}
