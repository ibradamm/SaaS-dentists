import { z } from 'zod';
import { appEnvSchema } from '../config/env';
import { createLogger } from '../config/logger';
import { SENTINEL, runSentryCheck } from '../lib/sentry-check';

/*
 * Contrôle réel de la remontée vers Sentry, sur un projet de STAGING uniquement :
 *   APP_ENV=staging SENTRY_DSN=… pnpm --filter @dental/server sentry:check
 * Le DSN vient de l'environnement, jamais du dépôt. Procédure : docs/phases/phase-10.md.
 */
const config = z
  .object({
    APP_ENV: appEnvSchema.refine((v) => v === 'staging', 'APP_ENV=staging obligatoire'),
    SENTRY_DSN: z.url({ protocol: /^https$/, error: 'DSN Sentry HTTPS attendu' }),
    SENTRY_RELEASE: z.string().max(100).optional(),
  })
  .safeParse(process.env);
if (!config.success) {
  console.error(config.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`).join('\n'));
  process.exit(2);
}
const logger = createLogger({ service: 'sentry-check', env: 'staging', level: 'warn' });
const result = await runSentryCheck({
  dsn: config.data.SENTRY_DSN,
  environment: config.data.APP_ENV,
  release: config.data.SENTRY_RELEASE,
  logger,
});
console.log(`Réponse de Sentry : ${result.status ?? 'aucune'}`);
console.log(`Identifiant de l'événement : ${result.eventId ?? 'aucun'}`);
console.log(`Sentinelle absente de l'envoi : ${result.sent.includes(SENTINEL) ? 'NON' : 'oui'}`);
console.log('Corps envoyé :');
console.log(result.sent);
process.exit(result.status !== null && result.status >= 200 && result.status < 300 ? 0 : 1);
