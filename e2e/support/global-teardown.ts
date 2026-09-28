import { existsSync, readFileSync } from 'node:fs';
import { sql } from './db';
import { API_LOG, WORKER_LOG } from './env';
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
  for (const file of [API_LOG, WORKER_LOG]) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const value of FORBIDDEN_IN_LOGS) {
      if (text.includes(value)) found.push(`${file} : « ${value} »`);
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
