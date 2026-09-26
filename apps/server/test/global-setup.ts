import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { bootstrapDatabase, roleUrl } from '../src/db/bootstrap';
import { deployDatabase } from '../src/db/deploy';
import { DB_APP_ROLE, DB_OWNER_ROLE } from '../src/db/roles';
import { TEST_QUEUES } from './queues';

/**
 * Crée une base jetable pour l'exécution, applique toutes les migrations avec le rôle
 * propriétaire (ce qui vérifie qu'elles s'appliquent sur une base vierge), puis la supprime.
 * Les mots de passe des rôles sont ceux du cluster (fichier .env en local, secrets en CI).
 */
export default async function setup(project: TestProject) {
  const envFile = path.resolve(import.meta.dirname, '../../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const adminUrl = required('TEST_DATABASE_ADMIN_URL');
  const ownerPassword = required('DATABASE_OWNER_PASSWORD');
  const appPassword = required('DATABASE_APP_PASSWORD');
  const databaseName = `dental_test_${randomBytes(4).toString('hex')}`;

  await bootstrapDatabase({ adminUrl, databaseName, ownerPassword, appPassword });
  const ownerUrl = roleUrl(adminUrl, DB_OWNER_ROLE, ownerPassword, databaseName);
  const appUrl = roleUrl(adminUrl, DB_APP_ROLE, appPassword, databaseName);
  await deployDatabase(ownerUrl, { queues: TEST_QUEUES });

  project.provide('database', {
    adminUrl,
    ownerUrl,
    appUrl,
    databaseName,
    ownerPassword,
    appPassword,
  });

  return async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(
        `DROP DATABASE IF EXISTS ${admin.escapeIdentifier(databaseName)} WITH (FORCE)`,
      );
    } finally {
      await admin.end();
    }
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variable ${name} manquante pour les tests d'intégration (voir .env.example).`);
  }
  return value;
}

declare module 'vitest' {
  export interface ProvidedContext {
    database: {
      adminUrl: string;
      ownerUrl: string;
      appUrl: string;
      databaseName: string;
      ownerPassword: string;
      appPassword: string;
    };
  }
}
