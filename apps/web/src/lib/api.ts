import {
  apiErrorSchema,
  clinicResponseSchema,
  csrfResponseSchema,
  listUsersResponseSchema,
  loginResponseSchema,
  meResponseSchema,
  mfaSetupResponseSchema,
  clinicUserSchema,
  readinessResponseSchema,
  temporaryPasswordResponseSchema,
  type CreateUserRequest,
  type ErrorCode,
  type LoginRequest,
  type MeResponse,
  type PasswordChangeRequest,
  type ReadinessResponse,
  type UpdateUserRequest,
} from '@dental/shared';
import { z } from 'zod';

/** Erreur renvoyée par l'API, au format standard. L'interface s'appuie sur `code`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Jeton CSRF de la session courante, fourni par l'API (connexion, /me). Jamais stocké
// ailleurs qu'en mémoire.
let csrfToken: string | null = null;
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

const SAFE = new Set(['GET', 'HEAD']);

async function request<T>(
  method: string,
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (!SAFE.has(method) && csrfToken) headers['x-csrf-token'] = csrfToken;
  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? null : JSON.stringify(body),
  });
  const json: unknown =
    response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(json);
    throw parsed.success
      ? new ApiError(response.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiError(response.status, 'INTERNAL_ERROR', 'Erreur inattendue, réessayez.');
  }
  return schema.parse(json);
}

const noContent = z.undefined();

export const api = {
  readiness: (): Promise<ReadinessResponse> =>
    request('GET', '/health/ready', readinessResponseSchema),

  /** Profil de la session ; null si aucune session valide. */
  me: async (): Promise<MeResponse | null> => {
    try {
      const me = await request('GET', '/api/auth/me', meResponseSchema);
      setCsrfToken(me.csrfToken);
      return me;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setCsrfToken(null);
        return null;
      }
      throw error;
    }
  },
  login: async (body: LoginRequest) => {
    const res = await request('POST', '/api/auth/login', loginResponseSchema, body);
    setCsrfToken(res.csrfToken);
    return res;
  },
  verifyMfa: async (code: string) => {
    const res = await request('POST', '/api/auth/mfa/verify', loginResponseSchema, { code });
    setCsrfToken(res.csrfToken);
    return res;
  },
  changePassword: async (body: PasswordChangeRequest) => {
    const res = await request('POST', '/api/auth/password', loginResponseSchema, body);
    setCsrfToken(res.csrfToken);
    return res;
  },
  setupMfa: () => request('POST', '/api/auth/mfa/setup', mfaSetupResponseSchema, {}),
  activateMfa: async (code: string) => {
    const res = await request('POST', '/api/auth/mfa/activate', loginResponseSchema, { code });
    setCsrfToken(res.csrfToken);
    return res;
  },
  logout: async () => {
    await request('POST', '/api/auth/logout', noContent, {});
    setCsrfToken(null);
  },
  refreshCsrf: async () =>
    setCsrfToken((await request('GET', '/api/auth/csrf', csrfResponseSchema)).csrfToken),

  listUsers: () => request('GET', '/api/users', listUsersResponseSchema).then((r) => r.users),
  createUser: (body: CreateUserRequest) =>
    request('POST', '/api/users', temporaryPasswordResponseSchema, body),
  updateUser: (id: string, body: UpdateUserRequest) =>
    request('PATCH', `/api/users/${id}`, clinicUserSchema, body),
  resetPassword: (id: string) =>
    request('POST', `/api/users/${id}/reset-password`, temporaryPasswordResponseSchema, {}),
  resetMfa: (id: string) => request('POST', `/api/users/${id}/reset-mfa`, clinicUserSchema, {}),
  clinic: () => request('GET', '/api/clinic', clinicResponseSchema),
};

/** Message à afficher pour une erreur, sans jamais exposer de détail technique. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Une erreur est survenue. Vérifiez votre connexion et réessayez.';
}
