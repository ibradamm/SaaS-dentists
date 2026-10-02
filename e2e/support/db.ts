import pg from 'pg';
import { databaseUrls } from './env';

/** Requête de contrôle indépendante de l'application (superutilisateur, sans RLS). */
export async function sql<T extends pg.QueryResultRow = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: databaseUrls().inspectUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, params)).rows;
  } finally {
    await client.end();
  }
}
