import type { ComponentType } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { ChangePasswordPage } from '../pages/ChangePasswordPage';
import { LoginPage } from '../pages/LoginPage';
import { MfaVerifyPage } from '../pages/MfaVerifyPage';
import { AppLayout, type RouteHandle } from './AppLayout';
import { STATS_PERMISSIONS } from '../lib/auth';
import { RequirePermission, RequireSession } from './guards';

/*
 * Pages de l'application chargées à la demande : la connexion ne télécharge que le socle
 * (React, routeur, cache, contrats), et chaque page arrive avec ses bibliothèques (ADR 0008).
 */
const page = (title: string, load: () => Promise<{ Component: ComponentType }>) => ({
  handle: { title } satisfies RouteHandle,
  lazy: load,
});

export const routes: RouteObject[] = [
  { path: '/connexion', element: <LoginPage />, handle: { title: 'Connexion' } },
  {
    element: <RequireSession allow="MFA_PENDING" />,
    children: [{ path: '/connexion/code', element: <MfaVerifyPage /> }],
  },
  {
    element: <RequireSession allow="PASSWORD_CHANGE_REQUIRED" />,
    children: [{ path: '/connexion/mot-de-passe', element: <ChangePasswordPage /> }],
  },
  {
    element: <RequireSession allow="MFA_ENROLLMENT_REQUIRED" />,
    children: [
      {
        path: '/connexion/double-authentification',
        // Chargées à la demande (QR code, lecture de fichiers) : pages rares, bibliothèques lourdes.
        lazy: () => import('../pages/MfaSetupPage').then((m) => ({ Component: m.MfaSetupPage })),
      },
    ],
  },
  {
    element: <RequireSession allow={null} />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            index: true,
            ...page("Aujourd'hui", () =>
              import('../pages/today/TodayPage').then((m) => ({ Component: m.TodayPage })),
            ),
          },
          {
            element: <RequirePermission permission="user.manage" />,
            children: [
              {
                path: '/utilisateurs',
                ...page('Utilisateurs', () =>
                  import('../pages/UsersPage').then((m) => ({ Component: m.UsersPage })),
                ),
              },
            ],
          },
          {
            element: <RequirePermission permission="patient.read" />,
            children: [
              {
                path: '/patients',
                ...page('Patients', () =>
                  import('../pages/patients/PatientsPage').then((m) => ({
                    Component: m.PatientsPage,
                  })),
                ),
              },
              {
                path: '/patients/:id',
                ...page('Fiche patient', () =>
                  import('../pages/patients/PatientPage').then((m) => ({
                    Component: m.PatientPage,
                  })),
                ),
              },
            ],
          },
          {
            element: <RequirePermission permission="patient.write" />,
            children: [
              {
                path: '/patients/nouveau',
                ...page('Nouveau patient', () =>
                  import('../pages/patients/NewPatientPage').then((m) => ({
                    Component: m.NewPatientPage,
                  })),
                ),
              },
            ],
          },
          {
            element: <RequirePermission permission="appointment.read" />,
            children: [
              {
                path: '/agenda',
                ...page('Agenda', () =>
                  import('../pages/agenda/AgendaPage').then((m) => ({ Component: m.AgendaPage })),
                ),
              },
              {
                path: '/disponibilites',
                ...page('Disponibilités', () =>
                  import('../pages/availability/AvailabilityPage').then((m) => ({
                    Component: m.AvailabilityPage,
                  })),
                ),
              },
            ],
          },
          {
            element: <RequirePermission permission="payment.read" />,
            children: [
              {
                path: '/encaissements',
                ...page('À encaisser', () =>
                  import('../pages/finance/ReceivablesPage').then((m) => ({
                    Component: m.ReceivablesPage,
                  })),
                ),
              },
            ],
          },
          {
            element: <RequirePermission permission="finance.reports.read" />,
            children: [
              {
                path: '/revenus',
                ...page('Revenus', () =>
                  import('../pages/finance/RevenuePage').then((m) => ({
                    Component: m.RevenuePage,
                  })),
                ),
              },
            ],
          },
          {
            element: <RequirePermission permission={STATS_PERMISSIONS} />,
            children: [
              {
                path: '/statistiques',
                ...page('Statistiques', () =>
                  import('../pages/stats/StatsPage').then((m) => ({ Component: m.StatsPage })),
                ),
              },
            ],
          },
          {
            element: <RequirePermission permission="audit.read" />,
            children: [
              {
                path: '/journal',
                ...page('Journal', () =>
                  import('../pages/audit/AuditLogPage').then((m) => ({
                    Component: m.AuditLogPage,
                  })),
                ),
              },
            ],
          },
          {
            element: <RequirePermission permission="clinic.settings.manage" />,
            children: [
              {
                path: '/cabinet',
                ...page('Cabinet', () =>
                  import('../pages/settings/SettingsLayout').then((m) => ({
                    Component: m.SettingsLayout,
                  })),
                ),
                children: [
                  {
                    index: true,
                    lazy: () =>
                      import('../pages/settings/ClinicProfilePage').then((m) => ({
                        Component: m.ClinicProfilePage,
                      })),
                  },
                  {
                    path: 'praticiens',
                    ...page('Praticiens', () =>
                      import('../pages/settings/PractitionersPage').then((m) => ({
                        Component: m.PractitionersPage,
                      })),
                    ),
                  },
                  {
                    path: 'types-de-rendez-vous',
                    ...page('Types de rendez-vous', () =>
                      import('../pages/settings/AppointmentTypesPage').then((m) => ({
                        Component: m.AppointmentTypesPage,
                      })),
                    ),
                  },
                ],
              },
            ],
          },
          {
            element: <RequirePermission permission="data.import" />,
            children: [
              {
                path: '/patients/import',
                ...page('Import de patients', () =>
                  import('../pages/imports/ImportPage').then((m) => ({ Component: m.ImportPage })),
                ),
              },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <p className="p-6">Page introuvable.</p> },
];

export const createAppRouter = () => createBrowserRouter(routes);
