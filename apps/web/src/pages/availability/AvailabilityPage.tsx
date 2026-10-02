import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert, Loading, SelectField } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { can, canManageSchedule, useMe } from '../../lib/auth';
import { CLINIC_QUERY_KEY } from '../../lib/queries';
import { ColorSwatch } from '../settings/colors';
import { BlocksPanel } from './BlocksPanel';
import { ScheduleEditor } from './ScheduleEditor';
import { WeekOverview } from './WeekOverview';

const TABS = [
  { id: 'week', label: 'Semaine' },
  { id: 'hours', label: 'Horaires' },
  { id: 'blocks', label: 'Absences et blocages' },
] as const;
type Tab = (typeof TABS)[number]['id'];

/**
 * Disponibilités par praticien. Avec un seul praticien, aucun choix n'est proposé ; avec
 * plusieurs, le praticien lié au compte connecté est présélectionné.
 */
export function AvailabilityPage() {
  const { data: me } = useMe();
  const clinic = useQuery({ queryKey: CLINIC_QUERY_KEY, queryFn: api.clinic });
  const practitioners = useQuery({
    queryKey: ['practitioners', 'active'],
    queryFn: () => api.listPractitioners(false),
  });
  // ?praticien=<id> : lien direct (mise en route, accueil).
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(params.get('praticien'));
  const [tab, setTab] = useState<Tab>('week');

  if (clinic.isPending || practitioners.isPending) return <Loading />;
  if (clinic.isError) return <Alert>{errorMessage(clinic.error)}</Alert>;
  if (practitioners.isError) return <Alert>{errorMessage(practitioners.error)}</Alert>;

  const list = practitioners.data;
  if (list.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Disponibilités</h1>
        <Alert tone="info">
          Aucun praticien n&apos;est encore enregistré.{' '}
          {can(me, 'clinic.settings.manage') ? (
            <Link className="underline" to="/cabinet/praticiens">
              Ajouter un praticien
            </Link>
          ) : (
            "Demandez à l'administrateur du cabinet de les ajouter."
          )}
        </Alert>
      </section>
    );
  }

  const own = list.find((p) => p.userId === me?.user.id);
  const practitioner = list.find((p) => p.id === selected) ?? own ?? list[0]!;
  const timeZone = clinic.data.timezone;
  const canEdit = canManageSchedule(me, practitioner);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Disponibilités</h1>
          {list.length === 1 && (
            <p className="flex items-center gap-2 text-slate-700">
              <ColorSwatch color={practitioner.color} /> {practitioner.displayName}
            </p>
          )}
        </div>
        {list.length > 1 && (
          <div className="min-w-64">
            <SelectField
              label="Praticien"
              value={practitioner.id}
              onChange={(e) => setSelected(e.target.value)}
            >
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                  {p.id === own?.id ? ' (moi)' : ''}
                </option>
              ))}
            </SelectField>
          </div>
        )}
      </div>
      {!canEdit && (
        <Alert tone="info">
          Consultation seule : vous ne pouvez modifier que votre propre agenda.
        </Alert>
      )}
      <div role="tablist" aria-label="Vue" className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium ${
              tab === t.id ? 'bg-sky-100 text-sky-900' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'week' && (
          <WeekOverview key={practitioner.id} practitioner={practitioner} timeZone={timeZone} />
        )}
        {tab === 'hours' && (
          <ScheduleEditor
            key={practitioner.id}
            practitioner={practitioner}
            timeZone={timeZone}
            canEdit={canEdit}
          />
        )}
        {tab === 'blocks' && (
          <BlocksPanel
            key={practitioner.id}
            practitioner={practitioner}
            timeZone={timeZone}
            canEdit={canEdit}
            canEditClinic={canManageSchedule(me, null)}
          />
        )}
      </div>
    </section>
  );
}
