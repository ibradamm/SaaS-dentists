import {
  csrfResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  meResponseSchema,
  mfaSetupResponseSchema,
  mfaVerifyRequestSchema,
  passwordChangeRequestSchema,
  permissionsOf,
  type SessionRestriction,
} from '@dental/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AuthService } from '../../modules/auth/auth.service';
import type { IssuedSession } from '../../modules/auth/auth.types';
import { requestMeta, sessionOf } from '../auth-plugin';
import { clearSessionCookie, setSessionCookie, type CookiePolicy } from '../session-cookie';

const ANY_STEP: readonly SessionRestriction[] = [
  'MFA_PENDING',
  'PASSWORD_CHANGE_REQUIRED',
  'MFA_ENROLLMENT_REQUIRED',
];
const AFTER_PASSWORD: readonly SessionRestriction[] = [
  'PASSWORD_CHANGE_REQUIRED',
  'MFA_ENROLLMENT_REQUIRED',
];

export function authRoutes(
  app: FastifyInstance,
  deps: {
    auth: AuthService;
    cookies: CookiePolicy;
    sensitiveRateLimit: { max: number; timeWindow: string };
  },
) {
  const { auth, cookies } = deps;
  const rateLimit = deps.sensitiveRateLimit;

  function issue(reply: FastifyReply, issued: IssuedSession) {
    setSessionCookie(reply, cookies, issued.token, issued.expiresAt);
    return loginResponseSchema.parse({
      restriction: issued.restriction,
      csrfToken: issued.csrfToken,
    });
  }

  app.post(
    '/api/auth/login',
    { config: { access: { public: true }, rateLimit } },
    async (request, reply) => {
      const body = loginRequestSchema.parse(request.body);
      return issue(reply, await auth.login(body, requestMeta(request)));
    },
  );

  app.post(
    '/api/auth/mfa/verify',
    { config: { access: { allow: ['MFA_PENDING'] }, rateLimit } },
    async (request, reply) => {
      const { code } = mfaVerifyRequestSchema.parse(request.body);
      return issue(reply, await auth.verifyMfa(sessionOf(request), code, requestMeta(request)));
    },
  );

  app.post(
    '/api/auth/logout',
    { config: { access: { allow: ANY_STEP } } },
    async (request, reply) => {
      await auth.logout(sessionOf(request), requestMeta(request));
      clearSessionCookie(reply, cookies);
      return reply.status(204).send();
    },
  );

  app.get('/api/auth/me', { config: { access: { allow: ANY_STEP } } }, (request) => {
    const session = sessionOf(request);
    return meResponseSchema.parse({
      user: session.user,
      clinic: session.clinic,
      role: session.actor.role,
      // Pendant une étape d'authentification, aucune permission n'est effective.
      permissions: session.restriction ? [] : permissionsOf(session.actor),
      restriction: session.restriction,
      csrfToken: session.csrfToken,
    });
  });

  app.get('/api/auth/csrf', { config: { access: { allow: ANY_STEP } } }, (request) =>
    csrfResponseSchema.parse({ csrfToken: sessionOf(request).csrfToken }),
  );

  app.post(
    '/api/auth/password',
    { config: { access: { allow: AFTER_PASSWORD }, rateLimit } },
    async (request, reply) => {
      const body = passwordChangeRequestSchema.parse(request.body);
      return issue(
        reply,
        await auth.changePassword(sessionOf(request), body, requestMeta(request)),
      );
    },
  );

  app.post(
    '/api/auth/mfa/setup',
    { config: { access: { allow: ['MFA_ENROLLMENT_REQUIRED'] } } },
    async (request) => mfaSetupResponseSchema.parse(await auth.setupMfa(sessionOf(request))),
  );

  app.post(
    '/api/auth/mfa/activate',
    { config: { access: { allow: ['MFA_ENROLLMENT_REQUIRED'] }, rateLimit } },
    async (request, reply) => {
      const { code } = mfaVerifyRequestSchema.parse(request.body);
      return issue(reply, await auth.activateMfa(sessionOf(request), code, requestMeta(request)));
    },
  );
}
