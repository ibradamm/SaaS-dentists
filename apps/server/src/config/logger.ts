import { pino, type DestinationStream, type Logger } from 'pino';
import type { AppEnv } from './env';

/**
 * Chemins masqués dans tous les logs. Les logs ne contiennent jamais de secret, de jeton,
 * de mot de passe ni de contenu de message patient.
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.secret',
  '*.apiKey',
  '*.connectionString',
  '*.body',
];

interface LoggedRequest {
  method?: string;
  url?: string;
  host?: string;
  ip?: string;
}

/**
 * Requête HTTP telle que journalisée : chemin sans chaîne de requête, qui peut contenir des
 * données patient (recherche par nom, téléphone, date de naissance). Fastify utilise ce
 * sérialiseur à la place du sien, qui journalise l'URL complète.
 */
export function serializeRequest(req: LoggedRequest) {
  return {
    method: req.method,
    path: req.url?.split('?')[0],
    host: req.host,
    remoteAddress: req.ip,
  };
}

const MAX_MESSAGE_LENGTH = 500;
const MAX_CAUSE_DEPTH = 3;
/** Champs d'une erreur PostgreSQL sans valeur saisie (`detail`, `where`, `hint` en contiennent). */
const PG_FIELDS = ['code', 'severity', 'constraint', 'table', 'column', 'dataType'] as const;

/**
 * Retire d'un message d'erreur les valeurs qu'il cite : PostgreSQL et JSON.parse citent la
 * valeur fautive entre guillemets (« invalid input syntax for type integer: "Dupont" »).
 */
export function scrubErrorMessage(message: string): string {
  return message
    .replace(/"[^"\n]*"/g, '"[…]"')
    .replace(/'[^'\n]*'/g, "'[…]'")
    .replace(/[^\s@"'()<>,;]+@[^\s@"'()<>,;]+/g, '[e-mail]')
    .slice(0, MAX_MESSAGE_LENGTH);
}

type ErrorLike = Error & Record<string, unknown>;

/**
 * Sérialiseur d'erreur des journaux, par liste blanche : type, message sans valeurs citées,
 * code, champs PostgreSQL sans valeur, pile et cause. Les paramètres d'une requête SQL (que
 * drizzle recopie dans son message et dans `params`) et le `detail` PostgreSQL (« Key
 * (email)=(…) ») ne sont jamais journalisés : ils contiennent les données saisies.
 */
export function serializeError(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  // Valeur levée qui n'est pas une Error : jamais recopiée telle quelle.
  if (typeof value === 'string') return { type: 'string', message: scrubErrorMessage(value) };
  if (!(value instanceof Error)) return { type: typeof value };
  const error = value as ErrorLike;
  const type = error.constructor?.name || error.name || 'Error';
  // Erreur de requête drizzle : son message est « Failed query: <sql>\nparams: <valeurs> ».
  // Le texte SQL ne contient que des marqueurs ($1…), jamais les valeurs.
  const message =
    typeof error.query === 'string'
      ? `Failed query: ${error.query}`.slice(0, 2 * MAX_MESSAGE_LENGTH)
      : scrubErrorMessage(error.message);
  const frames = (error.stack ?? '')
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .slice(0, 15);
  const out: Record<string, unknown> = {
    type,
    message,
    stack: [`${type}: ${message}`, ...frames].join('\n'),
  };
  if (typeof error.code === 'string' || typeof error.code === 'number') out.code = error.code;
  if (typeof error.statusCode === 'number') out.statusCode = error.statusCode;
  for (const field of PG_FIELDS) {
    if (field !== 'code' && typeof error[field] === 'string') out[field] = error[field];
  }
  if (error.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    out.cause = serializeError(error.cause, depth + 1);
  }
  return out;
}

export function createLogger(options: {
  service: string;
  env: AppEnv;
  level: string;
  destination?: DestinationStream;
}): Logger {
  return pino(
    {
      level: options.level,
      base: { service: options.service, env: options.env },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
      serializers: { req: serializeRequest, err: serializeError, error: serializeError },
    },
    options.destination,
  );
}

export type { Logger };
