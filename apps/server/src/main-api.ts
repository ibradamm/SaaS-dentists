import { buildApp } from './api/app';
import { loadApiConfig } from './config/env';
import { createLogger } from './config/logger';
import { createDb, createPool } from './db/client';
import { assertLeastPrivilege } from './db/guard';
import { createSecretBox, parseEncryptionKey } from './lib/secret-box';
import { createSentryReporter, noopReporter } from './lib/error-reporter';
import { exitOnFatalError, onShutdown } from './lib/shutdown';
import { createAuthService } from './modules/auth/auth.service';
import { createClinicService } from './modules/clinic/clinic.service';
import { createImportsService } from './modules/imports/imports.service';
import { createPatientsService } from './modules/patients/patients.service';
import { createPractitionersService } from './modules/scheduling/practitioners.service';
import { createSchedulesService } from './modules/scheduling/schedules.service';
import { createAppointmentsService } from './modules/appointments/appointments.service';
import { createFinanceService } from './modules/finance/finance.service';
import { createStatsService } from './modules/stats/stats.service';
import { createAuditLogService } from './modules/audit/audit-log.service';
import { createUsersService } from './modules/users/users.service';

const config = loadApiConfig();
const logger = createLogger({ service: 'api', env: config.APP_ENV, level: config.LOG_LEVEL });
const errorReporter = config.SENTRY_DSN
  ? createSentryReporter({
      dsn: config.SENTRY_DSN,
      environment: config.APP_ENV,
      release: config.SENTRY_RELEASE,
      service: 'api',
      logger,
    })
  : noopReporter;
exitOnFatalError(logger, errorReporter);

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
    practitioners: createPractitionersService({ db }),
    schedules: createSchedulesService({ db }),
    appointments: createAppointmentsService({ db }),
    finance: createFinanceService({ db }),
    stats: createStatsService({ db }),
    auditLog: createAuditLogService({ db }),
    webOrigin: config.WEB_ORIGIN,
    secureCookies: config.SECURE_COOKIES,
    errorReporter,
    rateLimits: {
      global: { max: config.API_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' },
      sensitive: { max: config.API_RATE_LIMIT_SENSITIVE_PER_MINUTE, timeWindow: '1 minute' },
    },
  });
  await app.listen({ host: config.API_HOST, port: config.API_PORT });

  onShutdown(logger, async () => {
    await app.close();
    await pool.end();
    await errorReporter.flush();
  });
} catch (error) {
  logger.fatal({ err: error }, "échec du démarrage de l'API");
  errorReporter.report(error);
  await errorReporter.flush();
  await pool.end();
  process.exit(1);
}
