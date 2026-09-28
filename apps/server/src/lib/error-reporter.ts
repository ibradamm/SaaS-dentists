import { randomUUID } from 'node:crypto';
import type { Logger } from '../config/logger';
import { serializeError } from '../config/logger';

/**
 * Remontée des erreurs imprévues vers Sentry (docs/adr/0011), sans SDK : l'événement est
 * construit par liste blanche à partir de l'erreur déjà nettoyée pour les journaux
 * (serializeError : ni valeurs saisies, ni paramètres SQL, ni `detail` PostgreSQL). Aucune
 * requête HTTP, aucun en-tête, cookie, corps, utilisateur ni fil d'Ariane n'est collecté :
 * seuls partent le type, le message nettoyé, la pile, le code d'erreur, l'environnement, la
 * version, le service et l'identifiant de requête (aléatoire).
 *
 * Désactivée sans SENTRY_DSN (développement, tests). Protocole : « envelope » Sentry
 * (POST /api/<projet>/envelope/, en-tête X-Sentry-Auth).
 */

export interface ErrorContext {
  requestId?: string;
  job?: string;
}

export interface ErrorReporter {
  /** Identifiant de l'événement envoyé (32 caractères hexadécimaux), ou undefined. */
  report(error: unknown, context?: ErrorContext): string | undefined;
  /** Attend l'envoi des événements en cours (arrêt du processus), au plus `timeoutMs`. */
  flush(timeoutMs?: number): Promise<void>;
}

export const noopReporter: ErrorReporter = {
  report: () => undefined,
  flush: () => Promise.resolve(),
};

export interface Dsn {
  endpoint: string;
  publicKey: string;
}

/** DSN Sentry : `https://<clé publique>@<hôte>[/<chemin>]/<projet>`. */
export function parseDsn(dsn: string): Dsn {
  const url = new URL(dsn);
  const segments = url.pathname.split('/').filter(Boolean);
  const project = segments.pop();
  if (!url.username || !project || !/^\d+$/.test(project)) {
    throw new Error('DSN Sentry invalide');
  }
  const prefix = segments.length > 0 ? `/${segments.join('/')}` : '';
  return {
    endpoint: `${url.protocol}//${url.host}${prefix}/api/${project}/envelope/`,
    publicKey: decodeURIComponent(url.username),
  };
}

interface Frame {
  filename: string;
  function: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

const FRAME = /^\s+at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;

/** Cadres de pile au format Sentry (du plus ancien au plus récent), chemins relatifs. */
function framesOf(stack: string, root: string): Frame[] {
  const frames: Frame[] = [];
  for (const line of stack.split('\n')) {
    const match = FRAME.exec(line);
    if (!match) continue;
    const [, fn, file, lineno, colno] = match;
    const filename = file!.replace(/^file:\/\//, '').replace(root, '');
    frames.push({
      filename,
      function: fn ?? '?',
      lineno: Number(lineno),
      colno: Number(colno),
      in_app: !filename.includes('node_modules') && !filename.startsWith('node:'),
    });
  }
  return frames.reverse();
}

type Serialized = {
  type?: string;
  message?: string;
  stack?: string;
  code?: string | number;
  cause?: unknown;
};

/**
 * Événement Sentry d'une erreur. Les causes chaînées (erreur drizzle → erreur PostgreSQL)
 * sont incluses, la plus profonde d'abord, comme le fait Sentry pour les erreurs liées.
 */
export function buildEvent(
  error: unknown,
  meta: { environment: string; release?: string | undefined; service: string; root: string },
  context: ErrorContext = {},
) {
  const values: { type: string; value: string; stacktrace?: { frames: Frame[] } }[] = [];
  const tags: Record<string, string> = { service: meta.service };
  let current = serializeError(error) as Serialized | undefined;
  for (let depth = 0; current && typeof current === 'object' && depth < 4; depth++) {
    const frames = current.stack ? framesOf(current.stack, meta.root) : [];
    values.unshift({
      type: current.type ?? 'Error',
      value: current.message ?? '',
      ...(frames.length > 0 ? { stacktrace: { frames } } : {}),
    });
    if (current.code !== undefined && !tags.error_code) tags.error_code = String(current.code);
    current = current.cause as Serialized | undefined;
  }
  if (context.requestId) tags.request_id = context.requestId;
  if (context.job) tags.job = context.job;
  return {
    event_id: randomUUID().replaceAll('-', ''),
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    environment: meta.environment,
    ...(meta.release ? { release: meta.release } : {}),
    tags,
    contexts: { runtime: { name: 'node', version: process.version } },
    exception: { values },
  };
}

export function createSentryReporter(options: {
  dsn: string;
  environment: string;
  release?: string | undefined;
  service: string;
  logger: Logger;
  /** Injection pour les tests (serveur d'ingestion local). */
  fetch?: typeof fetch;
}): ErrorReporter {
  const dsn = parseDsn(options.dsn);
  const send = options.fetch ?? fetch;
  const root = `${process.cwd()}/`;
  const pending = new Set<Promise<void>>();
  let pausedUntil = 0;

  function report(error: unknown, context: ErrorContext = {}): string | undefined {
    if (Date.now() < pausedUntil) return undefined;
    const event = buildEvent(
      error,
      {
        environment: options.environment,
        release: options.release,
        service: options.service,
        root,
      },
      context,
    );
    const body = [
      JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: 'event', content_type: 'application/json' }),
      JSON.stringify(event),
    ].join('\n');
    const request = send(dsn.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-sentry-envelope',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_client=dental-server/1.0, sentry_key=${dsn.publicKey}`,
      },
      body,
      signal: AbortSignal.timeout(3_000),
    })
      .then((response) => {
        // Quota ou limitation : pause pendant la durée demandée (60 s par défaut).
        if (response.status === 429) {
          const retry = Number(response.headers.get('retry-after'));
          pausedUntil = Date.now() + (Number.isFinite(retry) && retry > 0 ? retry : 60) * 1000;
        } else if (!response.ok) {
          options.logger.warn({ status: response.status }, 'remontée d’erreur refusée');
        }
      })
      // La remontée ne doit jamais faire échouer la requête ni le processus.
      .catch(() => options.logger.warn('remontée d’erreur impossible'))
      .finally(() => pending.delete(request));
    pending.add(request);
    return event.event_id;
  }

  async function flush(timeoutMs = 2_000) {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled([...pending]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
    clearTimeout(timer);
  }

  return { report, flush };
}
