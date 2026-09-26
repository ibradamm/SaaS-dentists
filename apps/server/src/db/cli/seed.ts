import { loadMigrateConfig } from '../../config/env';
import { generateTemporaryPassword } from '../../modules/auth/password';
import { provisionClinic } from '../admin/clinics';
import { provisionUser } from '../admin/users';
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
  const db = createDb(pool);
  const clinic = await provisionClinic(db, {
    name: 'Cabinet de démonstration',
    timezone: 'Europe/Paris',
    locale: 'fr-FR',
    currency: 'EUR',
    countryCode: 'FR',
  });
  const suffix = clinic.id.slice(-6);
  console.log(`Cabinet de démonstration créé : ${clinic.id}`);
  for (const [role, label] of [
    ['ADMIN', 'admin'],
    ['DENTIST', 'dentiste'],
    ['SECRETARY', 'secretaire'],
  ] as const) {
    const password = generateTemporaryPassword();
    const email = `${label}.${suffix}@demo.local`;
    await provisionUser(db, {
      clinicId: clinic.id,
      email,
      fullName: `Démo ${label}`,
      role,
      password,
      mustChangePassword: true,
    });
    console.log(`  ${role.padEnd(9)} ${email}  mot de passe temporaire : ${password}`);
  }
} finally {
  await pool.end();
}
