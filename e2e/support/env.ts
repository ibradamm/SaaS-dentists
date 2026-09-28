import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Configuration commune au lanceur de la pile (scripts/stack.ts) et aux tests. Les mots de
 * passe viennent de l'environnement (fichier .env en local, variables du job en CI) : aucun
 * n'est écrit sur disque par les tests.
 */
export const ROOT = path.resolve(import.meta.dirname, '../..');
const envFile = path.join(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

export const API_PORT = Number(process.env.E2E_API_PORT ?? 3100);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 4173);
export const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;
export const DATABASE_NAME = process.env.E2E_DATABASE_NAME ?? 'dental_e2e';
export const ARTIFACTS = path.join(ROOT, 'e2e/artifacts');
export const API_LOG = path.join(ARTIFACTS, 'api.log');
export const WORKER_LOG = path.join(ARTIFACTS, 'worker.log');
export const SERVER_DIST = path.join(ROOT, 'apps/server/dist');

function withRole(url: string, user: string, password: string, database: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  u.pathname = `/${database}`;
  return u.toString();
}

export function databaseUrls() {
  const adminUrl = process.env.E2E_DATABASE_ADMIN_URL ?? required('TEST_DATABASE_ADMIN_URL');
  const ownerPassword = required('DATABASE_OWNER_PASSWORD');
  const appPassword = required('DATABASE_APP_PASSWORD');
  const admin = new URL(adminUrl);
  return {
    adminUrl,
    ownerPassword,
    appPassword,
    /** Superutilisateur sur la base de test : contrôles SQL indépendants de l'application. */
    inspectUrl: withRole(
      adminUrl,
      decodeURIComponent(admin.username),
      decodeURIComponent(admin.password),
      DATABASE_NAME,
    ),
    ownerUrl: withRole(adminUrl, 'dental_owner', ownerPassword, DATABASE_NAME),
    appUrl: withRole(adminUrl, 'dental_app', appPassword, DATABASE_NAME),
  };
}
