import { loadMigrateConfig } from '../../config/env';
import { checkDatabase } from '../check-database';
import { createPool } from '../client';

// Invariants de sécurité de la base déployée (RLS, rôles, journal), après les migrations.
// Déploiement : bootstrap, migrate puis check-database (docs/operations/deploiement-staging.md).
const config = loadMigrateConfig();
const pool = createPool({
  connectionString: config.DATABASE_MIGRATION_URL,
  max: 1,
  applicationName: 'dental-check',
});
try {
  const problems = await checkDatabase(pool);
  if (problems.length > 0) {
    console.error(`Base non conforme :\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(
      'Base conforme : RLS forcée partout, rôles sans privilège de contournement, journal terse.',
    );
  }
} finally {
  await pool.end();
}
