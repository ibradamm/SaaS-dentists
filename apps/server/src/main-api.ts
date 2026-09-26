import { buildApp } from './api/app';
import { loadApiConfig } from './config/env';
import { createLogger } from './config/logger';
import { createPool } from './db/client';
import { assertLeastPrivilege } from './db/guard';
import { onShutdown } from './lib/shutdown';

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
  const app = await buildApp({ logger, pool, trustProxyHops: config.API_TRUST_PROXY_HOPS });
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
