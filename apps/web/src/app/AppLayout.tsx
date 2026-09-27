import { ROLE_LABELS, type Permission } from '@dental/shared';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useMatches } from 'react-router';
import { STATS_PERMISSIONS, can, useMe } from '../lib/auth';
import { LogoutButton } from '../pages/LogoutButton';
import { PatientQuickSearch } from './PatientQuickSearch';

/** Titre d'une page, déclaré dans le routeur (`handle.title`). */
export interface RouteHandle {
  title?: string;
}

/**
 * Menu selon les permissions. Masquage d'interface uniquement : chaque page et chaque action
 * restent contrôlées par le serveur.
 */
const NAV: {
  to: string;
  label: string;
  /** Aucune, une permission, ou au moins une d'une liste. */
  permission: Permission | readonly Permission[] | null;
  end?: boolean;
}[] = [
  { to: '/', label: "Aujourd'hui", permission: null, end: true },
  { to: '/agenda', label: 'Agenda', permission: 'appointment.read' },
  { to: '/patients', label: 'Patients', permission: 'patient.read' },
  { to: '/encaissements', label: 'À encaisser', permission: 'payment.read' },
  { to: '/revenus', label: 'Revenus', permission: 'finance.reports.read' },
  { to: '/statistiques', label: 'Statistiques', permission: STATS_PERMISSIONS },
  { to: '/disponibilites', label: 'Disponibilités', permission: 'appointment.read' },
  { to: '/cabinet', label: 'Cabinet', permission: 'clinic.settings.manage' },
  { to: '/utilisateurs', label: 'Utilisateurs', permission: 'user.manage' },
  { to: '/journal', label: 'Journal', permission: 'audit.read' },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-sky-700 ${
    isActive ? 'bg-sky-100 text-sky-900' : 'text-slate-700 hover:bg-slate-100'
  }`;

export function AppLayout() {
  const { data: me } = useMe();
  const matches = useMatches();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const main = useRef<HTMLElement>(null);
  const firstPath = useRef(pathname);

  const title = [...matches]
    .reverse()
    .map((m) => (m.handle as RouteHandle | undefined)?.title)
    .find(Boolean);
  const clinicName = me?.clinic.name;
  useEffect(() => {
    document.title = [title, clinicName].filter(Boolean).join(' · ') || 'Cabinet dentaire';
  }, [title, clinicName]);
  // Après une navigation (pas au premier affichage), le focus va au contenu : le lecteur
  // d'écran annonce la nouvelle page au lieu de rester sur le lien cliqué.
  useEffect(() => {
    if (pathname !== firstPath.current) main.current?.focus();
  }, [pathname]);

  if (!me) return null;
  const close = () => setMenuOpen(false);
  const items = NAV.filter(
    (i) =>
      i.permission === null ||
      (typeof i.permission === 'string' ? [i.permission] : i.permission).some((p) => can(me, p)),
  );

  return (
    <div className="min-h-screen">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:ring-2 focus:ring-sky-700"
      >
        Aller au contenu
      </a>
      <header className="border-b border-slate-200 bg-white">
        {/*
         * Un seul exemplaire de chaque élément. Téléphone : identité et bouton « Menu », puis le
         * menu déroulant (navigation, recherche, déconnexion). Tablette et ordinateur : grille,
         * identité, recherche et déconnexion sur la première ligne, navigation sur la seconde.
         */}
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2 md:grid md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center md:gap-x-3">
          <div className="flex items-center justify-between gap-3 md:col-start-1 md:row-start-1">
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900">{me.clinic.name}</p>
              <p className="truncate text-xs text-slate-600">
                {me.user.fullName} · {ROLE_LABELS[me.role]}
              </p>
            </div>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium ring-1 ring-slate-300 md:hidden"
              aria-expanded={menuOpen}
              aria-controls="menu-principal"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? 'Fermer le menu' : 'Menu'}
            </button>
          </div>
          <div
            id="menu-principal"
            className={`${menuOpen ? 'flex' : 'hidden'} flex-col gap-2 pb-2 md:contents`}
          >
            <nav
              aria-label="Navigation principale"
              className="flex flex-col gap-1 md:col-span-3 md:row-start-2 md:flex-row md:flex-wrap md:items-center"
            >
              {items.map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  end={i.end ?? false}
                  className={linkClass}
                  onClick={close}
                >
                  {i.label}
                </NavLink>
              ))}
            </nav>
            {can(me, 'patient.read') && (
              <div className="md:col-start-2 md:row-start-1">
                <PatientQuickSearch onNavigate={close} />
              </div>
            )}
            <div className="md:col-start-3 md:row-start-1">
              <LogoutButton />
            </div>
          </div>
        </div>
      </header>
      <main
        id="contenu"
        ref={main}
        tabIndex={-1}
        className="mx-auto max-w-6xl px-4 py-6 focus:outline-none"
      >
        <Outlet />
      </main>
    </div>
  );
}
