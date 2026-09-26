// Prépare un .env de développement : copie .env.example et génère une clé de chiffrement.
// Ne modifie jamais un .env existant.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (existsSync('.env')) {
  console.log('.env existe déjà : aucune modification.');
  process.exit(0);
}
const content = readFileSync('.env.example', 'utf8').replace(
  /^DATA_ENCRYPTION_KEY=$/m,
  `DATA_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
);
writeFileSync('.env', content, { mode: 0o600 });
console.log('.env créé (clé de chiffrement de développement générée).');
