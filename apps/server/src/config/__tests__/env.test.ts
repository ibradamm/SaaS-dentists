import { describe, expect, it } from 'vitest';
import { ConfigError, loadApiConfig, loadBootstrapConfig } from '../env';

const validApiEnv = {
  APP_ENV: 'development',
  DATABASE_URL: 'postgres://dental_app:secret-value@127.0.0.1:5432/dental',
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
});
