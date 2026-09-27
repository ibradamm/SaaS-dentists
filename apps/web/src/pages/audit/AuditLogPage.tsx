import {
  AUDIT_ENTITY_TYPES,
  auditActionSchema,
  auditEntityTypeSchema,
  periodError,
  type AuditLogEntry,
} from '@dental/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useId, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert, Button, Loading, SelectField, TextField } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { addDays, todayIn } from '../../lib/dates';
import { useClinic } from '../../lib/queries';
import {
  actionGroups,
  actorLabel,
  auditActionLabel,
  describeChanges,
  entityTypeLabel,
  formatWhen,
} from './format';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Filtres lus dans l'adresse : un lien « historique de cet élément » se partage et se rouvre. */
function filtersOf(params: URLSearchParams, today: string) {
  const uuid = (key: string) => {
    const v = params.get(key);
    return v && UUID.test(v) ? v : undefined;
  };
  const action = auditActionSchema.safeParse(params.get('action'));
  const entityType = auditEntityTypeSchema.safeParse(params.get('element'));
  return {
    from: params.get('du') ?? addDays(today, -6),
    to: params.get('au') ?? today,
    actorId: uuid('utilisateur'),
    action: action.success ? action.data : undefined,
    entityType: entityType.success ? entityType.data : undefined,
    entityId: entityType.success ? uuid('id') : undefined,
  };
}
type Filters = ReturnType<typeof filtersOf>;

/**
 * « Journal » (docs/adr/0011) : qui a fait quoi, quand, sur quel élément. Lecture seule,
 * réservée à audit.read ; le serveur filtre et pagine, l'interface affiche.
 */
export function AuditLogPage() {
  const clinic = useClinic();
  const [params, setParams] = useSearchParams();
  const actors = useQuery({ queryKey: ['audit-actors'], queryFn: api.auditActors });
  const timeZone = clinic.data?.timezone ?? 'Europe/Paris';
  const filters = filtersOf(params, todayIn(timeZone));
  const invalid = periodError(filters.from, filters.to);
  const log = useInfiniteQuery({
    queryKey: ['audit-logs', filters],
    queryFn: ({ pageParam }) =>
      api.auditLogs({ ...filters, ...(pageParam ? { before: pageParam } : {}) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: clinic.isSuccess && invalid === null,
  });

  function update(next: Partial<Filters>) {
    const merged = { ...filters, ...next };
    const out = new URLSearchParams();
    out.set('du', merged.from);
    out.set('au', merged.to);
    if (merged.actorId) out.set('utilisateur', merged.actorId);
    if (merged.action) out.set('action', merged.action);
    if (merged.entityType) out.set('element', merged.entityType);
    if (merged.entityType && merged.entityId) out.set('id', merged.entityId);
    setParams(out);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = data.get(key);
      return typeof value === 'string' && value !== '' ? value : undefined;
    };
    const entityType = auditEntityTypeSchema.safeParse(text('element'));
    update({
      from: text('du') ?? filters.from,
      to: text('au') ?? filters.to,
      actorId: text('utilisateur'),
      action: auditActionSchema.safeParse(text('action')).data,
      entityType: entityType.data,
      // Changer de type d'élément retire l'élément précis choisi.
      entityId: entityType.data === filters.entityType ? filters.entityId : undefined,
    });
  }

  if (clinic.isPending) return <Loading />;
  if (clinic.isError) return <Alert>{errorMessage(clinic.error)}</Alert>;
  const entries = log.data?.pages.flatMap((p) => p.entries) ?? [];
  const context = { timeZone, currency: clinic.data.currency };

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Journal</h1>
        <p className="text-sm text-slate-600">
          Actions enregistrées dans le cabinet : connexions, fiches patients, rendez-vous,
          encaissements, réglages. Le journal ne contient ni le contenu des notes ni les
          informations saisies, seulement ce qui a été fait.
        </p>
      </div>

      {/* key : le formulaire reprend les filtres de l'adresse après chaque navigation. */}
      <form
        key={params.toString()}
        role="search"
        aria-label="Filtres du journal"
        onSubmit={submit}
        className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <TextField label="Du" name="du" type="date" defaultValue={filters.from} required />
        <TextField label="Au" name="au" type="date" defaultValue={filters.to} required />
        <SelectField label="Utilisateur" name="utilisateur" defaultValue={filters.actorId ?? ''}>
          <option value="">Tous</option>
          {actors.data?.actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.active ? '' : ' (désactivé)'}
            </option>
          ))}
        </SelectField>
        <SelectField label="Action" name="action" defaultValue={filters.action ?? ''}>
          <option value="">Toutes</option>
          {actionGroups().map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.actions.map((a) => (
                <option key={a} value={a}>
                  {auditActionLabel(a)}
                </option>
              ))}
            </optgroup>
          ))}
        </SelectField>
        <SelectField label="Élément" name="element" defaultValue={filters.entityType ?? ''}>
          <option value="">Tous</option>
          {AUDIT_ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {entityTypeLabel(t)}
            </option>
          ))}
        </SelectField>
        <div className="flex items-end">
          <Button type="submit" className="w-full sm:w-auto">
            Filtrer
          </Button>
        </div>
      </form>

      {filters.entityId && (
        <Alert tone="info">
          Historique d’un seul élément ({entityTypeLabel(filters.entityType ?? null)}).{' '}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => update({ entityId: undefined })}
          >
            Voir tous les éléments
          </button>
        </Alert>
      )}
      {invalid && <Alert>{invalid}</Alert>}
      {log.isError && <Alert>{errorMessage(log.error)}</Alert>}
      {log.isPending && !invalid && <Loading />}
      {log.isSuccess && entries.length === 0 && (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-slate-600">
          Aucune action enregistrée pour ces critères.
        </p>
      )}
      {entries.length > 0 && (
        <ol
          aria-label="Entrées du journal"
          className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white"
        >
          {entries.map((e) => (
            <Entry
              key={e.id}
              entry={e}
              context={context}
              onHistory={() =>
                update({
                  entityType: auditEntityTypeSchema.safeParse(e.entityType).data,
                  entityId: e.entityId ?? undefined,
                  action: undefined,
                  actorId: undefined,
                })
              }
            />
          ))}
        </ol>
      )}
      {log.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          disabled={log.isFetchingNextPage}
          onClick={() => void log.fetchNextPage()}
        >
          {log.isFetchingNextPage ? 'Chargement…' : 'Afficher les entrées plus anciennes'}
        </Button>
      )}
    </section>
  );
}

function Entry({
  entry,
  context,
  onHistory,
}: {
  entry: AuditLogEntry;
  context: { timeZone: string; currency: string };
  onHistory: () => void;
}) {
  const titleId = useId();
  const details = describeChanges(entry.changes, context);
  const label = entry.entity?.label;
  return (
    <li aria-labelledby={titleId} className="flex flex-col gap-1 p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span id={titleId} className="font-medium text-slate-900">
          {auditActionLabel(entry.action)}
        </span>
        <span className="text-slate-600">
          {formatWhen(entry.createdAt, context.timeZone)} · {actorLabel(entry)}
        </span>
      </div>
      {entry.entityType && entry.entityType !== 'clinic' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-slate-700">
            {entityTypeLabel(entry.entityType)}
            {label ? ' : ' : ''}
            {label && entry.entity?.patientId ? (
              <Link className="text-sky-800 underline" to={`/patients/${entry.entity.patientId}`}>
                {label}
              </Link>
            ) : (
              label
            )}
          </span>
          {entry.entityId && (
            <button type="button" className="text-sky-800 underline" onClick={onHistory}>
              Historique de cet élément
            </button>
          )}
        </div>
      )}
      {details.length > 0 && <p className="text-slate-600">{details.join(' · ')}</p>}
      {entry.ip && <p className="text-xs text-slate-500">Adresse IP : {entry.ip}</p>}
    </li>
  );
}
