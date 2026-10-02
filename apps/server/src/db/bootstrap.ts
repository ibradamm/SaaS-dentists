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

export interface BootstrapResult {
  /**
   * Journal du serveur PostgreSQL sans la ligne DETAIL (valeurs des clés en conflit).
   * `false` : réglage refusé par l'hébergeur (compte d'administration sans le droit), à faire
   * dans sa configuration.
   */
  terseServerLog: boolean;
}

export async function bootstrapDatabase(options: BootstrapOptions): Promise<BootstrapResult> {
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
    return { terseServerLog: await terseServerLog(admin, db) };
  } finally {
    await admin.end();
  }
}

/**
 * Une violation de contrainte écrit dans le journal du serveur PostgreSQL une ligne DETAIL qui
 * cite les valeurs en conflit : adresse e-mail, numéro de téléphone d'un patient, numéro de
 * dossier. Ce journal est lu par l'exploitant et l'hébergeur : `terse` supprime cette ligne
 * (le code d'erreur, la contrainte et la requête sans valeurs restent). Paramètre réservé au
 * superutilisateur : refusé sur certains services gérés, où il se règle dans la configuration.
 */
async function terseServerLog(admin: pg.Client, db: string): Promise<boolean> {
  try {
    await admin.query(`ALTER DATABASE ${db} SET log_error_verbosity TO 'terse'`);
    return true;
  } catch {
    return false;
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
