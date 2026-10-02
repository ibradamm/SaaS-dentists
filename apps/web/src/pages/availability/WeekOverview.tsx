import type { Practitioner } from '@dental/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Loading } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { addDays, formatDayLabel, localDateOf, startOfWeek, todayIn } from '../../lib/dates';
import { BLOCK_KIND_LABELS, formatWindows, lastLocalDate } from './format';

/** Semaine d'un praticien : horaires, disponibilités et indisponibilités, jour par jour. */
export function WeekOverview({
  practitioner,
  timeZone,
}: {
  practitioner: Practitioner;
  timeZone: string;
}) {
  const thisWeek = startOfWeek(todayIn(timeZone));
  const [weekStart, setWeekStart] = useState(thisWeek);
  const to = addDays(weekStart, 6);
  // Pas de données de la semaine précédente pendant le chargement : des lignes vides feraient
  // croire que le praticien ne travaille pas.
  const availability = useQuery({
    queryKey: ['availability', practitioner.id, weekStart],
    queryFn: () => api.availability({ from: weekStart, to, practitionerId: practitioner.id }),
  });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const data = availability.data;
  const mine = data?.practitioners.find((p) => p.practitionerId === practitioner.id);
  const onDay = (day: string) => (w: { start: string }) => localDateOf(w.start, timeZone) === day;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Semaine du {formatDayLabel(weekStart)}</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            Semaine précédente
          </Button>
          <Button
            variant="secondary"
            disabled={weekStart === thisWeek}
            onClick={() => setWeekStart(thisWeek)}
          >
            Cette semaine
          </Button>
          <Button variant="secondary" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            Semaine suivante
          </Button>
        </div>
      </div>
      {availability.isPending && <Loading />}
      {availability.isError && <Alert>{errorMessage(availability.error)}</Alert>}
      {data && mine && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">Disponibilités de {practitioner.displayName}</caption>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="p-2">Jour</th>
                <th className="p-2">Horaires</th>
                <th className="p-2">Disponible</th>
                <th className="p-2">Indisponibilités</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => {
                const blocks = data.blocks.filter(
                  (b) =>
                    localDateOf(b.startAt, timeZone) <= day &&
                    lastLocalDate(b.endAt, timeZone) >= day,
                );
                return (
                  <tr key={day} className="border-b border-slate-100 align-top">
                    <th scope="row" className="p-2 font-medium first-letter:uppercase">
                      {formatDayLabel(day)}
                    </th>
                    <td className="p-2">
                      {formatWindows(mine.working.filter(onDay(day)), timeZone)}
                    </td>
                    <td className="p-2 text-emerald-800">
                      {formatWindows(mine.available.filter(onDay(day)), timeZone)}
                    </td>
                    <td className="p-2">
                      {blocks.length === 0
                        ? '—'
                        : blocks.map((b) => (
                            <p key={b.id}>
                              {BLOCK_KIND_LABELS[b.kind]}
                              {b.practitionerId === null ? ' (tout le cabinet)' : ''}
                              {b.label ? ` : ${b.label}` : ''}
                              {b.allDay
                                ? ''
                                : ` ${formatWindows([{ start: b.startAt, end: b.endAt }], timeZone)}`}
                            </p>
                          ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-600">
        Heures du cabinet ({timeZone}). « Disponible » : horaires, moins les absences, les blocages
        et les rendez-vous déjà pris.
      </p>
    </div>
  );
}
