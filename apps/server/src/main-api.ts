import { buildApp } from './api/app';
import { loadApiConfig } from './config/env';
import { createLogger } from './config/logger';
import { createDb, createPool } from './db/client';
import { assertLeastPrivilege } from './db/guard';
import { createSecretBox, parseEncryptionKey } from './lib/secret-box';
import { onShutdown } from './lib/shutdown';
import { createAuthService } from './modules/auth/auth.service';
import { createClinicService } from './modules/clinic/clinic.service';
import { createImportsService } from './modules/imports/imports.service';
import { createPatientsService } from './modules/patients/patients.service';
import { createUsersService } from './modules/users/users.service';

const config = loadApiConfig();
const logger = createLogger({ service: 'api', env: config.APP_ENV, level: config.LOG_LEVEL });

const pool = createPool(
  {
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    applicationName: 'dental-api',
  },
  logger,
);

try {
  await assertLeastPrivilege(pool);
  const db = createDb(pool);
  const secretBox = createSecretBox(parseEncryptionKey(config.DATA_ENCRYPTION_KEY));
  const app = await buildApp({
    logger,
    pool,
    trustProxyHops: config.API_TRUST_PROXY_HOPS,
    auth: createAuthService({ db, secretBox, logger }),
    users: createUsersService({ db }),
    clinic: createClinicService({ db }),
    patients: createPatientsService({ db, secretBox }),
    imports: createImportsService({ db }),
    webOrigin: config.WEB_ORIGIN,
    secureCookies: config.SECURE_COOKIES,
  });
  await app.listen({ host: config.API_HOST, port: config.API_PORT });

  onShutdown(logger, async () => {
    await app.close();
    await pool.end();
  });
} catch (error) {
  logger.fatal({ err: error }, "échec du démarrage de l'API");
  await pool.end();
  process.exit(1);
}
