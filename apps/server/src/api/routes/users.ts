import {
  clinicUserSchema,
  createUserRequestSchema,
  listUsersResponseSchema,
  temporaryPasswordResponseSchema,
  updateUserRequestSchema,
} from '@dental/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { UsersService } from '../../modules/users/users.service';
import { actorOf, requestMeta } from '../auth-plugin';

const params = z.object({ id: z.uuid() });
const access = { permission: 'user.manage' } as const;

export function usersRoutes(
  app: FastifyInstance,
  deps: { users: UsersService; sensitiveRateLimit: { max: number; timeWindow: string } },
) {
  const { users } = deps;
  // Création de compte et réinitialisation : émettent un mot de passe temporaire. La création
  // répond aussi si une adresse existe déjà sur la plateforme (e-mail unique) : même limite
  // que la connexion, pour qu'un compte administrateur ne serve pas à tester des adresses en
  // masse.
  const rateLimit = deps.sensitiveRateLimit;

  app.get('/api/users', { config: { access } }, async (request) =>
    listUsersResponseSchema.parse({ users: await users.list(actorOf(request)) }),
  );

  app.post('/api/users', { config: { access, rateLimit } }, async (request, reply) => {
    const body = createUserRequestSchema.parse(request.body);
    const created = await users.create(actorOf(request), body, requestMeta(request));
    return reply.status(201).send(temporaryPasswordResponseSchema.parse(created));
  });

  app.patch('/api/users/:id', { config: { access } }, async (request) => {
    const { id } = params.parse(request.params);
    const body = updateUserRequestSchema.parse(request.body);
    return clinicUserSchema.parse(
      await users.update(actorOf(request), id, body, requestMeta(request)),
    );
  });

  app.post('/api/users/:id/reset-password', { config: { access, rateLimit } }, async (request) => {
    const { id } = params.parse(request.params);
    return temporaryPasswordResponseSchema.parse(
      await users.resetPassword(actorOf(request), id, requestMeta(request)),
    );
  });

  app.post('/api/users/:id/reset-mfa', { config: { access } }, async (request) => {
    const { id } = params.parse(request.params);
    return clinicUserSchema.parse(await users.resetMfa(actorOf(request), id, requestMeta(request)));
  });
}
