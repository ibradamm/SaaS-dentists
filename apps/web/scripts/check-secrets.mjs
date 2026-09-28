/*
 * Aucun secret dans le build de l'interface (servi à tous les navigateurs) : ni valeur secrète
 * de l'environnement courant (mots de passe des rôles, clé de chiffrement, DSN), ni motif de clé
 * connue (URL de base de données, clé privée, clé Stripe secrète, service_role). L'interface ne
 * lit aucune variable d'environnement ; ce contrôle en garantit la conséquence. À lancer après
 * `vite build` (CI : étape « Budget du chargement initial »).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// En local, les valeurs viennent du .env de développement ; en CI, des variables du job.
const envFile = path.resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const dist = path.resolve(import.meta.dirname, '../dist');
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else files.push(full);
  }
};
walk(dist);

const SECRET_VARIABLES = [
  'DATA_ENCRYPTION_KEY',
  'DATABASE_OWNER_PASSWORD',
  'DATABASE_APP_PASSWORD',
  'DATABASE_URL',
  'DATABASE_MIGRATION_URL',
  'DATABASE_ADMIN_URL',
  'TEST_DATABASE_ADMIN_URL',
  'SENTRY_DSN',
];
const PATTERNS = [
  /postgres(?:ql)?:\/\/[^\s"']+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk_(?:live|test)_[0-9a-zA-Z]{10,}/,
  /\bservice_role\b/,
  /https:\/\/[0-9a-f]{16,}@[^\s"']*sentry\.io/i,
];

const found = [];
for (const file of files) {
  const text = readFileSync(file, 'latin1');
  for (const name of SECRET_VARIABLES) {
    const value = process.env[name];
    if (value && value.length >= 8 && text.includes(value)) {
      found.push(`${path.relative(dist, file)} : valeur de ${name}`);
    }
  }
  for (const pattern of PATTERNS) {
    if (pattern.test(text)) found.push(`${path.relative(dist, file)} : motif ${pattern.source}`);
  }
}
const checked = SECRET_VARIABLES.filter((n) => process.env[n]).length;
console.log(
  `Secrets dans le build : ${files.length} fichiers, ${checked} valeurs d'environnement et ${PATTERNS.length} motifs cherchés.`,
);
if (found.length > 0) {
  console.error(`Secret trouvé dans le build de l'interface :\n${found.join('\n')}`);
  process.exit(1);
}
