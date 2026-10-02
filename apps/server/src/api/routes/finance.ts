import {
  billingExemptionRequestSchema,
  billingExemptionResponseSchema,
  cancelChargeRequestSchema,
  createChargeRequestSchema,
  recordPaymentRequestSchema,
  voidPaymentRequestSchema,
  chargeSchema,
  patientAccountSchema,
  paymentResultSchema,
  paymentsJournalResponseSchema,
  receivablesResponseSchema,
  revenueResponseSchema,
} from '@dental/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { FinanceService } from '../../modules/finance/finance.service';
import { actorOf, requestMeta } from '../auth-plugin';

const params = z.object({ id: z.uuid() });
const read = { access: { permission: 'payment.read' } } as const;
const write = { access: { permission: 'payment.write' } } as const;
const voiding = { access: { permission: 'payment.void' } } as const;
const reports = { access: { permission: 'finance.reports.read' } } as const;

/**
 * Paiements et revenus (docs/adr/0009). Une saisie rejouée (même clé d'idempotence) répond 200
 * avec l'objet déjà créé ; une première saisie répond 201.
 */
export function financeRoutes(app: FastifyInstance, deps: { finance: FinanceService }) {
  const { finance } = deps;

  app.post('/api/appointments/:id/billing', { config: write }, async (request) =>
    billingExemptionResponseSchema.parse(
      await finance.setBillingExempt(
        actorOf(request),
        params.parse(request.params).id,
        billingExemptionRequestSchema.parse(request.body),
        requestMeta(request),
      ),
    ),
  );

  app.get('/api/patients/:id/account', { config: read }, async (request) =>
    patientAccountSchema.parse(
      await finance.account(actorOf(request), params.parse(request.params).id),
    ),
  );

  app.post('/api/charges', { config: write }, async (request, reply) => {
    const { charge, replayed } = await finance.createCharge(
      actorOf(request),
      createChargeRequestSchema.parse(request.body),
      requestMeta(request),
    );
    return reply.status(replayed ? 200 : 201).send(chargeSchema.parse(charge));
  });

  app.post('/api/charges/:id/cancel', { config: voiding }, async (request) =>
    chargeSchema.parse(
      await finance.cancelCharge(
        actorOf(request),
        params.parse(request.params).id,
        cancelChargeRequestSchema.parse(request.body),
        requestMeta(request),
      ),
    ),
  );

  app.post('/api/payments', { config: write }, async (request, reply) => {
    const { replayed, ...result } = await finance.recordPayment(
      actorOf(request),
      recordPaymentRequestSchema.parse(request.body),
      requestMeta(request),
    );
    return reply.status(replayed ? 200 : 201).send(paymentResultSchema.parse(result));
  });

  app.post('/api/payments/:id/void', { config: voiding }, async (request) =>
    paymentResultSchema.parse(
      await finance.voidPayment(
        actorOf(request),
        params.parse(request.params).id,
        voidPaymentRequestSchema.parse(request.body),
        requestMeta(request),
      ),
    ),
  );

  app.get('/api/receivables', { config: read }, async (request) =>
    receivablesResponseSchema.parse(await finance.receivables(actorOf(request))),
  );

  app.get('/api/finance/revenue', { config: reports }, async (request) =>
    revenueResponseSchema.parse(
      await finance.revenue(actorOf(request), request.query as Record<string, unknown>),
    ),
  );

  app.get('/api/finance/payments', { config: reports }, async (request) =>
    paymentsJournalResponseSchema.parse(
      await finance.journal(actorOf(request), request.query as Record<string, unknown>),
    ),
  );
}
