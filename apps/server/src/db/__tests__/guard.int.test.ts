import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { openTestDatabase } from '../../../test/db';
import { createPool } from '../client';
import { assertLeastPrivilege, PrivilegedRoleError } from '../guard';

describe('garde de démarrage : rôle le moins privilégié', () => {
  const t = openTestDatabase();
  const admin = createPool({
    connectionString: inject('database').adminUrl,
    max: 1,
    applicationName: 'test-admin',
  });
  afterAll(async () => {
    await t.close();
    await admin.end();
  });

  it('accepte le rôle applicatif', async () => {
    await expect(assertLeastPrivilege(t.appPool)).resolves.toBeUndefined();
  });

  it('refuse le rôle propriétaire des tables', async () => {
    await expect(assertLeastPrivilege(t.ownerPool)).rejects.toThrow(PrivilegedRoleError);
  });

  it('refuse un superutilisateur', async () => {
    await expect(assertLeastPrivilege(admin)).rejects.toThrow(/superutilisateur/);
  });
});
