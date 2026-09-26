import { loadBootstrapConfig } from '../../config/env';
import { bootstrapDatabase } from '../bootstrap';

const config = loadBootstrapConfig();
await bootstrapDatabase({
  adminUrl: config.DATABASE_ADMIN_URL,
  databaseName: config.DATABASE_NAME,
  ownerPassword: config.DATABASE_OWNER_PASSWORD,
  appPassword: config.DATABASE_APP_PASSWORD,
});
console.log(`Base « ${config.DATABASE_NAME} » et rôles prêts.`);
