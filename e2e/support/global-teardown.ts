import { existsSync, readFileSync } from 'node:fs';
import { sql } from './db';
import { API_LOG, WORKER_LOG, databaseUrls } from './env';
import { FORBIDDEN_IN_LOGS, TYPED_REASONS } from './sentinels';

/**
 * Après tous les parcours :
 *  - journaux réels de l'API et du worker : aucune donnée saisie par les tests (noms de patients,
 *    notes, téléphone, mot de passe) ;
 *  - journal d'audit et file de tâches (pg-boss) en base : ni ces données ni les motifs libres
 *    saisis (l'audit trace le nom du champ, jamais son contenu).
 * Échec de l'exécution sinon.
 */
export default async function globalTeardown() {
  const found: string[] = [];
  // Secrets de l'exécution : clé de chiffrement, mots de passe des rôles PostgreSQL. Jetons de
  // session : le nom du cookie ou un en-tête d'authentification ne doit jamais être journalisé.
  const urls = databaseUrls();
  const secrets: [string, string][] = [
    ['DATA_ENCRYPTION_KEY', process.env.E2E_DATA_ENCRYPTION_KEY ?? ''],
    ['mot de passe dental_owner', urls.ownerPassword],
    ['mot de passe dental_app', urls.appPassword],
    ['mot de passe administrateur PostgreSQL', decodeURIComponent(new URL(urls.adminUrl).password)],
  ];
  for (const file of [API_LOG, WORKER_LOG]) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const value of FORBIDDEN_IN_LOGS) {
      if (text.includes(value)) found.push(`${file} : « ${value} »`);
    }
    for (const [name, value] of secrets) {
      if (value.length >= 8 && text.includes(value)) found.push(`${file} : secret (${name})`);
    }
    for (const pattern of [
      /dental_session=/i,
      /"cookie"\s*:/i,
      /"authorization"\s*:/i,
      /x-csrf-token"\s*:\s*"/i,
    ]) {
      if (pattern.test(text)) found.push(`${file} : ${pattern.source}`);
    }
  }
  const values = [...FORBIDDEN_IN_LOGS, ...TYPED_REASONS];
  const patterns = values.map((v) => `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  const tables = [
    'public.audit_logs',
    ...(
      await sql<{ name: string }>(
        `select format('%I.%I', schemaname, tablename) as name
           from pg_tables where schemaname = 'pgboss' order by tablename`,
      )
    ).map((t) => t.name),
  ];
  let rows = 0;
  for (const table of tables) {
    const [hit] = await sql<{ n: number; total: number }>(
      `select count(*) filter (where t::text ilike any($1))::int as n, count(*)::int as total
         from ${table} t`,
      [patterns],
    );
    rows += hit?.total ?? 0;
    if (hit && hit.n > 0) found.push(`${table} : ${hit.n} ligne(s) avec une donnée saisie`);
  }
  if (found.length > 0) {
    throw new Error(`Données saisies retrouvées :\n${found.join('\n')}`);
  }
  process.stdout.write(
    `[contrôle final] journaux et ${rows} lignes (audit, tâches) sans donnée saisie (${tables.length} tables)\n`,
  );
}
