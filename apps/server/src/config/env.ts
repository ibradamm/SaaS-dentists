import { z } from 'zod';

/**
 * Lecture et validation de la configuration. Chaque point d'entrée (API, worker, migrations,
 * bootstrap) déclare uniquement les variables dont il a besoin. Une variable manquante ou
 * invalide empêche le démarrage ; le message cite le nom de la variable, jamais sa valeur
 * (qui peut être un secret).
 */

export const appEnvSchema = z.enum(['development', 'test', 'staging', 'production']);
export type AppEnv = z.infer<typeof appEnvSchema>;

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/, error: 'URL PostgreSQL attendue' });

const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

const baseShape = {
  APP_ENV: appEnvSchema,
  LOG_LEVEL: logLevel.default('info'),
};

/**
 * Remontée des erreurs (docs/adr/0011) : désactivée sans SENTRY_DSN. L'environnement Sentry
 * est APP_ENV (development, staging, production), la version SENTRY_RELEASE (ex. commit).
 */
const errorReportingShape = {
  SENTRY_DSN: z.url({ protocol: /^https?$/, error: 'DSN Sentry (URL) attendu' }).optional(),
  SENTRY_RELEASE: z
    .string()
    .regex(/^[\w.\-+@/]{1,100}$/, 'version invalide')
    .optional(),
};

function requireHttpsDsn(
  config: { APP_ENV: AppEnv; SENTRY_DSN?: string | undefined },
  ctx: z.RefinementCtx,
) {
  const deployed = config.APP_ENV === 'production' || config.APP_ENV === 'staging';
  if (deployed && config.SENTRY_DSN && !config.SENTRY_DSN.startsWith('https://')) {
    ctx.addIssue({ code: 'custom', path: ['SENTRY_DSN'], message: 'HTTPS obligatoire' });
  }
}

const databaseShape = {
  DATABASE_URL: postgresUrl,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
};

const encryptionKey = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'clé base64 de 32 octets attendue');

const DEV_WEB_ORIGIN = 'http://127.0.0.1:5173';

const apiSchema = z
  .object({
    ...baseShape,
    ...databaseShape,
    ...errorReportingShape,
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    // Nombre de proxys de confiance devant l'API (Caddy en production = 1). 0 = aucun.
    API_TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    // Origine de l'interface web : seule origine acceptée pour les requêtes modifiantes.
    WEB_ORIGIN: z.url().optional(),
    // Limitation du nombre de requêtes par adresse IP et par minute (docs/adr/0003) : toutes
    // les routes, et connexion / code / mot de passe. Un cabinet dont les postes partagent une
    // même adresse publique peut demander plus que 300 ; la valeur des routes sensibles ne
    // devrait pas être relevée hors des tests de bout en bout.
    API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(100_000).default(300),
    API_RATE_LIMIT_SENSITIVE_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(10),
    // Clé de chiffrement des champs sensibles (secrets TOTP). Générer :
    // node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
    DATA_ENCRYPTION_KEY: encryptionKey,
  })
  .superRefine((config, ctx) => {
    requireHttpsDsn(config, ctx);
    const deployed = config.APP_ENV === 'production' || config.APP_ENV === 'staging';
    if (deployed && !config.WEB_ORIGIN) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_ORIGIN'],
        message: 'obligatoire en staging et production',
      });
    }
    if (deployed && config.WEB_ORIGIN && !config.WEB_ORIGIN.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_ORIGIN'],
        message: 'HTTPS obligatoire en staging et production',
      });
    }
  })
  .transform((config) => ({
    ...config,
    WEB_ORIGIN: new URL(config.WEB_ORIGIN ?? DEV_WEB_ORIGIN).origin,
    // Cookies « Secure » dès qu'on n'est plus en local.
    SECURE_COOKIES: config.APP_ENV === 'production' || config.APP_ENV === 'staging',
  }));

const workerSchema = z
  .object({
    ...baseShape,
    ...databaseShape,
    ...errorReportingShape,
    // Conservation des sessions terminées (docs/adr/0011, section 6) : 30 jours validés pour
    // le MVP, à revoir après avis juridique. Plancher de 30 jours imposé par la politique RLS
    // (migration 0018) : une durée plus courte demande une nouvelle migration.
    SESSION_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .min(30, 'au moins 30 jours (plancher de la politique RLS)')
      .max(3650)
      .default(30),
  })
  .superRefine(requireHttpsDsn);

const migrateSchema = z.object({
  ...baseShape,
  DATABASE_MIGRATION_URL: postgresUrl,
});

const bootstrapSchema = z.object({
  ...baseShape,
  DATABASE_ADMIN_URL: postgresUrl,
  DATABASE_NAME: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/, 'nom de base invalide'),
  DATABASE_OWNER_PASSWORD: z.string().min(12, '12 caractères minimum'),
  DATABASE_APP_PASSWORD: z.string().min(12, '12 caractères minimum'),
});

export type ApiConfig = z.infer<typeof apiSchema>;
export type WorkerConfig = z.infer<typeof workerSchema>;
export type MigrateConfig = z.infer<typeof migrateSchema>;
export type BootstrapConfig = z.infer<typeof bootstrapSchema>;

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Configuration invalide :\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

function parse<T extends z.ZodType>(schema: T, env: Env): z.infer<T> {
  // Une variable définie mais vide est traitée comme absente (cas fréquent dans les fichiers .env).
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map(
        (issue) => `${issue.path.join('.') || '(racine)'} : ${issue.message}`,
      ),
    );
  }
  return result.data;
}

export const loadApiConfig = (env: Env = process.env): ApiConfig => parse(apiSchema, env);
export const loadWorkerConfig = (env: Env = process.env): WorkerConfig => parse(workerSchema, env);
export const loadMigrateConfig = (env: Env = process.env): MigrateConfig =>
  parse(migrateSchema, env);
export const loadBootstrapConfig = (env: Env = process.env): BootstrapConfig =>
  parse(bootstrapSchema, env);
