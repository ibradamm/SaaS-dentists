import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Logger } from '../config/logger';
import * as schema from './schema';

export interface PoolOptions {
  connectionString: string;
  max: number;
  applicationName: string;
}

export function createPool(options: PoolOptions, logger?: Logger): pg.Pool {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max,
    application_name: options.applicationName,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    // Aucune requête ni transaction ne peut bloquer indéfiniment une connexion.
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
  });
  // Sans ce gestionnaire, une connexion inactive coupée par le serveur ferait planter le processus.
  pool.on('error', (error) => logger?.error({ err: error }, 'erreur sur une connexion inactive'));
  return pool;
}

export function createDb(pool: pg.Pool) {
  return drizzle({ client: pool, schema });
}

export type Database = ReturnType<typeof createDb>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
