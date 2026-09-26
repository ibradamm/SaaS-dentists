import { pino, type Logger } from 'pino';
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

export function createLogger(options: { service: string; env: AppEnv; level: string }): Logger {
  return pino({
    level: options.level,
    base: { service: options.service, env: options.env },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
  });
}

export type { Logger };
