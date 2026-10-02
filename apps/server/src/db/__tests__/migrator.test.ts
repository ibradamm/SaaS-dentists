import { describe, expect, it } from 'vitest';
import { loadMigrations, MigrationError, planMigrations, type Migration } from '../migrator';

const m = (tag: string, hash = `h-${tag}`): Migration => ({ tag, hash, statements: ['SELECT 1'] });

describe('planification des migrations', () => {
  const all = [m('0000_a'), m('0001_b'), m('0002_c')];

  it('base vierge : toutes les migrations, dans l’ordre', () => {
    expect(planMigrations(all, []).map((x) => x.tag)).toEqual(['0000_a', '0001_b', '0002_c']);
  });

  it('base à jour : rien à appliquer', () => {
    expect(
      planMigrations(
        all,
        all.map(({ tag, hash }) => ({ tag, hash })),
      ),
    ).toEqual([]);
  });

  it('applique seulement les nouvelles migrations', () => {
    const applied = [{ tag: '0000_a', hash: 'h-0000_a' }];
    expect(planMigrations(all, applied).map((x) => x.tag)).toEqual(['0001_b', '0002_c']);
  });

  it('refuse une migration appliquée puis modifiée', () => {
    expect(() => planMigrations(all, [{ tag: '0000_a', hash: 'autre' }])).toThrow(/modifiée/);
  });

  it('refuse une base contenant une migration inconnue du code', () => {
    expect(() => planMigrations(all, [{ tag: '0009_z', hash: 'x' }])).toThrow(MigrationError);
  });

  it('refuse une migration non appliquée qui précède une migration appliquée', () => {
    const applied = [
      { tag: '0000_a', hash: 'h-0000_a' },
      { tag: '0002_c', hash: 'h-0002_c' },
    ];
    expect(() => planMigrations(all, applied)).toThrow(/précède/);
  });
});

describe('fichiers de migration du dépôt', () => {
  it('se chargent, dans l’ordre, sans migration vide', async () => {
    const migrations = await loadMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(3);
    expect(migrations.map((x) => x.tag)).toEqual([...migrations.map((x) => x.tag)].sort());
    for (const migration of migrations) expect(migration.statements.length).toBeGreaterThan(0);
  });
});
