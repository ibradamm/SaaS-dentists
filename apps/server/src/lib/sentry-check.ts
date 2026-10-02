import type { Logger } from '../config/logger';
import { createSentryReporter } from './error-reporter';

/**
 * Contrôle de la remontée vers Sentry (docs/adr/0011, section 5) : envoie une erreur contrôlée
 * dont les champs écartés par la liste blanche portent des sentinelles fictives. Aucune donnée
 * réelle n'est utilisée. L'événement reçu par Sentry doit contenir la requête SQL sans valeur,
 * le code 22P02, l'environnement et la version, et aucune sentinelle.
 */
export const SENTINEL = 'SENTINELLE-FICTIVE-PATIENT';

export function controlledError(): Error {
  const cause = Object.assign(new Error(`invalid input syntax for type integer: "${SENTINEL}"`), {
    code: '22P02',
    detail: `Key (email)=(${SENTINEL.toLowerCase()}@example.org) already exists.`,
    where: SENTINEL,
  });
  return Object.assign(new Error(`Failed query: select $1::int as controle\nparams: ${SENTINEL}`), {
    query: 'select $1::int as controle',
    params: [SENTINEL],
    cookie: `__Host-dental_session=${SENTINEL}`,
    authorization: `Bearer ${SENTINEL}`,
    body: { lastName: SENTINEL, medicalNote: SENTINEL },
    cause,
  });
}

export interface SentryCheckResult {
  eventId: string | undefined;
  status: number | null;
  /** Corps exact envoyé (enveloppe), pour inspection locale. */
  sent: string;
}

export async function runSentryCheck(options: {
  dsn: string;
  environment: string;
  release?: string | undefined;
  logger: Logger;
  fetch?: typeof fetch;
}): Promise<SentryCheckResult> {
  const send = options.fetch ?? fetch;
  let status: number | null = null;
  let sent = '';
  const recording: typeof fetch = async (input, init) => {
    sent = typeof init?.body === 'string' ? init.body : '';
    const response = await send(input, init);
    status = response.status;
    return response;
  };
  const reporter = createSentryReporter({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    service: 'sentry-check',
    logger: options.logger,
    fetch: recording,
  });
  const eventId = reporter.report(controlledError(), { requestId: 'controle-sentry' });
  await reporter.flush(10_000);
  return { eventId, status, sent };
}
