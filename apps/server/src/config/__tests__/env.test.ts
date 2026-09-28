import { describe, expect, it } from 'vitest';
import { ConfigError, loadApiConfig, loadBootstrapConfig, loadWorkerConfig } from '../env';

const validApiEnv = {
  APP_ENV: 'development',
  DATABASE_URL: 'postgres://dental_app:secret-value@127.0.0.1:5432/dental',
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('configuration', () => {
  it('applique les valeurs par défaut', () => {
    const config = loadApiConfig(validApiEnv);
    expect(config).toMatchObject({
      API_PORT: 3000,
      API_HOST: '127.0.0.1',
      LOG_LEVEL: 'info',
      DATABASE_POOL_MAX: 10,
    });
  });

  it('refuse une configuration incomplète en nommant la variable', () => {
    expect(() => loadApiConfig({ APP_ENV: 'development' })).toThrow(/DATABASE_URL/);
  });

  it("n'inclut jamais la valeur d'une variable invalide dans l'erreur", () => {
    try {
      loadApiConfig({ ...validApiEnv, DATABASE_URL: 'https://user:TOPSECRET@host/db' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).not.toContain('TOPSECRET');
    }
  });

  it("dérive l'origine web et les cookies sécurisés de l'environnement", () => {
    expect(loadApiConfig(validApiEnv)).toMatchObject({
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      SECURE_COOKIES: false,
    });
    const prod = loadApiConfig({
      ...validApiEnv,
      APP_ENV: 'production',
      WEB_ORIGIN: 'https://app.cabinet.fr/',
    });
    expect(prod).toMatchObject({ WEB_ORIGIN: 'https://app.cabinet.fr', SECURE_COOKIES: true });
  });

  it('exige une origine web HTTPS en production', () => {
    expect(() => loadApiConfig({ ...validApiEnv, APP_ENV: 'production' })).toThrow(/WEB_ORIGIN/);
    expect(() =>
      loadApiConfig({ ...validApiEnv, APP_ENV: 'production', WEB_ORIGIN: 'http://app.cabinet.fr' }),
    ).toThrow(/HTTPS/);
  });

  it('refuse une clé de chiffrement de mauvaise taille', () => {
    expect(() => loadApiConfig({ ...validApiEnv, DATA_ENCRYPTION_KEY: 'Y291cnRl' })).toThrow(
      /DATA_ENCRYPTION_KEY/,
    );
  });

  it('refuse un environnement inconnu', () => {
    expect(() => loadApiConfig({ ...validApiEnv, APP_ENV: 'prod' })).toThrow(/APP_ENV/);
  });

  it('traite une variable vide comme absente', () => {
    expect(loadApiConfig({ ...validApiEnv, API_PORT: '' }).API_PORT).toBe(3000);
  });

  it('refuse un port hors limites', () => {
    expect(() => loadApiConfig({ ...validApiEnv, API_PORT: '70000' })).toThrow(/API_PORT/);
  });

  it('exige des mots de passe de rôles suffisamment longs', () => {
    expect(() =>
      loadBootstrapConfig({
        APP_ENV: 'development',
        DATABASE_ADMIN_URL: 'postgres://postgres:x@127.0.0.1:5432/postgres',
        DATABASE_NAME: 'dental',
        DATABASE_OWNER_PASSWORD: 'court',
        DATABASE_APP_PASSWORD: 'suffisamment-long',
      }),
    ).toThrow(/DATABASE_OWNER_PASSWORD/);
  });

  it('remontée des erreurs : facultative, HTTPS hors développement, jamais la clé dans l’erreur', () => {
    expect(loadApiConfig(validApiEnv).SENTRY_DSN).toBeUndefined();
    const dsn = 'https://clepublique@o1.ingest.de.sentry.io/42';
    const prod = {
      ...validApiEnv,
      APP_ENV: 'production',
      WEB_ORIGIN: 'https://cabinet.example.org',
      SENTRY_DSN: dsn,
      SENTRY_RELEASE: 'v1.2.3+abc',
    };
    expect(loadApiConfig(prod)).toMatchObject({ SENTRY_DSN: dsn, SENTRY_RELEASE: 'v1.2.3+abc' });
    for (const load of [loadApiConfig, loadWorkerConfig]) {
      try {
        load({ ...prod, SENTRY_DSN: 'http://clepubliqueSECRETE@sentry.example.org/42' });
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).toMatch(/SENTRY_DSN : HTTPS obligatoire/);
        expect((error as Error).message).not.toContain('SECRETE');
      }
    }
    // En développement, un serveur d'ingestion local en HTTP est accepté.
    expect(
      loadWorkerConfig({ ...validApiEnv, SENTRY_DSN: 'http://cle@127.0.0.1:9000/42' }).SENTRY_DSN,
    ).toBe('http://cle@127.0.0.1:9000/42');
  });

  it('conservation des sessions : 30 jours par défaut, configurable, jamais sous le plancher RLS', () => {
    expect(loadWorkerConfig(validApiEnv).SESSION_RETENTION_DAYS).toBe(30);
    expect(
      loadWorkerConfig({ ...validApiEnv, SESSION_RETENTION_DAYS: '180' }).SESSION_RETENTION_DAYS,
    ).toBe(180);
    expect(() => loadWorkerConfig({ ...validApiEnv, SESSION_RETENTION_DAYS: '7' })).toThrow(
      /SESSION_RETENTION_DAYS : au moins 30 jours/,
    );
  });

  it('limitation de débit : 300 et 10 par minute par défaut, configurables', () => {
    expect(loadApiConfig(validApiEnv)).toMatchObject({
      API_RATE_LIMIT_PER_MINUTE: 300,
      API_RATE_LIMIT_SENSITIVE_PER_MINUTE: 10,
    });
    expect(
      loadApiConfig({ ...validApiEnv, API_RATE_LIMIT_SENSITIVE_PER_MINUTE: '1000' })
        .API_RATE_LIMIT_SENSITIVE_PER_MINUTE,
    ).toBe(1000);
    expect(() => loadApiConfig({ ...validApiEnv, API_RATE_LIMIT_PER_MINUTE: '0' })).toThrow(
      /API_RATE_LIMIT_PER_MINUTE/,
    );
  });
});
