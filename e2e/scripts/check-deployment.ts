import { parseArgs } from 'node:util';
import { runDeploymentChecks } from '../support/deployment-checks';

/*
 * Vérification d'un environnement hébergé (Phase 11) :
 *   pnpm --filter @dental/e2e check:deployment --url https://staging.exemple.fr \
 *     [--email compte-de-test@… --password …] [--rate-limit]
 * Le mot de passe peut aussi venir de CHECK_PASSWORD (évite l'historique du terminal).
 * Code de sortie 1 si un contrôle échoue. Données synthétiques uniquement.
 */
const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    email: { type: 'string' },
    password: { type: 'string' },
    'rate-limit': { type: 'boolean', default: false },
    local: { type: 'boolean', default: false },
  },
});
if (!values.url) {
  console.error('Usage : check:deployment --url https://… [--email … --password …] [--rate-limit]');
  process.exit(2);
}
const password = values.password ?? process.env.CHECK_PASSWORD;
const results = await runDeploymentChecks({
  url: values.url,
  local: values.local,
  rateLimit: values['rate-limit'],
  ...(values.email && password ? { account: { email: values.email, password } } : {}),
});
for (const r of results) console.log(`${r.status.padEnd(7)} ${r.name} : ${r.detail}`);
const failed = results.filter((r) => r.status === 'ÉCHEC').length;
console.log(failed === 0 ? 'Aucun échec.' : `${failed} contrôle(s) en échec.`);
process.exit(failed === 0 ? 0 : 1);
