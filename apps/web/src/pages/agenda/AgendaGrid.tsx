import type { Appointment, AvailabilityResponse } from '@dental/shared';
import type { MouseEvent, ReactNode } from 'react';
import { formatMinutes, formatTime } from '../../lib/dates';
import { BLOCK_KIND_LABELS } from '../availability/format';
import { APPOINTMENT_STATUS_LABELS } from './labels';
import { assignLanes, gridBounds, minuteAt, segmentOn, type Segment } from './layout';

/** 15 minutes = 24 px : un rendez-vous de 30 minutes affiche deux lignes lisibles. */
const PX_PER_MINUTE = 1.6;

export interface AgendaColumn {
  key: string;
  day: string;
  practitionerId: string;
  header: ReactNode;
  /** Contexte annoncé avant chaque rendez-vous de la colonne (jour ou praticien). */
  srContext: string;
  isToday: boolean;
}

const STATUS_STYLES: Record<Appointment['status'], string> = {
  SCHEDULED: 'bg-white',
  COMPLETED: 'bg-emerald-50',
  NO_SHOW: 'bg-amber-50',
  CANCELLED: 'bg-slate-50 text-slate-500 line-through',
};

const HATCH = {
  backgroundImage:
    'repeating-linear-gradient(135deg, rgb(203 213 225 / 0.7) 0 6px, transparent 6px 12px)',
};

/**
 * Grille de l'agenda en heure murale du cabinet. Chaque rendez-vous est un bouton ; un clic
 * sur un espace libre propose un rendez-vous à ce quart d'heure (le bouton « Nouveau
 * rendez-vous » offre la même chose au clavier).
 */
export function AgendaGrid({
  columns,
  appointments,
  availability,
  timeZone,
  nowMinutes,
  onSelect,
  onSlot,
}: {
  columns: AgendaColumn[];
  appointments: Appointment[];
  availability: AvailabilityResponse;
  timeZone: string;
  nowMinutes: number;
  onSelect: (id: string) => void;
  onSlot: ((column: AgendaColumn, minute: number) => void) | null;
}) {
  const data = columns.map((column) => {
    const own = availability.practitioners.find((p) => p.practitionerId === column.practitionerId);
    const on = (list: { start: string; end: string }[]) =>
      list.flatMap((w) => segmentOn(w.start, w.end, column.day, timeZone) ?? []);
    const blocks = availability.blocks.flatMap((b) => {
      if (b.practitionerId !== null && b.practitionerId !== column.practitionerId) return [];
      const segment = segmentOn(b.startAt, b.endAt, column.day, timeZone);
      return segment ? [{ ...segment, block: b }] : [];
    });
    const booked = appointments.flatMap((a) => {
      if (a.practitionerId !== column.practitionerId) return [];
      const segment = segmentOn(a.startAt, a.endAt, column.day, timeZone);
      return segment ? [{ ...segment, appointment: a }] : [];
    });
    return { column, working: on(own?.working ?? []), blocks, booked: assignLanes(booked) };
  });
  const bounds = gridBounds(
    data.flatMap((d) => [...d.working, ...d.booked, ...d.blocks.filter((b) => !b.block.allDay)]),
  );
  const height = (bounds.end - bounds.start) * PX_PER_MINUTE;
  const y = (minute: number) => (Math.max(minute, bounds.start) - bounds.start) * PX_PER_MINUTE;
  const h = (s: Segment) =>
    Math.max((Math.min(s.end, bounds.end) - Math.max(s.start, bounds.start)) * PX_PER_MINUTE, 0);
  const hours: number[] = [];
  for (let m = bounds.start; m < bounds.end; m += 60) hours.push(m);

  const slotClick = (column: AgendaColumn) => (event: MouseEvent<HTMLDivElement>) => {
    if (!onSlot) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onSlot(column, minuteAt(event.clientY - rect.top, PX_PER_MINUTE, bounds.start));
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div
        className="grid min-w-full"
        style={{
          gridTemplateColumns: `3.5rem repeat(${columns.length}, minmax(9rem, 1fr))`,
        }}
      >
        <div className="border-b border-slate-200 bg-slate-50" />
        {columns.map((c) => (
          <div
            key={c.key}
            className={`border-b border-l border-slate-200 px-2 py-2 text-sm font-medium ${
              c.isToday ? 'bg-sky-50 text-sky-900' : 'bg-slate-50'
            }`}
          >
            {c.header}
          </div>
        ))}

        <div className="relative" style={{ height }} aria-hidden="true">
          {hours.map((m) => (
            <span
              key={m}
              className="absolute right-1 -translate-y-1/2 text-xs text-slate-500"
              style={{ top: y(m) }}
            >
              {m === bounds.start ? '' : formatMinutes(m)}
            </span>
          ))}
        </div>
        {data.map(({ column, working, blocks, booked }) => (
          <div
            key={column.key}
            className="relative border-l border-slate-200 bg-slate-100"
            style={{ height }}
          >
            <div
              className={`absolute inset-0 ${onSlot ? 'cursor-pointer' : ''}`}
              aria-hidden="true"
              data-testid={`grille-${column.key}`}
              onClick={slotClick(column)}
            >
              {working.map((w) => (
                <div
                  key={w.start}
                  className="pointer-events-none absolute inset-x-0 bg-white"
                  style={{ top: y(w.start), height: h(w) }}
                />
              ))}
              {hours.map((m) => (
                <div
                  key={m}
                  className="pointer-events-none absolute inset-x-0 border-t border-slate-200"
                  style={{ top: y(m) }}
                />
              ))}
            </div>
            {blocks.map(({ block, ...segment }) => (
              <div
                key={block.id}
                className="pointer-events-none absolute inset-x-0 overflow-hidden px-1 text-xs text-slate-700"
                style={{ ...HATCH, top: y(segment.start), height: h(segment) }}
              >
                <span className="rounded bg-white/90 px-1">
                  {BLOCK_KIND_LABELS[block.kind]}
                  {block.label ? ` : ${block.label}` : ''}
                </span>
              </div>
            ))}
            {column.isToday && nowMinutes >= bounds.start && nowMinutes < bounds.end && (
              <div
                className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500"
                style={{ top: y(nowMinutes) }}
                aria-hidden="true"
              />
            )}
            {booked.map(({ appointment: a, lane, lanes, ...segment }) => {
              const time = `${formatTime(a.startAt, timeZone)}–${formatTime(a.endAt, timeZone)}`;
              const name = `${a.patient.lastName.toUpperCase()} ${a.patient.firstName}`;
              const status = APPOINTMENT_STATUS_LABELS[a.status];
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onSelect(a.id)}
                  // Nom annoncé complet et stable (contexte, heure, patient, type, statut) ; il
                  // reprend le texte visible.
                  aria-label={`${column.srContext}, ${time} ${name}, ${a.appointmentType.name}, ${status}`}
                  className={`absolute overflow-hidden rounded border-l-4 px-1 text-left text-xs leading-4 text-slate-900 shadow-sm ring-1 ring-slate-300 hover:ring-2 hover:ring-sky-600 focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-sky-700 ${STATUS_STYLES[a.status]}`}
                  style={{
                    top: y(segment.start),
                    height: Math.max(h(segment), 16),
                    left: `calc(${(lane / lanes) * 100}% + 2px)`,
                    width: `calc(${100 / lanes}% - 4px)`,
                    borderLeftColor: a.appointmentType.color,
                  }}
                >
                  <span className="font-semibold">{time}</span> {name}
                  <span className="block truncate">
                    {a.appointmentType.name}
                    {a.status === 'SCHEDULED' ? '' : ` · ${status}`}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
