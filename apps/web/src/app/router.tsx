import { createBrowserRouter, type RouteObject } from 'react-router';
import { ChangePasswordPage } from '../pages/ChangePasswordPage';
import { HomePage } from '../pages/HomePage';
import { LoginPage } from '../pages/LoginPage';
import { MfaSetupPage } from '../pages/MfaSetupPage';
import { MfaVerifyPage } from '../pages/MfaVerifyPage';
import { UsersPage } from '../pages/UsersPage';
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
    children: [{ path: '/connexion/double-authentification', element: <MfaSetupPage /> }],
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
        ],
      },
    ],
  },
  { path: '*', element: <p className="p-6">Page introuvable.</p> },
];

export const createAppRouter = () => createBrowserRouter(routes);
