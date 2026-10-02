import { loadMigrateConfig } from '../../config/env';
import { deployDatabase } from '../deploy';

const config = loadMigrateConfig();
const result = await deployDatabase(config.DATABASE_MIGRATION_URL, { log: console.log });
console.log(
  `Migrations : ${result.applied.length} appliquée(s), ${result.alreadyApplied} déjà en place.`,
);
