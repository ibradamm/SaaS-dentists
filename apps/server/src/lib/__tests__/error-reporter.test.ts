import { describe, expect, it } from 'vitest';
import { buildEvent, parseDsn } from '../error-reporter';

const META = { environment: 'staging', release: 'abc123', service: 'api', root: '/srv/app/' };

describe('remontée des erreurs : format Sentry', () => {
  it('DSN : point d’envoi et clé publique ; DSN mal formé refusé', () => {
    expect(parseDsn('https://cle123@o1.ingest.de.sentry.io/4507')).toEqual({
      endpoint: 'https://o1.ingest.de.sentry.io/api/4507/envelope/',
      publicKey: 'cle123',
    });
    expect(parseDsn('http://cle@127.0.0.1:9000/sous/chemin/42').endpoint).toBe(
      'http://127.0.0.1:9000/sous/chemin/api/42/envelope/',
    );
    for (const dsn of ['https://o1.ingest.sentry.io/42', 'https://cle@hote/projet']) {
      expect(() => parseDsn(dsn)).toThrow('DSN Sentry invalide');
    }
  });

  it('liste blanche : ni paramètres SQL, ni detail PostgreSQL, ni propriété inconnue', () => {
    const pg = Object.assign(new Error('invalid input syntax for type integer: "Dupont"'), {
      code: '22P02',
      detail: 'Key (email)=(lea.dupont@example.org)',
      where: 'Dupont',
    });
    const error = Object.assign(new Error('Failed query: select $1::int\nparams: Dupont'), {
      query: 'select $1::int',
      params: ['Dupont'],
      patient: { lastName: 'Dupont' },
      cause: pg,
    });
    error.stack = [
      'Error: Failed query: select $1::int\nparams: Dupont',
      '    at runQuery (/srv/app/src/modules/patients/patients.service.ts:120:15)',
      '    at async handler (file:///srv/app/node_modules/fastify/lib/route.js:40:3)',
    ].join('\n');
    const event = buildEvent(error, META, { requestId: 'req-42' });
    expect(JSON.stringify(event)).not.toMatch(/Dupont|dupont/);
    expect(event).toMatchObject({
      platform: 'node',
      level: 'error',
      environment: 'staging',
      release: 'abc123',
      tags: { service: 'api', error_code: '22P02', request_id: 'req-42' },
    });
    expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
    // Cause la plus profonde d'abord ; pile du plus ancien au plus récent, chemins relatifs.
    expect(event.exception.values.map((v) => [v.type, v.value])).toEqual([
      ['Error', 'invalid input syntax for type integer: "[…]"'],
      ['Error', 'Failed query: select $1::int'],
    ]);
    expect(event.exception.values[1]?.stacktrace?.frames).toEqual([
      {
        filename: 'node_modules/fastify/lib/route.js',
        function: 'async handler',
        lineno: 40,
        colno: 3,
        in_app: false,
      },
      {
        filename: 'src/modules/patients/patients.service.ts',
        function: 'runQuery',
        lineno: 120,
        colno: 15,
        in_app: true,
      },
    ]);
    // Rien d'autre que les champs choisis.
    expect(Object.keys(event).sort()).toEqual(
      [
        'contexts',
        'environment',
        'event_id',
        'exception',
        'level',
        'platform',
        'release',
        'tags',
        'timestamp',
      ].sort(),
    );
  });

  it('valeur levée qui n’est pas une Error : type seul, jamais son contenu', () => {
    const event = buildEvent({ lastName: 'Dupont' }, META);
    expect(JSON.stringify(event)).not.toContain('Dupont');
    expect(event.exception.values).toEqual([{ type: 'object', value: '' }]);
  });
});
