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
      serializers: { req: serializeRequest },
    },
    options.destination,
  );
}

export type { Logger };
