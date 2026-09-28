import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatDateTime } from './format-date';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/**
 * Fuseau du cabinet partout (ADR 0006) : le poste peut être réglé sur un autre fuseau (bug
 * trouvé en Phase 10 : imports et notes médicales affichés à l'heure du navigateur).
 */
describe('affichage des dates : fuseau du cabinet, jamais celui du poste', () => {
  it('formatDateTime suit le fuseau demandé', () => {
    const instant = '2026-09-28T00:13:00Z';
    expect(formatDateTime(instant, 'Europe/Paris')).toBe('28/09/2026 02:13');
    expect(formatDateTime(instant, 'America/New_York')).toBe('27/09/2026 20:13');
  });

  it('aucun Intl.DateTimeFormat sans timeZone, aucun toLocaleDateString / toLocaleTimeString', () => {
    const offenders: string[] = [];
    for (const file of sources(path.resolve(import.meta.dirname, '..'))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/new Intl\.DateTimeFormat\(/g)) {
        const call = text.slice(match.index, text.indexOf(')', text.indexOf('}', match.index)) + 1);
        if (!/timeZone/.test(call)) offenders.push(`${path.basename(file)} : ${call.slice(0, 80)}`);
      }
      if (/\.toLocale(Date|Time)String\(/.test(text))
        offenders.push(`${path.basename(file)} : toLocale…String`);
    }
    expect(offenders).toEqual([]);
  });
});
