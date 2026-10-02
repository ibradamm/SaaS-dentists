import { parseArgs } from 'node:util';
import { loadPurgeConfig } from '../../config/env';
import { PurgeRefused, purgeClinicData } from '../admin/clinic-data';
import { createPool } from '../client';

// Purge des données d'un cabinet après résiliation (docs/operations/fin-de-contrat.md), service
// migrate (connexion administrateur), après restitution et à la date prévue par le contrat :
//   node dist/purge-clinic.js --clinic <id> --confirm "<nom exact>"            (simulation)
//   node dist/purge-clinic.js --clinic <id> --confirm "<nom exact>" --execute  (définitif)
// Le récapitulatif (nom du cabinet, volumes) va au registre d'exploitation : à rejouer après
// toute restauration d'une sauvegarde antérieure.
const { values } = parseArgs({
  options: {
    clinic: { type: 'string' },
    confirm: { type: 'string' },
    execute: { type: 'boolean', default: false },
  },
});
if (!values.clinic || values.confirm === undefined) {
  console.error(
    'Usage : purge-clinic --clinic <id> --confirm "<nom exact du cabinet>" [--execute]',
  );
  process.exit(2);
}
const config = loadPurgeConfig();
const url = new URL(config.DATABASE_ADMIN_URL);
url.pathname = `/${config.DATABASE_NAME}`;
const pool = createPool({
  connectionString: url.toString(),
  max: 1,
  applicationName: 'dental-purge',
});
const client = await pool.connect();
try {
  const result = await purgeClinicData(client, {
    clinicId: values.clinic,
    confirmName: values.confirm,
    execute: values.execute,
  });
  console.log(
    result.executed
      ? `Purge effectuée : cabinet « ${result.clinicName} » (${result.clinicId}), ${new Date().toISOString()}.`
      : `Simulation, rien n'a été supprimé : cabinet « ${result.clinicName} » (${result.clinicId}).`,
  );
  console.log(JSON.stringify(result.deleted));
} catch (error) {
  if (!(error instanceof PurgeRefused)) throw error;
  console.error(`Purge refusée : ${error.message}.`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
