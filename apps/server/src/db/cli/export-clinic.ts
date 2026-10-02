import { existsSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadExportConfig } from '../../config/env';
import { createSecretBox, parseEncryptionKey } from '../../lib/secret-box';
import { exportClinicData } from '../admin/clinic-data';
import { createDb, createPool } from '../client';

// Restitution des données d'un cabinet (docs/operations/fin-de-contrat.md), dans le conteneur
// de l'API (rôle applicatif, clé de chiffrement) :
//   node dist/export-clinic.js --clinic <id> --out <fichier>   (nouveau fichier, droits 600)
//   node dist/export-clinic.js --clinic <id> --out -           (sortie standard, à rediriger)
// Le fichier contient les dossiers en clair, notes médicales comprises : jamais dans un journal,
// un ticket ou une messagerie. Seuls les volumes s'affichent (sortie d'erreur).
const { values } = parseArgs({ options: { clinic: { type: 'string' }, out: { type: 'string' } } });
if (!values.clinic || !values.out) {
  console.error('Usage : export-clinic --clinic <id> --out <fichier|->');
  process.exit(2);
}
if (values.out !== '-' && existsSync(values.out)) {
  console.error(`Fichier déjà présent, rien n'a été lu ni écrit : ${values.out}`);
  process.exit(1);
}
const config = loadExportConfig();
const pool = createPool({
  connectionString: config.DATABASE_URL,
  max: 1,
  applicationName: 'dental-export',
});
try {
  const result = await exportClinicData(
    createDb(pool),
    values.clinic,
    createSecretBox(parseEncryptionKey(config.DATA_ENCRYPTION_KEY)),
  );
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (values.out === '-') process.stdout.write(json);
  else writeFileSync(values.out, json, { mode: 0o600, flag: 'wx' });
  const counts = Object.entries(result.counts).map(([table, n]) => `${table} ${n}`);
  console.error(`Export ${result.format} du cabinet ${result.clinicId} : ${counts.join(', ')}`);
} finally {
  await pool.end();
}
