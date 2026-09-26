import type { MeResponse, Role, SessionRestriction } from '@dental/shared';
import { permissionsOf } from '@dental/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { routes } from '../app/router';

export interface MockCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}
type Handler = (call: MockCall) => { status: number; body?: unknown };

/** Remplace fetch par des réponses déterministes, indexées par « MÉTHODE /chemin[?requête] ». */
export function mockApi(handlers: Record<string, Handler>) {
  const calls: MockCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const call: MockCall = {
        method: init.method ?? 'GET',
        url,
        headers: (init.headers ?? {}) as Record<string, string>,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      // Clé exacte d'abord (avec la chaîne de requête), sinon le chemin seul.
      const handler =
        handlers[`${call.method} ${url}`] ?? handlers[`${call.method} ${url.split('?')[0]}`];
      const result = handler
        ? handler(call)
        : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Introuvable' } } };
      return Promise.resolve(
        new Response(result.body === undefined ? null : JSON.stringify(result.body), {
          status: result.status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
  return calls;
}

export function me(role: Role, restriction: SessionRestriction | null = null): MeResponse {
  return {
    user: {
      id: '01a0de00-0000-7000-8000-000000000001',
      email: 'moi@cabinet.test',
      fullName: 'Camille Martin',
      mfaEnabled: role !== 'SECRETARY',
    },
    clinic: { id: '01a0de00-0000-7000-8000-0000000000c1', name: 'Cabinet du Parc' },
    role,
    permissions: restriction ? [] : permissionsOf(role),
    restriction,
    csrfToken: 'csrf-me',
  };
}

export const unauthenticated = {
  status: 401,
  body: { error: { code: 'UNAUTHENTICATED', message: 'Authentification requise' } },
};

export function renderApp(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
