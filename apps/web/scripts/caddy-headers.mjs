/*
 * En-têtes de sécurité de l'interface au format Caddy, générés depuis la source unique
 * `security-headers.ts` : le proxy de production (infra/caddy) les importe tels quels.
 * Usage : node apps/web/scripts/caddy-headers.mjs > security-headers.caddy
 */
import { SECURITY_HEADERS } from '../security-headers.ts';

const lines = Object.entries(SECURITY_HEADERS).map(
  ([name, value]) => `\t${name} ${JSON.stringify(value)}`,
);
process.stdout.write(`header {\n${lines.join('\n')}\n}\n`);
