import { randomBytes } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { pino } from 'pino';
import { buildApp, type RateLimits } from '../src/api/app';
import type { Logger } from '../src/config/logger';
import { cookieName } from '../src/api/session-cookie';
import { createDb, type Database } from '../src/db/client';
import { createSecretBox, type SecretBox } from '../src/lib/secret-box';
import { createAuthService } from '../src/modules/auth/auth.service';
import { createClinicService } from '../src/modules/clinic/clinic.service';
import { createImportsService } from '../src/modules/imports/imports.service';
import { createPatientsService } from '../src/modules/patients/patients.service';
import { createPractitionersService } from '../src/modules/scheduling/practitioners.service';
import { createSchedulesService } from '../src/modules/scheduling/schedules.service';
import { createAppointmentsService } from '../src/modules/appointments/appointments.service';
import { createFinanceService } from '../src/modules/finance/finance.service';
import { createStatsService } from '../src/modules/stats/stats.service';
import { createUsersService } from '../src/modules/users/users.service';

export const TEST_WEB_ORIGIN = 'http://127.0.0.1:5173';

// Limites élevées par défaut : les tests se connectent souvent depuis la même IP.
const RELAXED: RateLimits = {
  global: { max: 10_000, timeWindow: '1 minute' },
  sensitive: { max: 10_000, timeWindow: '1 minute' },
};

export async function buildTestApp(
  pool: pg.Pool,
  options: {
    rateLimits?: RateLimits;
    now?: () => Date;
    db?: Database;
    secretBox?: SecretBox;
    logger?: Logger;
  } = {},
): Promise<FastifyInstance> {
  const logger = options.logger ?? pino({ level: 'silent' });
  const db = options.db ?? createDb(pool);
  const secretBox = options.secretBox ?? createSecretBox(randomBytes(32));
  const now = options.now ? { now: options.now } : {};
  const app = await buildApp({
    logger,
    pool,
    trustProxyHops: 0,
    auth: createAuthService({ db, secretBox, logger, ...now }),
    users: createUsersService({ db }),
    clinic: createClinicService({ db }),
    patients: createPatientsService({ db, secretBox, ...now }),
    imports: createImportsService({ db, ...now }),
    practitioners: createPractitionersService({ db, ...now }),
    schedules: createSchedulesService({ db, ...now }),
    appointments: createAppointmentsService({ db, ...now }),
    finance: createFinanceService({ db, ...now }),
    stats: createStatsService({ db, ...now }),
    webOrigin: TEST_WEB_ORIGIN,
    secureCookies: false,
    rateLimits: options.rateLimits ?? RELAXED,
  });
  await app.ready();
  return app;
}

/** Client HTTP de test qui conserve le cookie de session et le jeton CSRF, comme un navigateur. */
export function browser(app: FastifyInstance) {
  let session: string | undefined;
  let csrf: string | undefined;
  const name = cookieName({ secure: false });

  function remember(res: LightMyRequestResponse) {
    const cookie = res.cookies.find((c) => c.name === name);
    if (cookie) session = cookie.value === '' ? undefined : cookie.value;
    const body = res.headers['content-type']?.includes('json')
      ? res.json<{ csrfToken?: string }>()
      : {};
    if (body.csrfToken) csrf = body.csrfToken;
    return res;
  }

  async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    const res = await app.inject({
      method,
      url,
      headers: {
        ...(session ? { cookie: `${name}=${session}` } : {}),
        ...(method !== 'GET' && csrf ? { 'x-csrf-token': csrf } : {}),
        ...(method !== 'GET' ? { origin: TEST_WEB_ORIGIN } : {}),
        ...headers,
      },
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
    return remember(res);
  }

  return {
    get: (url: string, headers?: Record<string, string>) => call('GET', url, undefined, headers),
    post: (url: string, payload?: unknown, headers?: Record<string, string>) =>
      call('POST', url, payload ?? {}, headers),
    patch: (url: string, payload: unknown, headers?: Record<string, string>) =>
      call('PATCH', url, payload, headers),
    put: (url: string, payload: unknown, headers?: Record<string, string>) =>
      call('PUT', url, payload, headers),
    delete: (url: string, headers?: Record<string, string>) =>
      call('DELETE', url, undefined, headers),
    login: (email: string, password: string) =>
      call('POST', '/api/auth/login', { email, password }),
    get sessionToken() {
      return session;
    },
    get csrfToken() {
      return csrf;
    },
    forgetCsrf() {
      csrf = undefined;
    },
  };
}
