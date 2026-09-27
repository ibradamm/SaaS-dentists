import type { Appointment } from '@dental/shared';
import { and, asc, eq, gt, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { appointments, appointmentTypes, patientContacts, patients } from '../../db/schema';
import type { Interval } from '../scheduling/intervals';

/*
 * Lectures de rendez-vous partagées (agenda, conflits des horaires et indisponibilités,
 * disponibilités). Filtre explicite par cabinet, dans la transaction de l'appelant.
 */

const columns = {
  id: appointments.id,
  practitionerId: appointments.practitionerId,
  patientId: appointments.patientId,
  patientLastName: patients.lastName,
  patientFirstName: patients.firstName,
  patientPhone: patientContacts.phoneE164,
  typeId: appointmentTypes.id,
  typeName: appointmentTypes.name,
  typeColor: appointmentTypes.color,
  startAt: appointments.startAt,
  endAt: appointments.endAt,
  status: appointments.status,
  note: appointments.note,
  cancellationReason: appointments.cancellationReason,
  billingExempt: appointments.billingExempt,
  version: appointments.version,
};
/** Rendez-vous du cabinet avec patient (nom, téléphone principal) et type. */
export async function readAppointments(
  tx: Transaction,
  clinicId: string,
  where: SQL | undefined,
  options: { order?: 'asc' | 'desc'; limit?: number } = {},
): Promise<Appointment[]> {
  const rows = await tx
    .select(columns)
    .from(appointments)
    .innerJoin(
      patients,
      and(eq(patients.clinicId, appointments.clinicId), eq(patients.id, appointments.patientId)),
    )
    .innerJoin(
      appointmentTypes,
      and(
        eq(appointmentTypes.clinicId, appointments.clinicId),
        eq(appointmentTypes.id, appointments.appointmentTypeId),
      ),
    )
    .leftJoin(
      patientContacts,
      and(
        eq(patientContacts.clinicId, appointments.clinicId),
        eq(patientContacts.patientId, appointments.patientId),
        eq(patientContacts.isPrimary, true),
      ),
    )
    .where(and(eq(appointments.clinicId, clinicId), where))
    .orderBy(
      options.order === 'desc' ? sql`${appointments.startAt} desc` : asc(appointments.startAt),
      asc(appointments.id),
    )
    .limit(options.limit ?? 5000);
  return rows.map((row): Appointment => ({
    id: row.id,
    practitionerId: row.practitionerId,
    patient: {
      id: row.patientId,
      lastName: row.patientLastName,
      firstName: row.patientFirstName,
      primaryPhone: row.patientPhone,
    },
    appointmentType: { id: row.typeId, name: row.typeName, color: row.typeColor },
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    durationMinutes: Math.round((row.endAt.getTime() - row.startAt.getTime()) / 60_000),
    status: row.status as Appointment['status'],
    note: row.note,
    cancellationReason: row.cancellationReason,
    billingExempt: row.billingExempt,
    version: row.version,
  }));
}

export const overlapping = (range: { start: Date; end: Date }) =>
  and(lt(appointments.startAt, range.end), gt(appointments.endAt, range.start));

/** Plages occupées (statuts qui occupent le créneau) des praticiens sur une période. */
export async function occupiedIntervals(
  tx: Transaction,
  clinicId: string,
  practitionerIds: readonly string[],
  range: { start: Date; end: Date },
): Promise<(Interval & { practitionerId: string })[]> {
  if (practitionerIds.length === 0) return [];
  const rows = await tx
    .select({
      practitionerId: appointments.practitionerId,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.clinicId, clinicId),
        inArray(appointments.practitionerId, [...practitionerIds]),
        eq(appointments.occupiesSlot, true),
        overlapping(range),
      ),
    );
  return rows.map((r) => ({
    practitionerId: r.practitionerId,
    start: r.startAt.getTime(),
    end: r.endAt.getTime(),
  }));
}

/**
 * Plages réservées au planning (statistiques, docs/adr/0010) : prévus, honorés et patients
 * absents. Un absent a rendu son créneau inutilisable pour un autre patient, même si l'agenda
 * le libère ensuite ; les annulés ne comptent pas.
 */
export async function plannedIntervals(
  tx: Transaction,
  clinicId: string,
  practitionerIds: readonly string[],
  range: { start: Date; end: Date },
): Promise<(Interval & { practitionerId: string })[]> {
  if (practitionerIds.length === 0) return [];
  const rows = await tx
    .select({
      practitionerId: appointments.practitionerId,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.clinicId, clinicId),
        inArray(appointments.practitionerId, [...practitionerIds]),
        inArray(appointments.status, ['SCHEDULED', 'COMPLETED', 'NO_SHOW']),
        overlapping(range),
      ),
    );
  return rows.map((r) => ({
    practitionerId: r.practitionerId,
    start: r.startAt.getTime(),
    end: r.endAt.getTime(),
  }));
}

/** Rendez-vous « prévus » d'un ou de plusieurs praticiens (tous si null) sur une période. */
export function scheduledOverlapping(
  tx: Transaction,
  clinicId: string,
  practitionerIds: readonly string[] | null,
  range: { start: Date; end: Date },
): Promise<Appointment[]> {
  return readAppointments(
    tx,
    clinicId,
    and(
      eq(appointments.status, 'SCHEDULED'),
      practitionerIds ? inArray(appointments.practitionerId, [...practitionerIds]) : undefined,
      overlapping(range),
    ),
  );
}

/** Existe-t-il un rendez-vous « prévu » à venir (praticien ou patient) ? */
export async function hasFutureScheduled(
  tx: Transaction,
  clinicId: string,
  filter: { practitionerId: string } | { patientId: string },
  now: Date,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.clinicId, clinicId),
        'practitionerId' in filter
          ? eq(appointments.practitionerId, filter.practitionerId)
          : eq(appointments.patientId, filter.patientId),
        eq(appointments.status, 'SCHEDULED'),
        gt(appointments.endAt, now),
      ),
    )
    .limit(1);
  return row !== undefined;
}
