import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import {
  API_LOG,
  API_PORT,
  ARTIFACTS,
  BASE_URL,
  DATABASE_NAME,
  ROOT,
  SERVER_DIST,
  WEB_PORT,
  WORKER_LOG,
  databaseUrls,
} from '../support/env';

/*
 * Pile de production pour les tests de bout en bout (lancée par Playwright) :
 *   1. base dédiée recréée, rôles préparés comme au premier déploiement ;
 *   2. migrations appliquées par la commande de production (dist/migrate.js) ;
 *   3. API et worker compilés (dist/main-api.js, dist/main-worker.js) ;
 *   4. interface compilée (apps/web/dist) servie par « vite preview », qui relaie /api vers
 *      l'API comme le fera Caddy en production.
 * Prérequis : pnpm build.
 */

const urls = databaseUrls();
const children: ChildProcess[] = [];

function fail(message: string): never {
  console.error(`[pile e2e] ${message}`);
  for (const child of children) child.kill('SIGTERM');
  process.exit(1);
}

for (const file of [
  path.join(SERVER_DIST, 'main-api.js'),
  path.join(SERVER_DIST, 'migrate.js'),
  path.join(ROOT, 'apps/web/dist/index.html'),
]) {
  if (!existsSync(file)) fail(`build de production absent (${file}) : lancer « pnpm build »`);
}
mkdirSync(ARTIFACTS, { recursive: true });

// 1. Base recréée à chaque exécution.
const admin = new pg.Client({ connectionString: urls.adminUrl });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${admin.escapeIdentifier(DATABASE_NAME)} WITH (FORCE)`);
await admin.end();
const common = { ...process.env, APP_ENV: 'test', LOG_LEVEL: 'info' };
const tsx = path.join(ROOT, 'apps/server/node_modules/.bin/tsx');
const bootstrap = spawnSync(tsx, ['src/db/cli/bootstrap.ts'], {
  cwd: path.join(ROOT, 'apps/server'),
  env: {
    ...common,
    DATABASE_ADMIN_URL: urls.adminUrl,
    DATABASE_NAME,
    DATABASE_OWNER_PASSWORD: urls.ownerPassword,
    DATABASE_APP_PASSWORD: urls.appPassword,
  },
  stdio: 'inherit',
});
if (bootstrap.status !== 0) fail('préparation de la base impossible');

// 2. Migrations : commande de production.
const migrate = spawnSync('node', [path.join(SERVER_DIST, 'migrate.js')], {
  env: { ...common, DATABASE_MIGRATION_URL: urls.ownerUrl },
  stdio: 'inherit',
});
if (migrate.status !== 0) fail('migrations en échec');

// 3. API et worker compilés, rôle applicatif, clé de chiffrement propre à l'exécution.
const serverEnv = {
  ...common,
  DATABASE_URL: urls.appUrl,
  DATA_ENCRYPTION_KEY: process.env.E2E_DATA_ENCRYPTION_KEY ?? fail('clé de chiffrement absente'),
  SESSION_RETENTION_DAYS: '30',
};
function start(name: string, args: string[], env: NodeJS.ProcessEnv, log: string, cwd = ROOT) {
  const child = spawn('node', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = createWriteStream(log);
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);
  child.on('exit', (code, signal) => {
    if (!stopping) fail(`${name} arrêté (code ${code}, signal ${signal})`);
  });
  children.push(child);
  return child;
}
let stopping = false;
start(
  'API',
  [path.join(SERVER_DIST, 'main-api.js')],
  {
    ...serverEnv,
    API_HOST: '127.0.0.1',
    API_PORT: String(API_PORT),
    WEB_ORIGIN: BASE_URL,
    // Toutes les connexions des tests viennent de 127.0.0.1 : limites relevées ici seulement.
    // La limitation elle-même est vérifiée par les tests d'intégration.
    API_RATE_LIMIT_PER_MINUTE: '100000',
    API_RATE_LIMIT_SENSITIVE_PER_MINUTE: '100000',
  },
  API_LOG,
);
const worker = start('worker', [path.join(SERVER_DIST, 'main-worker.js')], serverEnv, WORKER_LOG);
await new Promise<void>((resolve) => {
  let text = '';
  worker.stdout?.on('data', (chunk: Buffer) => {
    text += chunk.toString();
    if (text.includes('worker démarré')) resolve();
  });
});

// 4. Interface compilée.
start(
  'interface',
  [
    path.join(ROOT, 'apps/web/node_modules/vite/bin/vite.js'),
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    String(WEB_PORT),
    '--strictPort',
  ],
  { ...process.env, VITE_DEV_API_URL: `http://127.0.0.1:${API_PORT}` },
  path.join(ARTIFACTS, 'web.log'),
  path.join(ROOT, 'apps/web'),
);
console.log(`[pile e2e] prête : ${BASE_URL} (base ${DATABASE_NAME})`);

function stop() {
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 3_000).unref();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
