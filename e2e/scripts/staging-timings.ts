import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { generate } from 'otplib';
import { httpSession } from '../support/http-session';

/*
 * Temps de réponse d'un environnement hébergé, avec le compte administrateur de test
 * (fichier de staging:accounts) : pages principales en série, puis charge concurrente.
 *   pnpm --filter @dental/e2e staging:timings --url https://… --accounts comptes.json \
 *     [--concurrency 10] [--seconds 30]
 * Tout vient d'un seul poste : au-delà de API_RATE_LIMIT_PER_MINUTE (300 par défaut), l'API
 * répond 429 ; ces réponses sont comptées à part. Lecture seule ; données synthétiques.
 */
const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    accounts: { type: 'string' },
    concurrency: { type: 'string', default: '10' },
    seconds: { type: 'string', default: '30' },
  },
});
if (!values.url || !values.accounts) {
  console.error('Usage : staging:timings --url https://… --accounts comptes.json');
  process.exit(2);
}
const base = new URL(values.url);
const { admin } = JSON.parse(readFileSync(values.accounts, 'utf8')) as {
  admin: { email: string; password: string; totpSecret: string };
};

const call = httpSession(base);
await call('POST', '/api/auth/login', { email: admin.email, password: admin.password });
// Pas suivant : un code ne sert qu'une fois (staging:accounts, check:deployment).
const epoch = Math.floor(Date.now() / 1000) + 30;
await call('POST', '/api/auth/mfa/verify', {
  code: await generate({ secret: admin.totpSecret, epoch }),
});
const cookie = call.cookie();

const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const [year, month] = day().split('-');
// Chemin, et corps pour une lecture en POST (recherche : texte hors de l'adresse, écart E19).
const endpoints: [string, string, unknown?][] = [
  ['session', '/api/auth/me'],
  ['tableau de bord (jour)', `/api/dashboard?from=${day()}&to=${day()}`],
  ['tableau de bord (année)', `/api/dashboard?from=${year}-01-01&to=${year}-12-31`],
  ['revenus (mois)', `/api/finance/revenue?from=${year}-${month}-01&to=${day()}`],
  ['agenda (semaine)', `/api/appointments?from=${day()}&to=${day(6)}`],
  ['recherche de patients', '/api/patients/search', { q: 'test' }],
  ['journal d’audit (mois)', `/api/audit-logs?from=${year}-${month}-01&to=${day()}`],
];

async function timed(path: string, body?: unknown): Promise<{ ms: number; status: number }> {
  const started = performance.now();
  const res = await fetch(
    new URL(path, base),
    body === undefined
      ? { headers: { cookie } }
      : {
          method: 'POST',
          headers: {
            cookie,
            'content-type': 'application/json',
            origin: base.origin,
            'x-csrf-token': call.csrf(),
          },
          body: JSON.stringify(body),
        },
  );
  await res.arrayBuffer();
  return { ms: performance.now() - started, status: res.status };
}
const quantile = (sorted: number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
const summary = (ms: number[]) => {
  const s = [...ms].sort((a, b) => a - b);
  return `médiane ${quantile(s, 0.5).toFixed(0)} ms, p95 ${quantile(s, 0.95).toFixed(0)} ms, max ${(s.at(-1) ?? 0).toFixed(0)} ms`;
};

console.log(`Environnement : ${base.origin}`);
for (const [label, path, body] of endpoints) {
  const samples: number[] = [];
  const errors: number[] = [];
  for (let i = 0; i < 20; i++) {
    const r = await timed(path, body);
    samples.push(r.ms);
    if (r.status !== 200) errors.push(r.status);
  }
  console.log(
    `${label.padEnd(26)} ${summary(samples)}${errors.length ? ` ; erreurs ${errors.join(' ')}` : ''}`,
  );
}

const concurrency = Number(values.concurrency);
const until = performance.now() + Number(values.seconds) * 1000;
const latencies: number[] = [];
const statuses = new Map<number, number>();
await Promise.all(
  Array.from({ length: concurrency }, async (_, worker) => {
    for (let i = worker; performance.now() < until; i++) {
      const [, path, body] = endpoints[i % endpoints.length]!;
      const r = await timed(path, body);
      statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
      if (r.status === 200) latencies.push(r.ms);
    }
  }),
);
const total = [...statuses.values()].reduce((a, b) => a + b, 0);
const serverErrors = [...statuses].filter(([s]) => s >= 500).reduce((a, [, n]) => a + n, 0);
console.log(
  `Charge : ${concurrency} requêtes simultanées pendant ${values.seconds} s : ${total} requêtes ` +
    `(${(total / Number(values.seconds)).toFixed(1)}/s), ${summary(latencies)}, ` +
    `erreurs serveur ${serverErrors}, limitées (429) ${statuses.get(429) ?? 0}`,
);
await call('POST', '/api/auth/logout').catch(() => undefined);
process.exit(serverErrors === 0 ? 0 : 1);
