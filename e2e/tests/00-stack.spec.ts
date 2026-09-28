import { expect, test } from '@playwright/test';

/** Pile de production : santé, interface servie, en-têtes de sécurité de l'API. */
test('la pile de production répond ; en-têtes de sécurité de l’API', async ({ page, request }) => {
  const ready = await request.get('/health/ready');
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({ status: 'ok', checks: { database: 'ok' } });
  const me = await request.get('/api/auth/me');
  expect(me.status()).toBe(401);
  for (const header of [
    'content-security-policy',
    'strict-transport-security',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
  ]) {
    expect(me.headers()[header], header).toBeTruthy();
  }
  expect(me.headers()['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  await page.goto('/agenda');
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
});
