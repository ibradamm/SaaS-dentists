import { parseArgs } from 'node:util';
import { loadMigrateConfig } from '../../config/env';
import { resetUserMfa } from '../admin/users';
import { createDb, createPool } from '../client';

// Usage : pnpm admin:reset-mfa --email admin@cabinet.fr
// Recours quand le seul administrateur a perdu son application d'authentification.
const { values } = parseArgs({ options: { email: { type: 'string' } } });
const config = loadMigrateConfig();
const pool = createPool({
  connectionString: config.DATABASE_MIGRATION_URL,
  max: 1,
  applicationName: 'dental-admin',
});
try {
  const done = await resetUserMfa(createDb(pool), values.email ?? '');
  console.log(
    done ? 'Double authentification réinitialisée, sessions fermées.' : 'Compte introuvable.',
  );
  if (!done) process.exitCode = 1;
} finally {
  await pool.end();
}
