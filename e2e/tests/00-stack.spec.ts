import { expect, test } from '@playwright/test';
import { SECURITY_HEADERS } from '../../apps/web/security-headers';
import { cspViolations, setupClinic, signIn, totpFor, watchCsp } from '../support/app';
import { runDeploymentChecks } from '../support/deployment-checks';
import { BASE_URL } from '../support/env';

/** Pile de production : santé, interface servie, en-têtes de sécurité de l'API et de l'interface. */
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

test('interface : en-têtes de sécurité sur la page et les fichiers ; aucune violation de la CSP', async ({
  page,
  request,
}) => {
  const html = await request.get('/connexion');
  expect(html.headers()['content-type']).toContain('text/html');
  const script = /<script type="module" crossorigin src="([^"]+)"/.exec(await html.text())?.[1];
  expect(script).toBeTruthy();
  const asset = await request.get(script!);
  for (const response of [html, asset]) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers()[name.toLowerCase()], name).toBe(value);
    }
  }
  expect(SECURITY_HEADERS['Content-Security-Policy']).toContain("frame-ancestors 'none'");
  await watchCsp(page.context());
  await page.goto('/connexion');
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
});

test('outil de vérification du déploiement (Phase 11), exercé sur la pile locale', async ({
  browser,
}) => {
  const clinic = await setupClinic(browser, 'Cabinet Vérifié');
  // Première connexion de la secrétaire (mot de passe temporaire remplacé).
  await (await signIn(browser, clinic.secretary)).context().close();
  const results = await runDeploymentChecks({
    url: BASE_URL,
    local: true,
    account: { email: clinic.secretary.email, password: clinic.secretary.password },
    admin: { ...clinic.admin, code: () => totpFor(clinic.admin) },
  });
  expect(results.filter((r) => r.status === 'ÉCHEC')).toEqual([]);
  // Connexion de la secrétaire tracée avec l'adresse du poste (pile locale : 127.0.0.1).
  expect(results.find((r) => r.name === 'Adresse du client dans le journal d’audit')?.detail).toBe(
    'pile locale : 127.0.0.1',
  );
  // HTTPS, redirection et TLS n'existent pas en local ; la limitation y est relevée.
  expect(results.filter((r) => r.status === 'IGNORÉ').map((r) => r.name)).toEqual([
    'HTTPS',
    'Redirection HTTP → HTTPS',
    'TLS',
    'Limitation derrière le proxy (adresse du client usurpée)',
  ]);
  expect(results).toHaveLength(10);
});
