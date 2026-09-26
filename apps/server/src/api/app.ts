import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Logger } from '../config/logger';
import type { AuthService } from '../modules/auth/auth.service';
import type { ClinicService } from '../modules/clinic/clinic.service';
import type { ImportsService } from '../modules/imports/imports.service';
import type { PatientsService } from '../modules/patients/patients.service';
import type { AppointmentsService } from '../modules/appointments/appointments.service';
import type { PractitionersService } from '../modules/scheduling/practitioners.service';
import type { SchedulesService } from '../modules/scheduling/schedules.service';
import type { UsersService } from '../modules/users/users.service';
import { registerAuth } from './auth-plugin';
import { errorHandler, notFoundHandler } from './error-handler';
import { authRoutes } from './routes/auth';
import { clinicRoutes } from './routes/clinic';
import { healthRoutes } from './routes/health';
import { importsRoutes } from './routes/imports';
import { appointmentsRoutes } from './routes/appointments';
import { schedulingRoutes } from './routes/scheduling';
import { patientsRoutes } from './routes/patients';
import { usersRoutes } from './routes/users';

export interface RateLimits {
  /** Toutes les routes, par adresse IP. */
  global: { max: number; timeWindow: string };
  /** Connexion, code TOTP, mot de passe : plus strict. */
  sensitive: { max: number; timeWindow: string };
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  global: { max: 300, timeWindow: '1 minute' },
  sensitive: { max: 10, timeWindow: '1 minute' },
};

export interface AppDependencies {
  logger: Logger;
  pool: pg.Pool;
  trustProxyHops: number;
  auth: AuthService;
  users: UsersService;
  clinic: ClinicService;
  patients: PatientsService;
  imports: ImportsService;
  practitioners: PractitionersService;
  schedules: SchedulesService;
  appointments: AppointmentsService;
  webOrigin: string;
  secureCookies: boolean;
  rateLimits?: RateLimits;
}

const BODY_LIMIT_BYTES = 1024 * 1024;

export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  // Typé en FastifyBaseLogger pour que l'instance utilise le type de logger par défaut de Fastify.
  const loggerInstance: FastifyBaseLogger = deps.logger;
  const limits = deps.rateLimits ?? DEFAULT_RATE_LIMITS;
  const app = Fastify({
    loggerInstance,
    // Identifiant de requête généré côté serveur (un identifiant fourni par le client n'est
    // pas repris : il pourrait polluer les logs). Renvoyé dans l'en-tête x-request-id.
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    bodyLimit: BODY_LIMIT_BYTES,
    // Ne fait confiance qu'aux N premiers proxys (IP client correcte derrière Caddy).
    trustProxy: (_address: string, hop: number) => hop < deps.trustProxyHops,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(helmet);
  await app.register(cookie);
  // Limiteur en mémoire : suffisant pour une seule instance d'API (MVP). Plusieurs instances
  // exigeront un stockage partagé (docs/adr/0003).
  await app.register(rateLimit, { global: true, ...limits.global });
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  const cookies = { secure: deps.secureCookies };
  registerAuth(app, { auth: deps.auth, cookies, webOrigin: deps.webOrigin });

  healthRoutes(app, { pool: deps.pool });
  authRoutes(app, { auth: deps.auth, cookies, sensitiveRateLimit: limits.sensitive });
  usersRoutes(app, { users: deps.users });
  clinicRoutes(app, { clinic: deps.clinic });
  patientsRoutes(app, { patients: deps.patients });
  importsRoutes(app, { imports: deps.imports });
  schedulingRoutes(app, { practitioners: deps.practitioners, schedules: deps.schedules });
  appointmentsRoutes(app, { appointments: deps.appointments });

  return app;
}
