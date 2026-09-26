import {
  appointmentTypeSchema,
  availabilityBlockSchema,
  availabilityResponseSchema,
  listAppointmentTypesResponseSchema,
  listBlocksResponseSchema,
  listPractitionersResponseSchema,
  listSchedulesResponseSchema,
  practitionerSchema,
  type CreateAppointmentTypeRequest,
  type CreateBlockRequest,
  type CreatePractitionerRequest,
  type ReplaceBlockRequest,
  type SetScheduleRequest,
  type UpdateAppointmentTypeRequest,
  type UpdateClinicRequest,
  type UpdatePractitionerRequest,
  duplicateCandidatesResponseSchema,
  importRowsReportResponseSchema,
  importSummarySchema,
  listImportsResponseSchema,
  listMedicalNotesResponseSchema,
  listPatientsResponseSchema,
  patientDetailSchema,
  revertImportResponseSchema,
  type ContactInput,
  type CreateImportRequest,
  type CreatePatientRequest,
  type ImportRowInput,
  type UpdateContactRequest,
  type UpdatePatientRequest,
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
  updateClinic: (body: UpdateClinicRequest) =>
    request('PATCH', '/api/clinic', clinicResponseSchema, body),

  listPractitioners: (includeArchived = false) =>
    request(
      'GET',
      `/api/practitioners?includeArchived=${includeArchived}`,
      listPractitionersResponseSchema,
    ).then((r) => r.practitioners),
  createPractitioner: (body: CreatePractitionerRequest) =>
    request('POST', '/api/practitioners', practitionerSchema, body),
  updatePractitioner: (id: string, body: UpdatePractitionerRequest) =>
    request('PATCH', `/api/practitioners/${id}`, practitionerSchema, body),
  archivePractitioner: (id: string, version: number) =>
    request('POST', `/api/practitioners/${id}/archive`, practitionerSchema, { version }),
  restorePractitioner: (id: string, version: number) =>
    request('POST', `/api/practitioners/${id}/restore`, practitionerSchema, { version }),

  listAppointmentTypes: (includeArchived = false) =>
    request(
      'GET',
      `/api/appointment-types?includeArchived=${includeArchived}`,
      listAppointmentTypesResponseSchema,
    ).then((r) => r.appointmentTypes),
  createAppointmentType: (body: CreateAppointmentTypeRequest) =>
    request('POST', '/api/appointment-types', appointmentTypeSchema, body),
  updateAppointmentType: (id: string, body: UpdateAppointmentTypeRequest) =>
    request('PATCH', `/api/appointment-types/${id}`, appointmentTypeSchema, body),
  archiveAppointmentType: (id: string, version: number) =>
    request('POST', `/api/appointment-types/${id}/archive`, appointmentTypeSchema, { version }),
  restoreAppointmentType: (id: string, version: number) =>
    request('POST', `/api/appointment-types/${id}/restore`, appointmentTypeSchema, { version }),

  listSchedules: (practitionerId: string) =>
    request(
      'GET',
      `/api/practitioners/${practitionerId}/schedules`,
      listSchedulesResponseSchema,
    ).then((r) => r.periods),
  setSchedule: (practitionerId: string, body: SetScheduleRequest) =>
    request(
      'PUT',
      `/api/practitioners/${practitionerId}/schedules`,
      listSchedulesResponseSchema,
      body,
    ).then((r) => r.periods),
  deleteSchedulePeriod: (practitionerId: string, periodId: string, version: number) =>
    request(
      'DELETE',
      `/api/practitioners/${practitionerId}/schedules/${periodId}?version=${version}`,
      listSchedulesResponseSchema,
    ).then((r) => r.periods),

  listBlocks: (query: { from: string; to: string; practitionerId?: string | undefined }) =>
    request('GET', `/api/availability-blocks?${toQuery(query)}`, listBlocksResponseSchema).then(
      (r) => r.blocks,
    ),
  createBlock: (body: CreateBlockRequest) =>
    request('POST', '/api/availability-blocks', availabilityBlockSchema, body),
  replaceBlock: (id: string, body: ReplaceBlockRequest) =>
    request('PUT', `/api/availability-blocks/${id}`, availabilityBlockSchema, body),
  deleteBlock: (id: string, version: number) =>
    request('DELETE', `/api/availability-blocks/${id}?version=${version}`, noContent),
  availability: (query: { from: string; to: string; practitionerId?: string | undefined }) =>
    request('GET', `/api/availability?${toQuery(query)}`, availabilityResponseSchema),

  listPatients: (query: {
    q?: string;
    status?: 'ACTIVE' | 'ARCHIVED';
    limit?: number;
    offset?: number;
  }) => request('GET', `/api/patients?${toQuery(query)}`, listPatientsResponseSchema),
  duplicatePatients: (query: {
    lastName: string;
    firstName: string;
    birthDate?: string | undefined;
  }) =>
    request(
      'GET',
      `/api/patients/duplicates?${toQuery(query)}`,
      duplicateCandidatesResponseSchema,
    ).then((r) => r.candidates),
  getPatient: (id: string) => request('GET', `/api/patients/${id}`, patientDetailSchema),
  createPatient: (body: CreatePatientRequest) =>
    request('POST', '/api/patients', patientDetailSchema, body),
  updatePatient: (id: string, body: UpdatePatientRequest) =>
    request('PATCH', `/api/patients/${id}`, patientDetailSchema, body),
  archivePatient: (id: string, version: number) =>
    request('POST', `/api/patients/${id}/archive`, patientDetailSchema, { version }),
  restorePatient: (id: string, version: number) =>
    request('POST', `/api/patients/${id}/restore`, patientDetailSchema, { version }),
  addContact: (id: string, body: ContactInput) =>
    request('POST', `/api/patients/${id}/contacts`, patientDetailSchema, body),
  updateContact: (id: string, contactId: string, body: UpdateContactRequest) =>
    request('PATCH', `/api/patients/${id}/contacts/${contactId}`, patientDetailSchema, body),
  removeContact: (id: string, contactId: string) =>
    request('DELETE', `/api/patients/${id}/contacts/${contactId}`, patientDetailSchema),
  medicalNotes: (id: string) =>
    request('GET', `/api/patients/${id}/medical-notes`, listMedicalNotesResponseSchema).then(
      (r) => r.notes,
    ),
  addMedicalNote: (id: string, content: string) =>
    request('POST', `/api/patients/${id}/medical-notes`, noContent, { content }),

  listImports: () =>
    request('GET', '/api/imports', listImportsResponseSchema).then((r) => r.imports),
  createImport: (body: CreateImportRequest) =>
    request('POST', '/api/imports', importSummarySchema, body),
  sendImportRows: (id: string, rows: ImportRowInput[]) =>
    request('POST', `/api/imports/${id}/rows`, importSummarySchema, { rows }),
  importReport: (id: string, offset = 0) =>
    request(
      'GET',
      `/api/imports/${id}/rows?onlyIssues=true&limit=200&offset=${offset}`,
      importRowsReportResponseSchema,
    ),
  commitImport: (id: string) =>
    request('POST', `/api/imports/${id}/commit`, importSummarySchema, {}),
  revertImport: (id: string) =>
    request('POST', `/api/imports/${id}/revert`, revertImportResponseSchema, {}),
  discardImport: (id: string) =>
    request('POST', `/api/imports/${id}/discard`, importSummarySchema, {}),
};

function toQuery(values: Record<string, string | number | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

/** Message à afficher pour une erreur, sans jamais exposer de détail technique. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Une erreur est survenue. Vérifiez votre connexion et réessayez.';
}
