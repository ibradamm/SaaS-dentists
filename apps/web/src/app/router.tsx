import { createBrowserRouter, type RouteObject } from 'react-router';
import { ChangePasswordPage } from '../pages/ChangePasswordPage';
import { HomePage } from '../pages/HomePage';
import { LoginPage } from '../pages/LoginPage';
import { MfaVerifyPage } from '../pages/MfaVerifyPage';
import { UsersPage } from '../pages/UsersPage';
import { NewPatientPage } from '../pages/patients/NewPatientPage';
import { PatientPage } from '../pages/patients/PatientPage';
import { PatientsPage } from '../pages/patients/PatientsPage';
import { AvailabilityPage } from '../pages/availability/AvailabilityPage';
import { AppointmentTypesPage } from '../pages/settings/AppointmentTypesPage';
import { ClinicProfilePage } from '../pages/settings/ClinicProfilePage';
import { PractitionersPage } from '../pages/settings/PractitionersPage';
import { SettingsLayout } from '../pages/settings/SettingsLayout';
import { AppLayout } from './AppLayout';
import { RequirePermission, RequireSession } from './guards';

export const routes: RouteObject[] = [
  { path: '/connexion', element: <LoginPage /> },
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
          { index: true, element: <HomePage /> },
          {
            element: <RequirePermission permission="user.manage" />,
            children: [{ path: '/utilisateurs', element: <UsersPage /> }],
          },
          {
            element: <RequirePermission permission="patient.read" />,
            children: [
              { path: '/patients', element: <PatientsPage /> },
              { path: '/patients/:id', element: <PatientPage /> },
            ],
          },
          {
            element: <RequirePermission permission="patient.write" />,
            children: [{ path: '/patients/nouveau', element: <NewPatientPage /> }],
          },
          {
            element: <RequirePermission permission="appointment.read" />,
            children: [{ path: '/disponibilites', element: <AvailabilityPage /> }],
          },
          {
            element: <RequirePermission permission="clinic.settings.manage" />,
            children: [
              {
                path: '/cabinet',
                element: <SettingsLayout />,
                children: [
                  { index: true, element: <ClinicProfilePage /> },
                  { path: 'praticiens', element: <PractitionersPage /> },
                  { path: 'types-de-rendez-vous', element: <AppointmentTypesPage /> },
                ],
              },
            ],
          },
          {
            element: <RequirePermission permission="data.import" />,
            children: [
              {
                path: '/patients/import',
                lazy: () =>
                  import('../pages/imports/ImportPage').then((m) => ({ Component: m.ImportPage })),
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
