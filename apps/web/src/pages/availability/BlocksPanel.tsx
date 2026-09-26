import type {
  Appointment,
  AvailabilityBlock,
  BlockKind,
  CreateBlockRequest,
  Practitioner,
} from '@dental/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Loading, SelectField, TextField } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { addDays, todayIn } from '../../lib/dates';
import { ConflictsNotice } from '../agenda/ConflictsNotice';
import { BLOCK_KIND_LABELS, formatBlockPeriod } from './format';

interface FormState {
  kind: BlockKind;
  scope: 'PRACTITIONER' | 'CLINIC';
  allDay: boolean;
  startDate: string;
  endDate: string;
  date: string;
  startTime: string;
  endTime: string;
  label: string;
}

/**
 * Absences (le praticien ne travaille pas) et créneaux bloqués (présent mais non réservable),
 * pour un praticien ou tout le cabinet. Saisie en heure locale du cabinet.
 */
export function BlocksPanel({
  practitioner,
  timeZone,
  canEdit,
  canEditClinic,
}: {
  practitioner: Practitioner;
  timeZone: string;
  canEdit: boolean;
  canEditClinic: boolean;
}) {
  const queryClient = useQueryClient();
  const today = todayIn(timeZone);
  const blocks = useQuery({
    queryKey: ['blocks', practitioner.id, today],
    queryFn: () =>
      api.listBlocks({ from: today, to: addDays(today, 365), practitionerId: practitioner.id }),
  });
  const empty: FormState = {
    kind: 'ABSENCE',
    scope: 'PRACTITIONER',
    allDay: true,
    startDate: today,
    endDate: today,
    date: today,
    startTime: '12:00',
    endTime: '14:00',
    label: '',
  };
  const [form, setForm] = useState<FormState>(empty);
  const [saved, setSaved] = useState<{ kind: BlockKind; conflicts: Appointment[] } | null>(null);
  const refresh = async () => {
    // Disponibilités supprimées du cache (et non marquées périmées) : la semaine ne doit jamais
    // afficher l'état d'avant la modification, même le temps d'un rechargement.
    queryClient.removeQueries({ queryKey: ['availability'] });
    await queryClient.invalidateQueries({ queryKey: ['blocks'] });
  };

  const create = useMutation({
    mutationFn: () => {
      const base = {
        practitionerId: form.scope === 'CLINIC' ? null : practitioner.id,
        kind: form.kind,
        label: form.label.trim() || null,
      };
      const body: CreateBlockRequest = form.allDay
        ? { ...base, allDay: true, startDate: form.startDate, endDate: form.endDate }
        : {
            ...base,
            allDay: false,
            start: `${form.date}T${form.startTime}`,
            end: `${form.date}T${form.endTime}`,
          };
      return api.createBlock(body);
    },
    onSuccess: async (result) => {
      setForm(empty);
      setSaved({ kind: result.block.kind, conflicts: result.conflicts });
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (block: AvailabilityBlock) => api.deleteBlock(block.id, block.version),
    onSuccess: refresh,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }
  const set = (patch: Partial<FormState>) => {
    setForm({ ...form, ...patch });
    setSaved(null);
  };
  const canDelete = (b: AvailabilityBlock) => (b.practitionerId === null ? canEditClinic : canEdit);

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">À venir (12 mois)</h2>
        {blocks.isPending && <Loading />}
        {blocks.isError && <Alert>{errorMessage(blocks.error)}</Alert>}
        {blocks.data?.length === 0 && (
          <p className="text-sm text-slate-600">Aucune absence ni blocage prévu.</p>
        )}
        <ul className="flex flex-col gap-2" aria-label="Absences et blocages">
          {blocks.data?.map((b) => (
            <li
              key={b.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={b.kind === 'ABSENCE' ? 'warning' : 'neutral'}>
                  {BLOCK_KIND_LABELS[b.kind]}
                </Badge>
                <span className="font-medium">{formatBlockPeriod(b, timeZone)}</span>
                {b.practitionerId === null && <Badge tone="info">Tout le cabinet</Badge>}
                {b.label && <span className="text-slate-600">{b.label}</span>}
              </span>
              {canDelete(b) && (
                <Button
                  variant="danger"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Supprimer : ${BLOCK_KIND_LABELS[b.kind]}, ${formatBlockPeriod(b, timeZone)} ?`,
                      )
                    ) {
                      remove.mutate(b);
                    }
                  }}
                >
                  Supprimer
                </Button>
              )}
            </li>
          ))}
        </ul>
        {remove.isError && <Alert>{errorMessage(remove.error)}</Alert>}
      </section>

      {canEdit && (
        <form
          onSubmit={submit}
          className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4"
          noValidate
        >
          <h2 className="text-lg font-semibold">Ajouter une absence ou un blocage</h2>
          {create.isError && <Alert>{errorMessage(create.error)}</Alert>}
          {saved && (
            <ConflictsNotice
              conflicts={saved.conflicts}
              timeZone={timeZone}
              reason={saved.kind === 'ABSENCE' ? 'pendant cette absence' : 'sur ce créneau bloqué'}
            />
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField
              label="Type"
              value={form.kind}
              onChange={(e) => set({ kind: e.target.value as BlockKind })}
            >
              <option value="ABSENCE">Absence (congés, formation…)</option>
              <option value="BLOCK">Créneau bloqué (réunion, administratif…)</option>
            </SelectField>
            <SelectField
              label="Concerne"
              value={form.scope}
              onChange={(e) => set({ scope: e.target.value as FormState['scope'] })}
            >
              <option value="PRACTITIONER">{practitioner.displayName}</option>
              {canEditClinic && (
                <option value="CLINIC">Tout le cabinet (fermeture, jour férié)</option>
              )}
            </SelectField>
            <SelectField
              label="Durée"
              value={form.allDay ? 'DAYS' : 'HOURS'}
              onChange={(e) => set({ allDay: e.target.value === 'DAYS' })}
            >
              <option value="DAYS">Journées entières</option>
              <option value="HOURS">Quelques heures</option>
            </SelectField>
          </div>
          {form.allDay ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField
                label="Du"
                type="date"
                value={form.startDate}
                onChange={(e) => set({ startDate: e.target.value })}
              />
              <TextField
                label="Au (inclus)"
                type="date"
                min={form.startDate}
                value={form.endDate}
                onChange={(e) => set({ endDate: e.target.value })}
              />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField
                label="Date"
                type="date"
                value={form.date}
                onChange={(e) => set({ date: e.target.value })}
              />
              <TextField
                label="De"
                type="time"
                step={300}
                value={form.startTime}
                onChange={(e) => set({ startTime: e.target.value })}
              />
              <TextField
                label="À"
                type="time"
                step={300}
                value={form.endTime}
                onChange={(e) => set({ endTime: e.target.value })}
              />
            </div>
          )}
          <TextField
            label="Libellé (facultatif)"
            maxLength={100}
            value={form.label}
            onChange={(e) => set({ label: e.target.value })}
            hint="Visible par tout le personnel. Aucune information médicale : « Absence » suffit."
          />
          <p className="text-xs text-slate-600">Heures du cabinet ({timeZone}).</p>
          <div>
            <Button type="submit" disabled={create.isPending}>
              Ajouter
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
