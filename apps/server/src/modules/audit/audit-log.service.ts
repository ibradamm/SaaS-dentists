import {
  auditLogQuerySchema,
  roleHasPermission,
  type AuditActorsResponse,
  type AuditLogEntry,
  type AuditLogResponse,
} from '@dental/shared';
import { and, asc, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client';
import {
  appointmentTypes,
  appointments,
  auditLogs,
  charges,
  clinicMemberships,
  clinics,
  importBatches,
  patients,
  payments,
  practitioners,
  users,
} from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { AppError } from '../../lib/errors';
import { authorize } from '../auth/authorize';
import type { UserActor } from '../auth/auth.types';
import { addDays, wallClockToInstant } from '../scheduling/local-time';

type Entity = NonNullable<AuditLogEntry['entity']>;
type Row = { entityType: string | null; entityId: string | null };

const idsOf = (rows: readonly Row[], type: string) => [
  ...new Set(rows.filter((r) => r.entityType === type && r.entityId).map((r) => r.entityId!)),
];

/**
 * Lecture du journal d'audit (docs/adr/0011), réservée à audit.read. Les entrées sont celles du
 * cabinet (withTenant + filtre explicite), de la plus récente à la plus ancienne, par pages
 * reprises à la dernière entrée reçue : un curseur exact, même pour des entrées écrites dans
 * la même transaction (même horodatage).
 */
export function createAuditLogService(deps: { db: Database }) {
  const { db } = deps;

  /**
   * Libellés des éléments concernés, par lots (une requête par type présent dans la page) et
   * selon les permissions du lecteur : sans patient.read, aucun nom de patient.
   */
  async function entitiesOf(
    tx: Transaction,
    actor: UserActor,
    rows: readonly Row[],
  ): Promise<Map<string, Entity>> {
    const clinicId = actor.clinicId;
    const may = (p: Parameters<typeof roleHasPermission>[1]) => roleHasPermission(actor.role, p);
    const out = new Map<string, Entity>();
    const set = (id: string, label: string | null, patientId: string | null = null) =>
      out.set(id, { label, patientId });

    // Éléments rattachés à un patient : la fiche elle-même, ses rendez-vous, actes, paiements.
    const patientOf = new Map<string, string>();
    for (const id of idsOf(rows, 'patient')) patientOf.set(id, id);
    const linked: [string, typeof appointments | typeof charges | typeof payments][] = [
      ['appointment', appointments],
      ['charge', charges],
      ['payment', payments],
    ];
    for (const [type, table] of linked) {
      const ids = idsOf(rows, type);
      if (ids.length === 0) continue;
      const found = await tx
        .select({ id: table.id, patientId: table.patientId })
        .from(table)
        .where(and(eq(table.clinicId, clinicId), inArray(table.id, ids)));
      for (const f of found) patientOf.set(f.id, f.patientId);
    }
    const names = new Map<string, string>();
    const patientIds = [...new Set(patientOf.values())];
    if (patientIds.length > 0 && may('patient.read')) {
      const found = await tx
        .select({ id: patients.id, lastName: patients.lastName, firstName: patients.firstName })
        .from(patients)
        .where(and(eq(patients.clinicId, clinicId), inArray(patients.id, patientIds)));
      for (const p of found) names.set(p.id, `${p.lastName} ${p.firstName}`);
    }
    for (const [id, patientId] of patientOf) {
      const readable = may('patient.read');
      set(id, readable ? (names.get(patientId) ?? null) : null, readable ? patientId : null);
    }

    const simple: [string, () => Promise<{ id: string; label: string | null }[]>][] = [
      [
        'practitioner',
        () =>
          tx
            .select({ id: practitioners.id, label: practitioners.displayName })
            .from(practitioners)
            .where(
              and(
                eq(practitioners.clinicId, clinicId),
                inArray(practitioners.id, idsOf(rows, 'practitioner')),
              ),
            ),
      ],
      [
        'appointment_type',
        () =>
          tx
            .select({ id: appointmentTypes.id, label: appointmentTypes.name })
            .from(appointmentTypes)
            .where(
              and(
                eq(appointmentTypes.clinicId, clinicId),
                inArray(appointmentTypes.id, idsOf(rows, 'appointment_type')),
              ),
            ),
      ],
      [
        'user',
        () =>
          tx
            .select({ id: users.id, label: users.fullName })
            .from(clinicMemberships)
            .innerJoin(users, eq(users.id, clinicMemberships.userId))
            .where(
              and(
                eq(clinicMemberships.clinicId, clinicId),
                inArray(clinicMemberships.userId, idsOf(rows, 'user')),
              ),
            ),
      ],
      [
        'import_batch',
        () =>
          may('data.import')
            ? tx
                .select({ id: importBatches.id, label: importBatches.fileName })
                .from(importBatches)
                .where(
                  and(
                    eq(importBatches.clinicId, clinicId),
                    inArray(importBatches.id, idsOf(rows, 'import_batch')),
                  ),
                )
            : Promise.resolve([]),
      ],
      [
        'clinic',
        () =>
          tx
            .select({ id: clinics.id, label: clinics.name })
            .from(clinics)
            .where(eq(clinics.id, clinicId)),
      ],
    ];
    for (const [type, query] of simple) {
      if (idsOf(rows, type).length === 0) continue;
      for (const found of await query()) set(found.id, found.label);
    }
    return out;
  }

  async function list(actor: UserActor, query: Record<string, unknown>): Promise<AuditLogResponse> {
    authorize(actor, 'audit.read');
    const q = auditLogQuerySchema.parse(query);
    return withTenant(db, actor.clinicId, async (tx) => {
      const [clinic] = await tx
        .select({ timezone: clinics.timezone })
        .from(clinics)
        .where(eq(clinics.id, actor.clinicId));
      if (!clinic) throw new AppError('NOT_FOUND', 'Cabinet introuvable', 404);
      // Jours locaux du cabinet (local-time.ts), bornes incluses.
      const start = new Date(wallClockToInstant(q.from, 0, clinic.timezone));
      const end = new Date(wallClockToInstant(addDays(q.to, 1), 0, clinic.timezone));

      const conditions: (SQL | undefined)[] = [
        eq(auditLogs.clinicId, actor.clinicId),
        gte(auditLogs.createdAt, start),
        lt(auditLogs.createdAt, end),
        q.actorId ? eq(auditLogs.actorId, q.actorId) : undefined,
        q.action ? eq(auditLogs.action, q.action) : undefined,
        q.entityType ? eq(auditLogs.entityType, q.entityType) : undefined,
        q.entityId ? eq(auditLogs.entityId, q.entityId) : undefined,
        // Curseur inconnu (ou d'un autre cabinet) : la sous-requête est vide, aucune entrée.
        q.before
          ? sql`(${auditLogs.createdAt}, ${auditLogs.id}) < (SELECT c.created_at, c.id FROM audit_logs c WHERE c.id = ${q.before} AND c.clinic_id = ${actor.clinicId})`
          : undefined,
      ];
      const rows = await tx
        .select({
          id: auditLogs.id,
          createdAt: auditLogs.createdAt,
          actorType: auditLogs.actorType,
          actorId: auditLogs.actorId,
          actorName: users.fullName,
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          changes: auditLogs.changes,
          ip: sql<string | null>`host(${auditLogs.ip})`,
          requestId: auditLogs.requestId,
        })
        .from(auditLogs)
        // Auteur : membre de ce cabinet uniquement (RLS et jointure sur l'appartenance).
        .leftJoin(
          clinicMemberships,
          and(
            eq(clinicMemberships.clinicId, auditLogs.clinicId),
            eq(clinicMemberships.userId, auditLogs.actorId),
          ),
        )
        .leftJoin(users, eq(users.id, clinicMemberships.userId))
        .where(and(...conditions))
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(q.limit + 1);

      const page = rows.slice(0, q.limit);
      const entities = await entitiesOf(tx, actor, page);
      const entries: AuditLogEntry[] = page.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        actorType: r.actorType,
        actor: r.actorId && r.actorName ? { id: r.actorId, name: r.actorName } : null,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        entity: r.entityId ? (entities.get(r.entityId) ?? null) : null,
        changes: r.changes,
        ip: r.ip,
        requestId: r.requestId,
      }));
      return {
        entries,
        nextCursor: rows.length > q.limit ? (page[page.length - 1]?.id ?? null) : null,
      };
    });
  }

  /** Comptes du cabinet, actifs ou non, pour le filtre « utilisateur ». */
  async function actors(actor: UserActor): Promise<AuditActorsResponse> {
    authorize(actor, 'audit.read');
    const rows = await withTenant(db, actor.clinicId, (tx) =>
      tx
        .select({
          id: users.id,
          name: users.fullName,
          role: clinicMemberships.role,
          status: clinicMemberships.status,
        })
        .from(clinicMemberships)
        .innerJoin(users, eq(users.id, clinicMemberships.userId))
        .where(eq(clinicMemberships.clinicId, actor.clinicId))
        .orderBy(asc(users.fullName)),
    );
    return {
      actors: rows.map((r) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        active: r.status === 'ACTIVE',
      })),
    };
  }

  return { list, actors };
}

export type AuditLogService = ReturnType<typeof createAuditLogService>;
