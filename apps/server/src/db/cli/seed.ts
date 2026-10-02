import { loadMigrateConfig } from '../../config/env';
import { generateTemporaryPassword } from '../../modules/auth/password';
import { provisionClinic } from '../admin/clinics';
import { provisionUser } from '../admin/users';
import { createDb, createPool, type Database } from '../client';
import { createPractitionersService } from '../../modules/scheduling/practitioners.service';
import { createSchedulesService } from '../../modules/scheduling/schedules.service';
import { localToday } from '../../modules/scheduling/local-time';

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
  const ids: Partial<Record<'ADMIN' | 'DENTIST' | 'SECRETARY', string>> = {};
  for (const [role, label] of [
    ['ADMIN', 'admin'],
    ['DENTIST', 'dentiste'],
    ['SECRETARY', 'secretaire'],
  ] as const) {
    const password = generateTemporaryPassword();
    const email = `${label}.${suffix}@demo.local`;
    ids[role] = await provisionUser(db, {
      clinicId: clinic.id,
      email,
      fullName: `Démo ${label}`,
      role,
      password,
      mustChangePassword: true,
    });
    console.log(`  ${role.padEnd(9)} ${email}  mot de passe temporaire : ${password}`);
  }
  await seedSchedules(db, clinic.id, ids.ADMIN!, ids.DENTIST!);
  console.log('  Praticiens, horaires et types de rendez-vous de démonstration créés.');
} finally {
  await pool.end();
}

/** Deux praticiens (dont un lié au compte dentiste), leurs horaires et quelques types de soins. */
async function seedSchedules(db: Database, clinicId: string, adminId: string, dentistId: string) {
  const actor = {
    kind: 'USER' as const,
    userId: adminId,
    clinicId,
    role: 'ADMIN' as const,
    isPractitioner: false,
    sessionId: '00000000-0000-7000-8000-000000000000',
  };
  const meta = { ip: null, userAgent: null, requestId: 'seed' };
  const practitioners = createPractitionersService({ db });
  const schedules = createSchedulesService({ db });
  const validFrom = localToday('Europe/Paris', new Date());
  const dentist = await practitioners.createPractitioner(
    actor,
    { displayName: 'Dr Démo', color: '#0ea5e9', userId: dentistId },
    meta,
  );
  await schedules.setSchedule(
    actor,
    dentist.id,
    {
      validFrom,
      basePeriod: null,
      intervals: [1, 2, 3, 4, 5].flatMap((weekday) =>
        weekday === 3
          ? [{ weekday, start: '09:00', end: '12:00' }]
          : [
              { weekday, start: '09:00', end: '12:00' },
              { weekday, start: '14:00', end: '18:00' },
            ],
      ),
    },
    meta,
  );
  const hygienist = await practitioners.createPractitioner(
    actor,
    { displayName: 'Hygiéniste Démo', color: '#10b981' },
    meta,
  );
  await schedules.setSchedule(
    actor,
    hygienist.id,
    {
      validFrom,
      basePeriod: null,
      intervals: [2, 4].map((weekday) => ({ weekday, start: '09:00', end: '17:00' })),
    },
    meta,
  );
  for (const [name, durationMinutes, color] of [
    ['Consultation', 30, '#0ea5e9'],
    ['Détartrage', 30, '#10b981'],
    ['Soin', 45, '#8b5cf6'],
    ['Urgence', 20, '#f43f5e'],
  ] as const) {
    await practitioners.createType(actor, { name, durationMinutes, color }, meta);
  }
}
