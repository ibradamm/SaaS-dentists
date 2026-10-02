import {
  addImportRowsRequestSchema,
  createImportRequestSchema,
  importRowsReportResponseSchema,
  importSummarySchema,
  listImportsResponseSchema,
  revertImportResponseSchema,
} from '@dental/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ImportsService } from '../../modules/imports/imports.service';
import { actorOf, requestMeta } from '../auth-plugin';

const params = z.object({ id: z.uuid() });
const config = { access: { permission: 'data.import' } } as const;
// Un paquet de 500 lignes peut dépasser la limite générale de 1 Mo (notes longues).
const ROWS_BODY_LIMIT = 5 * 1024 * 1024;

export function importsRoutes(app: FastifyInstance, deps: { imports: ImportsService }) {
  const { imports } = deps;

  app.get('/api/imports', { config }, async (request) =>
    listImportsResponseSchema.parse({ imports: await imports.list(actorOf(request)) }),
  );

  app.post('/api/imports', { config }, async (request, reply) => {
    const body = createImportRequestSchema.parse(request.body);
    const created = await imports.create(actorOf(request), body, requestMeta(request));
    return reply.status(201).send(importSummarySchema.parse(created));
  });

  app.get('/api/imports/:id', { config }, async (request) =>
    importSummarySchema.parse(await imports.get(actorOf(request), params.parse(request.params).id)),
  );

  app.post('/api/imports/:id/rows', { config, bodyLimit: ROWS_BODY_LIMIT }, async (request) => {
    const { id } = params.parse(request.params);
    const body = addImportRowsRequestSchema.parse(request.body);
    return importSummarySchema.parse(await imports.addRows(actorOf(request), id, body));
  });

  app.get('/api/imports/:id/rows', { config }, async (request) =>
    importRowsReportResponseSchema.parse(
      await imports.report(
        actorOf(request),
        params.parse(request.params).id,
        request.query as Record<string, unknown>,
      ),
    ),
  );

  app.post('/api/imports/:id/commit', { config }, async (request) =>
    importSummarySchema.parse(
      await imports.commit(actorOf(request), params.parse(request.params).id, requestMeta(request)),
    ),
  );

  app.post('/api/imports/:id/revert', { config }, async (request) =>
    revertImportResponseSchema.parse(
      await imports.revert(actorOf(request), params.parse(request.params).id, requestMeta(request)),
    ),
  );

  app.post('/api/imports/:id/discard', { config }, async (request) =>
    importSummarySchema.parse(
      await imports.discard(
        actorOf(request),
        params.parse(request.params).id,
        requestMeta(request),
      ),
    ),
  );
}
