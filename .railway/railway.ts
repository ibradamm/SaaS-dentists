import { defineRailway, github, postgres, project, service } from 'railway/iac';

/*
 * Staging Railway (Infrastructure as Code) : plan et application par la CLI Railway,
 *   railway config plan   puis   railway config apply
 * Procédure complète, secrets et vérifications : docs/operations/deploiement-staging.md.
 * Jamais appliqué à ce jour (aucun budget d'hébergement) : fichier vérifié par le typage
 * seulement.
 *
 * Secrets : variables partagées scellées de l'environnement, créées à la main avant le premier
 * « apply » (valeurs générées sur un poste de confiance, jamais dans ce fichier ni dans Git) :
 *   DATA_ENCRYPTION_KEY, DATABASE_OWNER_PASSWORD, DATABASE_APP_PASSWORD (base64url, sans
 *   caractère à échapper dans une URL), SENTRY_DSN (facultatif, projet dental-staging).
 */
const REPO = 'ibradamm/SaaS-dentists';
const BRANCH = 'claude/dental-clinic-platform-5qtdxw';
// Europe de l'Ouest (Amsterdam) : la plus proche du Maroc parmi les régions Railway.
const REGION = 'europe-west4-drams3a';

export default defineRailway(() => {
  // Le déploiement attend la CI GitHub verte du commit (checkSuites).
  const source = github(REPO, { branch: BRANCH, checkSuites: true });
  const server = {
    builder: 'DOCKERFILE',
    dockerfilePath: 'infra/docker/server.Dockerfile',
  } as const;
  const db = postgres('postgres', { region: REGION });

  // Rôles de l'application (docs/adr/0002) : l'API et le worker n'ont que dental_app.
  const pg = '${{postgres.PGHOST}}:${{postgres.PGPORT}}/dental';
  const appUrl = `postgres://dental_app:\${{shared.DATABASE_APP_PASSWORD}}@${pg}`;
  const sentry = {
    SENTRY_DSN: '${{shared.SENTRY_DSN}}',
    SENTRY_RELEASE: '${{RAILWAY_GIT_COMMIT_SHA}}',
  };

  // Rôles, base, migrations et contrôle des invariants de sécurité (RLS, rôles, journal), puis
  // arrêt : seul service qui détient les accès propriétaire et administrateur de PostgreSQL.
  // À déployer avant l'API et le worker ; échoue si la base n'est pas conforme.
  const migrate = service('migrate', {
    source,
    build: server,
    deploy: {
      startCommand:
        'sh -c "node dist/bootstrap.js && node dist/migrate.js && node dist/check-database.js"',
      restartPolicyType: 'NEVER',
    },
    replicas: { [REGION]: 1 },
    env: {
      APP_ENV: 'staging',
      DATABASE_ADMIN_URL: db.env.DATABASE_URL,
      DATABASE_NAME: 'dental',
      DATABASE_OWNER_PASSWORD: '${{shared.DATABASE_OWNER_PASSWORD}}',
      DATABASE_APP_PASSWORD: '${{shared.DATABASE_APP_PASSWORD}}',
      DATABASE_MIGRATION_URL: `postgres://dental_owner:\${{shared.DATABASE_OWNER_PASSWORD}}@${pg}`,
    },
  });

  const api = service('api', {
    source,
    build: server,
    deploy: {
      startCommand: 'node dist/main-api.js',
      healthcheckPath: '/health/ready',
      healthcheckTimeout: 60,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 5,
    },
    // ponytail: une seule instance, le limiteur de débit est en mémoire (docs/adr/0003).
    // Plusieurs instances exigent d'abord un stockage partagé des compteurs.
    replicas: { [REGION]: 1 },
    env: {
      APP_ENV: 'staging',
      DATABASE_URL: appUrl,
      DATA_ENCRYPTION_KEY: '${{shared.DATA_ENCRYPTION_KEY}}',
      API_HOST: '::',
      API_PORT: '3000',
      PORT: '3000',
      // Un proxy devant l'API : le Caddy du service web.
      API_TRUST_PROXY_HOPS: '1',
      WEB_ORIGIN: 'https://${{web.RAILWAY_PUBLIC_DOMAIN}}',
      ...sentry,
    },
  });

  const worker = service('worker', {
    source,
    build: server,
    deploy: {
      startCommand: 'node dist/main-worker.js',
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 5,
    },
    replicas: { [REGION]: 1 },
    env: {
      APP_ENV: 'staging',
      DATABASE_URL: appUrl,
      SESSION_RETENTION_DAYS: '30',
      ...sentry,
    },
  });

  // Seul service public : l'interface et /api (même origine). Domaine généré après le premier
  // « apply » (railway domain) ; HTTPS et redirection assurés par le proxy de Railway.
  const web = service('web', {
    source,
    build: { builder: 'DOCKERFILE', dockerfilePath: 'infra/docker/web.Dockerfile' },
    deploy: { healthcheckPath: '/', restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 5 },
    replicas: { [REGION]: 1 },
    env: {
      PORT: '8080',
      API_UPSTREAM: '${{api.RAILWAY_PRIVATE_DOMAIN}}:3000',
      // Adresses du proxy de Railway, seul autorisé à fournir X-Real-IP. Hypothèse à vérifier
      // au premier déploiement : check:deployment --rate-limit --expect-ip <adresse du poste>.
      CADDY_TRUSTED_PROXIES: 'private_ranges',
    },
  });

  return project('dental-saas', { resources: [db, migrate, api, worker, web] });
});
