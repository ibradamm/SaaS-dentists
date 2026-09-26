import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatDayLabel,
  formatTime,
  isoWeekday,
  localDateOf,
  startOfWeek,
  todayIn,
} from './dates';

describe('dates dans le fuseau du cabinet', () => {
  it('date du jour et heures selon le fuseau du cabinet, pas celui du poste', () => {
    const lateEvening = new Date('2026-09-26T23:30:00Z');
    expect(todayIn('Europe/Paris', lateEvening)).toBe('2026-09-27');
    expect(todayIn('America/Martinique', lateEvening)).toBe('2026-09-26');
    expect(formatTime('2026-09-28T07:00:00.000Z', 'Europe/Paris')).toBe('09:00');
    expect(formatTime('2026-12-28T08:00:00.000Z', 'Europe/Paris')).toBe('09:00');
    expect(localDateOf('2026-09-27T22:30:00.000Z', 'Europe/Paris')).toBe('2026-09-28');
  });

  it('calendrier : jours ISO, lundi de la semaine, passage de mois et d’année', () => {
    expect(isoWeekday('2026-09-28')).toBe(1);
    expect(isoWeekday('2026-10-04')).toBe(7);
    expect(startOfWeek('2026-10-04')).toBe('2026-09-28');
    expect(startOfWeek('2026-09-28')).toBe('2026-09-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    // Pas de décalage au changement d'heure : calcul sur le calendrier.
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(formatDayLabel('2026-09-28')).toBe('lundi 28 septembre');
  });
});
