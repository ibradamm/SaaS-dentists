import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { generate } from 'otplib';
import { runDeploymentChecks } from '../support/deployment-checks';

/*
 * Vérification d'un environnement hébergé (Phase 11) :
 *   pnpm --filter @dental/e2e check:deployment --url https://staging.exemple.fr \
 *     [--accounts comptes.json | --email compte-de-test@… --password …] [--rate-limit]
 *     [--expect-ip <adresse publique du poste>]
 * --accounts : fichier produit par staging:accounts (secrétaire et administrateur de test).
 * Le mot de passe peut aussi venir de CHECK_PASSWORD (évite l'historique du terminal).
 * Code de sortie 1 si un contrôle échoue. Données synthétiques uniquement.
 */
const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    accounts: { type: 'string' },
    email: { type: 'string' },
    password: { type: 'string' },
    'rate-limit': { type: 'boolean', default: false },
    'expect-ip': { type: 'string' },
    local: { type: 'boolean', default: false },
  },
});
if (!values.url) {
  console.error(
    'Usage : check:deployment --url https://… [--accounts fichier | --email … --password …] [--rate-limit]',
  );
  process.exit(2);
}
interface Accounts {
  admin: { email: string; password: string; totpSecret: string };
  secretary: { email: string; password: string };
}
const accounts = values.accounts
  ? (JSON.parse(readFileSync(values.accounts, 'utf8')) as Accounts)
  : undefined;
const password = values.password ?? process.env.CHECK_PASSWORD;
const account =
  accounts?.secretary ?? (values.email && password ? { email: values.email, password } : undefined);
const results = await runDeploymentChecks({
  url: values.url,
  local: values.local,
  rateLimit: values['rate-limit'],
  ...(account ? { account } : {}),
  ...(accounts
    ? {
        admin: {
          ...accounts.admin,
          // Pas suivant : celui de l'activation (staging:accounts) a déjà servi.
          code: () =>
            generate({
              secret: accounts.admin.totpSecret,
              epoch: Math.floor(Date.now() / 1000) + 30,
            }),
        },
      }
    : {}),
  ...(values['expect-ip'] ? { expectIp: values['expect-ip'] } : {}),
});
for (const r of results) console.log(`${r.status.padEnd(7)} ${r.name} : ${r.detail}`);
const failed = results.filter((r) => r.status === 'ÉCHEC').length;
console.log(failed === 0 ? 'Aucun échec.' : `${failed} contrôle(s) en échec.`);
process.exit(failed === 0 ? 0 : 1);
