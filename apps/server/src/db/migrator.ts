import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClientBase } from 'pg';
import { z } from 'zod';

/**
 * Exécuteur de migrations strict (voir docs/adr/0002-migrations.md).
 *
 * drizzle-kit génère le SQL et le journal ; ce module les applique en garantissant :
 * - un seul exécuteur à la fois (verrou consultatif PostgreSQL) ;
 * - chaque migration dans sa propre transaction ;
 * - refus si une migration déjà appliquée a été modifiée (empreinte SHA-256) ;
 * - refus si la base contient une migration inconnue du code (code plus ancien que la base) ;
 * - refus si une migration non appliquée précède une migration appliquée (ordre cassé,
 *   typiquement après une fusion de branches) : elle ne sera jamais ignorée en silence.
 * Aucune migration descendante : correction par une nouvelle migration (fix-forward).
 */

const MIGRATION_LOCK_KEY = 72_615_001;
const BREAKPOINT = '--> statement-breakpoint';

const journalSchema = z.object({
  dialect: z.literal('postgresql'),
  entries: z.array(
    z.object({ idx: z.number().int(), tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/) }),
  ),
});

export interface Migration {
  tag: string;
  hash: string;
  statements: string[];
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

export const DEFAULT_MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

export async function loadMigrations(dir: string = DEFAULT_MIGRATIONS_DIR): Promise<Migration[]> {
  const journal = journalSchema.parse(
    JSON.parse(await readFile(path.join(dir, 'meta', '_journal.json'), 'utf8')),
  );
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);
  return Promise.all(
    entries.map(async ({ tag }) => {
      const content = await readFile(path.join(dir, `${tag}.sql`), 'utf8');
      const statements = content
        .split(BREAKPOINT)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (statements.length === 0) throw new MigrationError(`Migration vide : ${tag}`);
      return { tag, statements, hash: createHash('sha256').update(content).digest('hex') };
    }),
  );
}

interface AppliedRow {
  tag: string;
  hash: string;
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: number;
}

/** Vérifie la cohérence base/code et retourne les migrations à appliquer, dans l'ordre. */
export function planMigrations(migrations: Migration[], applied: AppliedRow[]): Migration[] {
  const known = new Map(migrations.map((m) => [m.tag, m]));
  for (const row of applied) {
    const migration = known.get(row.tag);
    if (!migration) {
      throw new MigrationError(
        `La base contient la migration « ${row.tag} », absente du code : le code déployé est plus ancien que la base.`,
      );
    }
    if (migration.hash !== row.hash) {
      throw new MigrationError(
        `La migration « ${row.tag} » a été modifiée après son application. Une migration appliquée est immuable : créer une nouvelle migration.`,
      );
    }
  }
  const appliedTags = new Set(applied.map((r) => r.tag));
  const lastAppliedIndex = migrations.reduce(
    (last, m, i) => (appliedTags.has(m.tag) ? i : last),
    -1,
  );
  const pending = migrations.filter((m) => !appliedTags.has(m.tag));
  const outOfOrder = pending.find((m) => migrations.indexOf(m) < lastAppliedIndex);
  if (outOfOrder) {
    throw new MigrationError(
      `La migration « ${outOfOrder.tag} » précède des migrations déjà appliquées : la renuméroter après la dernière migration appliquée.`,
    );
  }
  return pending;
}

export async function runMigrations(
  client: ClientBase,
  migrations: Migration[],
  log: (message: string) => void = () => undefined,
): Promise<MigrationResult> {
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS migrations');
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations.applied (
        tag text PRIMARY KEY,
        hash text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<AppliedRow>(
      'SELECT tag, hash FROM migrations.applied ORDER BY tag',
    );
    const pending = planMigrations(migrations, rows);
    for (const migration of pending) {
      await applyOne(client, migration);
      log(`migration appliquée : ${migration.tag}`);
    }
    return { applied: pending.map((m) => m.tag), alreadyApplied: rows.length };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  }
}

async function applyOne(client: ClientBase, migration: Migration): Promise<void> {
  await client.query('BEGIN');
  try {
    for (const statement of migration.statements) {
      await client.query(statement);
    }
    await client.query('INSERT INTO migrations.applied (tag, hash) VALUES ($1, $2)', [
      migration.tag,
      migration.hash,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw new MigrationError(
      `Échec de la migration « ${migration.tag} » : ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
