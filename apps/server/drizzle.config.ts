import { defineConfig } from 'drizzle-kit';

// drizzle-kit sert uniquement à générer le SQL des migrations à partir du schéma.
// L'application des migrations est faite par src/db/migrator.ts (voir docs/adr/0002).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  strict: true,
  verbose: true,
});
