// Build de production : un fichier par point d'entrée, dépendances npm externes,
// paquets internes (@dental/*) intégrés au bundle. Les migrations SQL sont copiées à côté.
import { cp, readFile, rm } from 'node:fs/promises';
import { build } from 'esbuild';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@dental/'));

await rm('dist', { recursive: true, force: true });
await build({
  entryPoints: {
    'main-api': 'src/main-api.ts',
    'main-worker': 'src/main-worker.ts',
    bootstrap: 'src/db/cli/bootstrap.ts',
    migrate: 'src/db/cli/migrate.ts',
    'create-clinic': 'src/db/cli/create-clinic.ts',
    'create-admin': 'src/db/cli/create-admin.ts',
    'reset-mfa': 'src/db/cli/reset-mfa.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external,
  logLevel: 'info',
});
await cp('src/db/migrations', 'dist/migrations', { recursive: true });
