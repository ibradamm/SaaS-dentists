import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { bootstrapDatabase, roleUrl } from '../bootstrap';
import { deployDatabase } from '../deploy';
import { DB_OWNER_ROLE } from '../roles';

describe('déploiement de la base', () => {
  const { adminUrl, ownerPassword, appPassword, ownerUrl } = inject('database');
  const extraDatabases: string[] = [];

  afterAll(async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    for (const name of extraDatabases) {
      await admin.query(`DROP DATABASE IF EXISTS ${admin.escapeIdentifier(name)} WITH (FORCE)`);
    }
    await admin.end();
  });

  it('est idempotent : un second déploiement n’applique rien', async () => {
    const result = await deployDatabase(ownerUrl);
    expect(result.applied).toEqual([]);
    expect(result.alreadyApplied).toBeGreaterThanOrEqual(3);
  });

  it('quatre déploiements simultanés sur une base vierge appliquent chaque migration une seule fois', async () => {
    const databaseName = `dental_test_${randomBytes(4).toString('hex')}`;
    extraDatabases.push(databaseName);
    await bootstrapDatabase({ adminUrl, databaseName, ownerPassword, appPassword });
    const url = roleUrl(adminUrl, DB_OWNER_ROLE, ownerPassword, databaseName);

    // Quatre instances qui démarrent ensemble : sans verrou de déploiement, les droits sur la
    // file de tâches étaient accordés en parallèle et PostgreSQL refusait l'un des GRANT.
    const results = await Promise.all([1, 2, 3, 4].map(() => deployDatabase(url)));
    const appliedCounts = results.map((r) => r.applied.length).sort((a, b) => a - b);
    expect(appliedCounts.slice(0, 3)).toEqual([0, 0, 0]);
    expect(appliedCounts[3]).toBeGreaterThanOrEqual(3);

    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const { rows } = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM migrations.applied',
    );
    await client.end();
    expect(rows[0]?.n).toBe(appliedCounts[3]);
  });
});
