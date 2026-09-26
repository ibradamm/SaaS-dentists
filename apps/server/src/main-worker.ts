import { loadWorkerConfig } from './config/env';
import { createLogger } from './config/logger';
import { createPool } from './db/client';
import { assertLeastPrivilege } from './db/guard';
import { createRuntimeJobQueue } from './jobs/queue';
import { registerJobHandlers } from './jobs/handlers';
import { onShutdown } from './lib/shutdown';

const config = loadWorkerConfig();
const logger = createLogger({ service: 'worker', env: config.APP_ENV, level: config.LOG_LEVEL });

const pool = createPool(
  {
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    applicationName: 'dental-worker',
  },
  logger,
);
const boss = createRuntimeJobQueue(config.DATABASE_URL, logger);

try {
  await assertLeastPrivilege(pool);
  await boss.start();
  const registered = await registerJobHandlers(boss, { logger, pool });
  logger.info({ queues: registered }, 'worker démarré');

  onShutdown(logger, async () => {
    // Laisse les tâches en cours se terminer avant de fermer les connexions.
    await boss.stop({ graceful: true, timeout: 20_000 });
    await pool.end();
  });
} catch (error) {
  logger.fatal({ err: error }, 'échec du démarrage du worker');
  await pool.end();
  process.exit(1);
}
