import { loadWorkerConfig } from './config/env';
import { createLogger } from './config/logger';
import { createDb, createPool } from './db/client';
import { assertLeastPrivilege } from './db/guard';
import { createRuntimeJobQueue } from './jobs/queue';
import { registerJobHandlers } from './jobs/handlers';
import { createSentryReporter, noopReporter } from './lib/error-reporter';
import { exitOnFatalError, onShutdown } from './lib/shutdown';

const config = loadWorkerConfig();
const logger = createLogger({ service: 'worker', env: config.APP_ENV, level: config.LOG_LEVEL });
const errorReporter = config.SENTRY_DSN
  ? createSentryReporter({
      dsn: config.SENTRY_DSN,
      environment: config.APP_ENV,
      release: config.SENTRY_RELEASE,
      service: 'worker',
      logger,
    })
  : noopReporter;
exitOnFatalError(logger, errorReporter);

const pool = createPool(
  {
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    applicationName: 'dental-worker',
  },
  logger,
);
const boss = createRuntimeJobQueue(config.DATABASE_URL, logger);
boss.on('error', (error) => errorReporter.report(error, { job: 'pg-boss' }));

try {
  await assertLeastPrivilege(pool);
  await boss.start();
  const registered = await registerJobHandlers(boss, {
    logger,
    pool,
    db: createDb(pool),
    errorReporter,
    sessionRetentionDays: config.SESSION_RETENTION_DAYS,
  });
  logger.info({ queues: registered }, 'worker démarré');

  onShutdown(logger, async () => {
    // Laisse les tâches en cours se terminer avant de fermer les connexions.
    await boss.stop({ graceful: true, timeout: 20_000 });
    await pool.end();
    await errorReporter.flush();
  });
} catch (error) {
  logger.fatal({ err: error }, 'échec du démarrage du worker');
  errorReporter.report(error);
  await errorReporter.flush();
  await pool.end();
  process.exit(1);
}
