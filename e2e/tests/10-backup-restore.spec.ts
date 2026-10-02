import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import pg from 'pg';
import { createSecretBox, parseEncryptionKey } from '../../apps/server/src/lib/secret-box';
import { api, createPatient, setupClinic, signIn } from '../support/app';
import { DATABASE_NAME, databaseUrls } from '../support/env';
import { MEDICAL_NOTE, PATIENTS } from '../support/sentinels';

/*
 * Sauvegarde et restauration de la base réelle des parcours (tout ce que les tests précédents
 * ont écrit, un an d'activité compris) : pg_dump au format personnalisé, restauration dans une
 * base neuve, puis comparaison. Vérifie ce qu'une restauration doit rendre intact : les
 * données, l'isolation (RLS activée et forcée, politiques), les droits du rôle applicatif, les
 * migrations appliquées. Ne remplace pas l'exercice de restauration de l'hébergement réel
 * (Phase 11 : PITR, sauvegardes hors site).
 */
test.setTimeout(300_000);

const RESTORED = `${DATABASE_NAME}_restauree`;
const urls = databaseUrls();
const withDatabase = (url: string, database: string) => {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
};

async function query<T extends pg.QueryResultRow>(
  url: string,
  text: string,
  params: unknown[] = [],
) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(text, params)).rows;
  } finally {
    await client.end();
  }
}

/** Empreinte comparable d'une base : lignes par table, sécurité, droits, migrations. */
async function fingerprint(url: string) {
  const tables = await query<{ name: string }>(
    url,
    `select format('%I.%I', n.nspname, c.relname) as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname in ('public', 'pgboss', 'migrations')
      order by 1`,
  );
  const rows: Record<string, number> = {};
  for (const { name } of tables) {
    rows[name] = (await query<{ n: number }>(url, `select count(*)::int as n from ${name}`))[0]!.n;
  }
  const security = await query<{ name: string; rls: boolean; forced: boolean; policies: number }>(
    url,
    `select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
            (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by 1`,
  );
  const grants = await query<{ grant: string }>(
    url,
    `select table_schema || '.' || table_name || ':' || string_agg(privilege_type, ',' order by privilege_type) as grant
       from information_schema.role_table_grants where grantee = 'dental_app'
      group by table_schema, table_name order by 1`,
  );
  const owners = await query<{ owner: string; n: number }>(
    url,
    `select pg_get_userbyid(c.relowner) as owner, count(*)::int as n
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' group by 1 order by 1`,
  );
  return { rows, security, grants: grants.map((g) => g.grant), owners };
}

test('sauvegarde puis restauration dans une base neuve : données, isolation et droits intacts', async ({
  browser,
}) => {
  // Une note médicale chiffrée par l'application, pour le scénario de la clé plus bas.
  const clinic = await setupClinic(browser, 'Cabinet Sauvegardé');
  const patientId = await createPatient(clinic.adminPage, ...PATIENTS.d);
  const dentist = await signIn(browser, clinic.dentist);
  const note = await api(dentist, 'POST', `/api/patients/${patientId}/medical-notes`, {
    content: MEDICAL_NOTE,
  });
  expect(note.status).toBe(204);
  await dentist.context().close();
  const source = urls.inspectUrl;
  const restored = withDatabase(urls.inspectUrl, RESTORED);
  const dir = mkdtempSync(path.join(tmpdir(), 'dental-sauvegarde-'));
  const dump = path.join(dir, 'base.dump');
  try {
    const before = await fingerprint(source);
    let started = Date.now();
    execFileSync('pg_dump', ['--format=custom', '--file', dump, source], { stdio: 'pipe' });
    const dumpMs = Date.now() - started;
    await query(urls.adminUrl, `drop database if exists ${RESTORED} with (force)`);
    await query(urls.adminUrl, `create database ${RESTORED}`);
    started = Date.now();
    execFileSync('pg_restore', ['--exit-on-error', '--dbname', restored, dump], { stdio: 'pipe' });
    const restoreMs = Date.now() - started;
    const after = await fingerprint(restored);
    test.info().annotations.push({
      type: 'sauvegarde',
      description: JSON.stringify({
        pgDump: execFileSync('pg_dump', ['--version']).toString().trim(),
        sizeBytes: statSync(dump).size,
        dumpMs,
        restoreMs,
        rows: Object.values(before.rows).reduce((a, b) => a + b, 0),
      }),
    });

    expect(after.rows).toEqual(before.rows);
    expect(after.security).toEqual(before.security);
    expect(after.grants).toEqual(before.grants);
    expect(after.owners).toEqual(before.owners);
    // Toutes les tables métier : RLS activée, forcée, au moins une politique.
    for (const t of after.security) {
      expect({ table: t.name, rls: t.rls, forced: t.forced, policy: t.policies > 0 }).toEqual({
        table: t.name,
        rls: true,
        forced: true,
        policy: true,
      });
    }
    expect(before.rows['migrations.applied']).toBeGreaterThanOrEqual(19);

    // Rôle applicatif sur la base restaurée : un cabinet ne voit que ses patients, rien sans
    // contexte.
    const [clinic] = await query<{ id: string; n: number }>(
      source,
      `select clinic_id as id, count(*)::int as n from patients group by 1 order by 2 desc limit 1`,
    );
    const app = new pg.Client({ connectionString: withDatabase(urls.appUrl, RESTORED) });
    await app.connect();
    try {
      const none = await app.query<{ n: number }>('select count(*)::int as n from patients');
      expect(none.rows[0]?.n).toBe(0);
      await app.query('begin');
      await app.query(`select set_config('app.clinic_id', $1, true)`, [clinic!.id]);
      const own = await app.query<{ n: number; others: number }>(
        `select count(*)::int as n, count(*) filter (where clinic_id <> $1)::int as others
           from patients`,
        [clinic!.id],
      );
      await app.query('commit');
      expect(own.rows[0]).toEqual({ n: clinic!.n, others: 0 });
    } finally {
      await app.end();
    }

    // Clé de chiffrement (DATA_ENCRYPTION_KEY) : absente de la sauvegarde, indispensable pour
    // relire les notes médicales. Base restaurée + clé restaurée depuis son propre coffre :
    // notes lisibles ; avec une autre clé : refus (chiffrement authentifié), jamais un texte faux.
    const plain = path.join(dir, 'base.sql');
    execFileSync('pg_dump', ['--format=plain', '--file', plain, source], { stdio: 'pipe' });
    const key = process.env.E2E_DATA_ENCRYPTION_KEY ?? '';
    expect(key.length).toBeGreaterThan(40);
    expect(readFileSync(plain, 'utf8').includes(key)).toBe(false);
    const [stored] = await query<{ id: string; content_enc: string }>(
      restored,
      `select n.id, n.content_enc from patient_medical_notes n where n.patient_id = $1`,
      [patientId],
    );
    expect(stored?.content_enc.startsWith('v1.')).toBe(true);
    const context = `patient_medical_notes:${stored!.id}`;
    expect(createSecretBox(parseEncryptionKey(key)).decrypt(stored!.content_enc, context)).toBe(
      MEDICAL_NOTE,
    );
    expect(() => createSecretBox(randomBytes(32)).decrypt(stored!.content_enc, context)).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await query(urls.adminUrl, `drop database if exists ${RESTORED} with (force)`);
  }
});
