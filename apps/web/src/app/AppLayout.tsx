import { ROLE_LABELS } from '@dental/shared';
import { NavLink, Outlet } from 'react-router';
import { can, useMe } from '../lib/auth';
import { LogoutButton } from '../pages/LogoutButton';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium ${
    isActive ? 'bg-sky-100 text-sky-900' : 'text-slate-700 hover:bg-slate-100'
  }`;

export function AppLayout() {
  const { data: me } = useMe();
  if (!me) return null;
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <div>
            <p className="font-semibold text-slate-900">{me.clinic.name}</p>
            <p className="text-xs text-slate-600">
              {me.user.fullName} · {ROLE_LABELS[me.role]}
            </p>
          </div>
          <nav aria-label="Navigation principale" className="flex flex-wrap items-center gap-1">
            <NavLink to="/" end className={linkClass}>
              Accueil
            </NavLink>
            {can(me, 'appointment.read') && (
              <NavLink to="/agenda" className={linkClass}>
                Agenda
              </NavLink>
            )}
            {can(me, 'patient.read') && (
              <NavLink to="/patients" className={linkClass}>
                Patients
              </NavLink>
            )}
            {can(me, 'appointment.read') && (
              <NavLink to="/disponibilites" className={linkClass}>
                Disponibilités
              </NavLink>
            )}
            {can(me, 'clinic.settings.manage') && (
              <NavLink to="/cabinet" className={linkClass}>
                Cabinet
              </NavLink>
            )}
            {can(me, 'user.manage') && (
              <NavLink to="/utilisateurs" className={linkClass}>
                Utilisateurs
              </NavLink>
            )}
            <LogoutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
