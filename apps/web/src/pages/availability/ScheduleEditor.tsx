import {
  setScheduleRequestSchema,
  type Appointment,
  type Practitioner,
  type SchedulePeriod,
  type WeeklyIntervalInput,
} from '@dental/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Loading, TextField } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { WEEKDAY_LABELS, addDays, formatLocalDate, todayIn } from '../../lib/dates';
import { ConflictsNotice } from '../agenda/ConflictsNotice';

const scheduleKey = (id: string) => ['schedules', id] as const;

function periodLabel(period: SchedulePeriod, today: string) {
  const range = period.validTo
    ? `Du ${formatLocalDate(period.validFrom)} au ${formatLocalDate(addDays(period.validTo, -1))}`
    : `Depuis le ${formatLocalDate(period.validFrom)}`;
  const state =
    period.validFrom > today
      ? 'Prévu'
      : period.validTo !== null && period.validTo <= today
        ? 'Terminé'
        : 'En cours';
  return { range, state };
}

function summary(intervals: SchedulePeriod['intervals']): string {
  if (intervals.length === 0) return 'Aucune plage : pas de travail';
  return WEEKDAY_LABELS.map((label, i) => {
    const day = intervals.filter((x) => x.weekday === i + 1);
    return day.length === 0 ? null : `${label} ${day.map((x) => `${x.start}–${x.end}`).join(', ')}`;
  })
    .filter(Boolean)
    .join(' · ');
}

/**
 * Horaires hebdomadaires en heure locale du cabinet, applicables à partir d'une date : les
 * semaines passées et les changements déjà prévus ne sont pas modifiés (docs/adr/0006).
 */
export function ScheduleEditor({
  practitioner,
  timeZone,
  canEdit,
}: {
  practitioner: Practitioner;
  timeZone: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const today = todayIn(timeZone);
  const periods = useQuery({
    queryKey: scheduleKey(practitioner.id),
    queryFn: () => api.listSchedules(practitioner.id),
  });
  const [validFrom, setValidFrom] = useState(today);
  const [draft, setDraft] = useState<WeeklyIntervalInput[] | null>(null);
  // Rendez-vous devenus hors horaires, selon l'action qui les a signalés.
  const [conflicts, setConflicts] = useState<{ from: 'save' | 'remove'; list: Appointment[] }>({
    from: 'save',
    list: [],
  });

  const covering =
    periods.data?.find(
      (p) => p.validFrom <= validFrom && (p.validTo === null || validFrom < p.validTo),
    ) ?? null;
  const intervals: WeeklyIntervalInput[] = draft ?? covering?.intervals ?? [];

  const onSaved = (
    from: 'save' | 'remove',
    updated: { periods: SchedulePeriod[]; conflicts: Appointment[] },
  ) => {
    queryClient.setQueryData(scheduleKey(practitioner.id), updated.periods);
    setDraft(null);
    setConflicts({ from, list: updated.conflicts });
    // Voir BlocksPanel : jamais d'anciennes disponibilités affichées après une modification
    // (semaine du praticien comme agenda du cabinet).
    queryClient.removeQueries({ queryKey: ['availability'] });
  };
  const save = useMutation({
    mutationFn: () =>
      api.setSchedule(practitioner.id, {
        validFrom,
        basePeriod: covering ? { id: covering.id, version: covering.version } : null,
        intervals,
      }),
    onSuccess: (updated) => onSaved('save', updated),
  });
  const remove = useMutation({
    mutationFn: (period: SchedulePeriod) =>
      api.deleteSchedulePeriod(practitioner.id, period.id, period.version),
    onSuccess: (updated) => onSaved('remove', updated),
  });

  const validation = setScheduleRequestSchema.safeParse({ validFrom, basePeriod: null, intervals });
  const problem = validation.success
    ? null
    : (validation.error.issues[0]?.message ?? 'Horaires invalides');

  const update = (index: number, patch: Partial<WeeklyIntervalInput>) =>
    setDraft(intervals.map((x, i) => (i === index ? { ...x, ...patch } : x)));
  const addInterval = (weekday: number) => {
    const last = intervals.filter((x) => x.weekday === weekday).at(-1);
    const next = last
      ? { weekday, start: last.end, end: last.end < '18:00' ? '18:00' : '24:00' }
      : { weekday, start: '09:00', end: '12:00' };
    setDraft([...intervals, next]);
  };

  if (periods.isPending) return <Loading />;
  if (periods.isError) return <Alert>{errorMessage(periods.error)}</Alert>;

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Périodes d&apos;horaires</h2>
        {periods.data.length === 0 && (
          <Alert tone="info">Aucun horaire : ce praticien n&apos;a aucune disponibilité.</Alert>
        )}
        <ul className="flex flex-col gap-2">
          {periods.data.map((p) => {
            const { range, state } = periodLabel(p, today);
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <span className="flex flex-col gap-1">
                  <span className="flex items-center gap-2 font-medium">
                    {range} <Badge tone={state === 'En cours' ? 'info' : 'neutral'}>{state}</Badge>
                  </span>
                  <span className="text-slate-600">{summary(p.intervals)}</span>
                </span>
                {canEdit && state === 'Prévu' && (
                  <Button
                    variant="danger"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm('Supprimer ce changement d’horaires prévu ?'))
                        remove.mutate(p);
                    }}
                  >
                    Supprimer
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {remove.isError && <Alert>{errorMessage(remove.error)}</Alert>}
        {conflicts.from === 'remove' && (
          <ConflictsNotice
            conflicts={conflicts.list}
            timeZone={timeZone}
            reason="désormais en dehors des horaires"
          />
        )}
      </section>

      {canEdit && (
        <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold">Modifier les horaires</h2>
          <div className="max-w-xs">
            <TextField
              label="Applicables à partir du"
              type="date"
              min={today}
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
              hint="Les semaines précédentes gardent leurs horaires actuels."
            />
          </div>
          <div className="flex flex-col gap-2">
            {WEEKDAY_LABELS.map((label, i) => {
              const weekday = i + 1;
              return (
                <fieldset
                  key={label}
                  className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-2"
                >
                  <legend className="w-24 text-sm font-medium">{label}</legend>
                  {intervals.map((interval, index) => {
                    if (interval.weekday !== weekday) return null;
                    // Numéro de la plage dans sa journée (« lundi, plage 2 »), pas dans la semaine.
                    const position = intervals
                      .slice(0, index + 1)
                      .filter((x) => x.weekday === weekday).length;
                    return (
                      <span
                        key={index}
                        className="flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1"
                      >
                        <input
                          type="time"
                          step={300}
                          aria-label={`${label}, début de la plage ${position}`}
                          className="min-h-11 rounded border border-slate-300 px-2"
                          value={interval.start}
                          onChange={(e) => update(index, { start: e.target.value })}
                        />
                        <span aria-hidden="true">–</span>
                        <input
                          type="time"
                          step={300}
                          aria-label={`${label}, fin de la plage ${position}`}
                          className="min-h-11 rounded border border-slate-300 px-2"
                          value={interval.end === '24:00' ? '23:59' : interval.end}
                          onChange={(e) =>
                            update(index, {
                              end: e.target.value === '23:59' ? '24:00' : e.target.value,
                            })
                          }
                        />
                        <Button
                          variant="secondary"
                          aria-label={`Retirer la plage ${interval.start}–${interval.end} du ${label.toLowerCase()}`}
                          onClick={() => setDraft(intervals.filter((_, j) => j !== index))}
                        >
                          Retirer
                        </Button>
                      </span>
                    );
                  })}
                  <Button variant="secondary" onClick={() => addInterval(weekday)}>
                    Ajouter une plage
                  </Button>
                </fieldset>
              );
            })}
          </div>
          {problem && draft && <Alert>{problem}</Alert>}
          {save.isError && <Alert>{errorMessage(save.error)}</Alert>}
          {save.isSuccess && draft === null && <Alert tone="success">Horaires enregistrés.</Alert>}
          {draft === null && conflicts.from === 'save' && (
            <ConflictsNotice
              conflicts={conflicts.list}
              timeZone={timeZone}
              reason="désormais en dehors des horaires"
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={draft === null || save.isPending || problem !== null || validFrom < today}
              onClick={() => save.mutate()}
            >
              Enregistrer à partir du {formatLocalDate(validFrom || today)}
            </Button>
            {draft && (
              <Button variant="secondary" onClick={() => setDraft(null)}>
                Annuler les modifications
              </Button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
