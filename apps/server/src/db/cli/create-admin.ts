import { parseArgs } from 'node:util';
import { loadMigrateConfig } from '../../config/env';
import { generateTemporaryPassword } from '../../modules/auth/password';
import { provisionUser } from '../admin/users';
import { createDb, createPool } from '../client';

// Usage : pnpm admin:create-admin --clinic <id> --email admin@cabinet.fr --name "Nom Prénom"
// Le mot de passe temporaire est affiché une seule fois ; il doit être changé à la première
// connexion, puis la double authentification doit être configurée.
const { values } = parseArgs({
  options: { clinic: { type: 'string' }, email: { type: 'string' }, name: { type: 'string' } },
});
const config = loadMigrateConfig();
const pool = createPool({
  connectionString: config.DATABASE_MIGRATION_URL,
  max: 1,
  applicationName: 'dental-admin',
});
try {
  const temporaryPassword = generateTemporaryPassword();
  const id = await provisionUser(createDb(pool), {
    clinicId: values.clinic ?? '',
    email: values.email ?? '',
    fullName: values.name ?? '',
    role: 'ADMIN',
    password: temporaryPassword,
    mustChangePassword: true,
  });
  console.log(`Administrateur créé : ${id}`);
  console.log(`Mot de passe temporaire (affiché une seule fois) : ${temporaryPassword}`);
} finally {
  await pool.end();
}
