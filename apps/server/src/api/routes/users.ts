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

export function usersRoutes(app: FastifyInstance, deps: { users: UsersService }) {
  const { users } = deps;

  app.get('/api/users', { config: { access } }, async (request) =>
    listUsersResponseSchema.parse({ users: await users.list(actorOf(request)) }),
  );

  app.post('/api/users', { config: { access } }, async (request, reply) => {
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

  app.post('/api/users/:id/reset-password', { config: { access } }, async (request) => {
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
