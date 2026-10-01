import { parseArgs } from 'node:util';
import { loadMigrateConfig } from '../../config/env';
import { setClinicStatus, setLegalHold } from '../admin/clinics';
import { createDb, createPool, type Database } from '../client';

// Cycle de vie d'un cabinet (docs/operations/fin-de-contrat.md), service migrate (propriétaire) :
//   node dist/clinic-lifecycle.js --clinic <id> --action suspend|reactivate|hold|release
// suspend : connexion refusée, sessions révoquées, données intactes ; hold : conservation pour
// litige, aucune suppression tant qu'elle est posée.
const ACTIONS: Record<string, [string, (db: Database, id: string) => Promise<boolean>]> = {
  suspend: ['Cabinet suspendu.', (db, id) => setClinicStatus(db, id, 'SUSPENDED')],
  reactivate: ['Cabinet réactivé.', (db, id) => setClinicStatus(db, id, 'ACTIVE')],
  hold: ['Conservation pour litige posée.', (db, id) => setLegalHold(db, id, true)],
  release: ['Conservation pour litige levée.', (db, id) => setLegalHold(db, id, false)],
};
const { values } = parseArgs({
  options: { clinic: { type: 'string' }, action: { type: 'string' } },
});
const action = ACTIONS[values.action ?? ''];
if (!values.clinic || !action) {
  console.error('Usage : clinic-lifecycle --clinic <id> --action suspend|reactivate|hold|release');
  process.exit(2);
}
const config = loadMigrateConfig();
const pool = createPool({
  connectionString: config.DATABASE_MIGRATION_URL,
  max: 1,
  applicationName: 'dental-admin',
});
try {
  const done = await action[1](createDb(pool), values.clinic);
  console.log(done ? action[0] : 'Cabinet introuvable.');
  if (!done) process.exitCode = 1;
} finally {
  await pool.end();
}
