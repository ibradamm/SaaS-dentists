import { formatCents } from '@dental/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Alert } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { useDashboard } from '../../lib/queries';

function Indicator({ label, value, link }: { label: string; value: string; link: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-slate-200 bg-white p-3">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="text-xl font-semibold text-slate-900">{value}</dd>
      <dd className="text-sm">{link}</dd>
    </div>
  );
}

const linkClass = 'inline-flex min-h-11 items-center underline';

/**
 * « À suivre » (docs/adr/0010, section 1) : quatre indicateurs d'action du jour, calculés par
 * le serveur. Chacun n'apparaît que si la réponse contient sa section (permissions).
 */
export function TodayIndicators({
  today,
  practitionerId,
}: {
  today: string;
  practitionerId: string | null;
}) {
  const query = useDashboard(today, today, practitionerId);
  if (query.isError) return <Alert>{errorMessage(query.error)}</Alert>;
  const d = query.data;
  if (!d) return null;
  const count = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
  const todayStats = `/statistiques?vue=day&du=${today}&au=${today}`;

  return (
    <section aria-labelledby="a-suivre" className="flex flex-col gap-2">
      <h2 id="a-suivre" className="text-lg font-semibold">
        À suivre
      </h2>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {d.activity && (
          <Indicator
            label="Rendez-vous des 7 prochains jours"
            value={String(d.activity.upcomingNext7Days)}
            link={
              <Link className={linkClass} to="/agenda">
                Ouvrir l’agenda
              </Link>
            }
          />
        )}
        {d.unbilled && (
          <Indicator
            label="Honorés aujourd’hui sans acte saisi"
            value={String(d.unbilled.count)}
            link={
              <Link className={linkClass} to={todayStats}>
                {d.unbilled.count > 0 ? 'Voir la liste' : 'Statistiques du jour'}
              </Link>
            }
          />
        )}
        {d.receivables && (
          <Indicator
            label="Restant à encaisser"
            value={formatCents(d.receivables.totalRemainingCents, d.currency)}
            link={
              <Link className={linkClass} to="/encaissements">
                {count(d.receivables.patients, 'patient')}
              </Link>
            }
          />
        )}
        {d.revenue && (
          <Indicator
            label="Encaissé aujourd’hui"
            value={formatCents(d.revenue.totalCents, d.currency)}
            link={
              <Link className={linkClass} to={`/revenus?du=${today}&au=${today}`}>
                {count(d.revenue.count, 'paiement')}
              </Link>
            }
          />
        )}
      </dl>
    </section>
  );
}
