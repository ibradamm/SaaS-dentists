import { loadBootstrapConfig } from '../../config/env';
import { bootstrapDatabase } from '../bootstrap';

const config = loadBootstrapConfig();
const result = await bootstrapDatabase({
  adminUrl: config.DATABASE_ADMIN_URL,
  databaseName: config.DATABASE_NAME,
  ownerPassword: config.DATABASE_OWNER_PASSWORD,
  appPassword: config.DATABASE_APP_PASSWORD,
});
console.log(`Base « ${config.DATABASE_NAME} » et rôles prêts.`);
if (!result.terseServerLog) {
  console.warn(
    "ATTENTION : log_error_verbosity n'a pas pu être réglé à « terse » (droit refusé). " +
      "Régler ce paramètre dans la configuration PostgreSQL de l'hébergeur : sinon le journal " +
      'du serveur cite les valeurs en conflit (téléphones, adresses e-mail).',
  );
}
