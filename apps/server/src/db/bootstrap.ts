import pg from 'pg';
import { DB_APP_ROLE, DB_OWNER_ROLE } from './roles';

/**
 * Préparation initiale d'une base (opération d'administration, exécutée une fois avec un
 * compte superutilisateur ou équivalent) : rôles propriétaire et applicatif, base de données,
 * droits de connexion. Idempotent : réaffirme les attributs des rôles à chaque exécution.
 */
export interface BootstrapOptions {
  adminUrl: string;
  databaseName: string;
  ownerPassword: string;
  appPassword: string;
}

const DATABASE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export async function bootstrapDatabase(options: BootstrapOptions): Promise<void> {
  if (!DATABASE_NAME.test(options.databaseName)) {
    throw new Error('Nom de base invalide');
  }
  const admin = new pg.Client({ connectionString: options.adminUrl });
  await admin.connect();
  try {
    await ensureRole(admin, DB_OWNER_ROLE, options.ownerPassword);
    await ensureRole(admin, DB_APP_ROLE, options.appPassword);
    const db = admin.escapeIdentifier(options.databaseName);
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      options.databaseName,
    ]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${db} OWNER ${DB_OWNER_ROLE} ENCODING 'UTF8'`);
    }
    await admin.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO ${DB_APP_ROLE}`);
    await admin.query(`GRANT ALL ON DATABASE ${db} TO ${DB_OWNER_ROLE}`);
  } finally {
    await admin.end();
  }
}

async function ensureRole(admin: pg.Client, role: string, password: string): Promise<void> {
  const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  const verb = exists.rowCount === 0 ? 'CREATE' : 'ALTER';
  await admin.query(
    `${verb} ROLE ${admin.escapeIdentifier(role)} WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${admin.escapeLiteral(password)}`,
  );
}

/** Dérive l'URL d'un rôle à partir de l'URL d'administration (même hôte et port). */
export function roleUrl(
  adminUrl: string,
  role: string,
  password: string,
  database: string,
): string {
  const url = new URL(adminUrl);
  url.username = role;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}
