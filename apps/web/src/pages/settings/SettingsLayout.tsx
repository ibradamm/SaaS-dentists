import { NavLink, Outlet } from 'react-router';

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium ${
    isActive ? 'bg-sky-100 text-sky-900' : 'text-slate-700 hover:bg-slate-100'
  }`;

/** Paramètres du cabinet (administrateur) : profil, praticiens, types de rendez-vous. */
export function SettingsLayout() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Cabinet</h1>
      <nav aria-label="Paramètres du cabinet" className="flex flex-wrap gap-1">
        <NavLink to="/cabinet" end className={tabClass}>
          Profil
        </NavLink>
        <NavLink to="/cabinet/praticiens" className={tabClass}>
          Praticiens
        </NavLink>
        <NavLink to="/cabinet/types-de-rendez-vous" className={tabClass}>
          Types de rendez-vous
        </NavLink>
      </nav>
      <Outlet />
    </section>
  );
}
