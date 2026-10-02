import pg from 'pg';
import { databaseUrls } from './env';

export interface Volume {
  patients: number;
  appointments: number;
  charges: number;
  payments: number;
  auditLogs: number;
}

/**
 * Activité d'un an pour un cabinet préparé par setupClinic (deux praticiens, lundi-vendredi
 * 9 h-12 h et 14 h-18 h), écrite directement en base (superutilisateur) : saisir un an par
 * l'API prendrait des heures. Même forme que les données réelles : créneaux de 30 minutes
 * réservés à 70 %, statuts passés variés, actes et paiements pour les rendez-vous honorés,
 * journal d'audit volumineux. Aucune donnée réelle : noms générés « Patient123 Volume ».
 */
export async function seedVolume(
  clinicId: string,
  options = { patients: 5000, auditPerAppointment: 17 },
) {
  if (!/^[0-9a-f-]{36}$/.test(clinicId)) throw new Error('Identifiant de cabinet invalide');
  const client = new pg.Client({ connectionString: databaseUrls().inspectUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.clinic_id', $1, true)`, [clinicId]);
    // Horaires historiques : mêmes plages, depuis un an jusqu'au début des horaires actuels.
    await client.query(
      `WITH cur AS (
         SELECT id, practitioner_id, valid_from FROM working_schedules WHERE clinic_id = $1
       ), hist AS (
         INSERT INTO working_schedules (id, clinic_id, practitioner_id, valid_from, valid_to)
         SELECT gen_random_uuid(), $1, practitioner_id, valid_from - 365, valid_from FROM cur
         RETURNING id, practitioner_id
       )
       INSERT INTO working_intervals (id, clinic_id, schedule_id, weekday, start_minute, end_minute)
       SELECT gen_random_uuid(), $1, hist.id, wi.weekday, wi.start_minute, wi.end_minute
         FROM hist JOIN cur ON cur.practitioner_id = hist.practitioner_id
         JOIN working_intervals wi ON wi.schedule_id = cur.id`,
      [clinicId],
    );
    await client.query(
      `INSERT INTO patients (id, clinic_id, last_name, first_name, search_text, created_source, created_at)
       SELECT gen_random_uuid(), $1, 'Patient' || i, 'Volume', 'patient' || i || ' volume', 'STAFF',
              now() - ((i * 7919) % 365) * interval '1 day'
         FROM generate_series(1, $2::int) i`,
      [clinicId, options.patients],
    );
    await client.query(
      `INSERT INTO patient_contacts (id, clinic_id, patient_id, phone_e164, is_primary)
       SELECT gen_random_uuid(), $1, id, '+3361' || lpad((row_number() OVER ())::text, 7, '0'), true
         FROM patients WHERE clinic_id = $1 AND first_name = 'Volume'`,
      [clinicId],
    );
    // Créneaux de 30 minutes dans les horaires, d'il y a un an à dans deux mois, 70 % réservés.
    await client.query(
      `WITH pts AS (
         SELECT array_agg(id ORDER BY created_at, id) AS ids FROM patients
          WHERE clinic_id = $1 AND first_name = 'Volume'
       ), types AS (
         SELECT array_agg(id ORDER BY name) AS ids FROM appointment_types WHERE clinic_id = $1
       ), slots AS (
         SELECT ws.practitioner_id, d::date AS day, wi.start_minute + k * 30 AS minute
           FROM working_schedules ws
           JOIN working_intervals wi ON wi.schedule_id = ws.id
           JOIN generate_series(current_date - 365, current_date + 60, interval '1 day') d
             ON extract(isodow FROM d) = wi.weekday
            AND d::date >= ws.valid_from AND (ws.valid_to IS NULL OR d::date < ws.valid_to)
           JOIN generate_series(0, 40) k ON wi.start_minute + (k + 1) * 30 <= wi.end_minute
          WHERE ws.clinic_id = $1
       ), picked AS (
         SELECT s.*, row_number() OVER (ORDER BY day, minute, practitioner_id) AS n,
                ((day - date '2020-01-01') * 48 + minute / 30) * 2654435761 % 100 AS h
           FROM slots s
       ), rows AS (
         SELECT picked.*, (day + make_interval(mins => minute)) AT TIME ZONE 'Europe/Paris' AS start_at
           FROM picked WHERE h < 70
       )
       INSERT INTO appointments (id, clinic_id, practitioner_id, patient_id, appointment_type_id,
                                 start_at, end_at, status, created_at)
       SELECT gen_random_uuid(), $1, practitioner_id,
              pts.ids[((n * 37) % array_length(pts.ids, 1)) + 1],
              types.ids[(n % array_length(types.ids, 1)) + 1],
              start_at, start_at + interval '30 minutes',
              CASE WHEN start_at >= now() THEN 'SCHEDULED'
                   WHEN h % 17 = 0 THEN 'NO_SHOW'
                   WHEN h % 13 = 0 THEN 'CANCELLED'
                   ELSE 'COMPLETED' END,
              start_at - interval '7 days'
         FROM rows, pts, types
       ON CONFLICT DO NOTHING`,
      [clinicId],
    );
    await client.query(
      `INSERT INTO charges (id, clinic_id, patient_id, appointment_id, practitioner_id, label,
                            amount_cents, currency, idempotency_key, created_at)
       SELECT gen_random_uuid(), clinic_id, patient_id, id, practitioner_id, 'Soin',
              3000 + (extract(epoch FROM start_at)::bigint / 1800 % 12) * 1000, 'EUR',
              gen_random_uuid(), end_at
         FROM appointments
        WHERE clinic_id = $1 AND status = 'COMPLETED'
          AND extract(epoch FROM start_at)::bigint / 1800 % 10 <> 0`,
      [clinicId],
    );
    await client.query(
      `INSERT INTO payments (id, clinic_id, patient_id, charge_id, amount_cents, currency, method,
                             received_at, idempotency_key)
       SELECT gen_random_uuid(), c.clinic_id, c.patient_id, c.id,
              CASE WHEN extract(epoch FROM a.start_at)::bigint / 1800 % 7 = 0
                   THEN c.amount_cents / 2 ELSE c.amount_cents END,
              'EUR', (ARRAY['CARD', 'CASH', 'CHECK', 'TRANSFER'])[(extract(epoch FROM a.start_at)::bigint / 1800 % 4) + 1],
              a.end_at, gen_random_uuid()
         FROM charges c JOIN appointments a ON a.id = c.appointment_id
        WHERE c.clinic_id = $1`,
      [clinicId],
    );
    // Journal : plusieurs entrées par rendez-vous, étalées sur l'année.
    await client.query(
      `INSERT INTO audit_logs (id, clinic_id, actor_type, actor_id, action, entity_type, entity_id, created_at)
       SELECT gen_random_uuid(), $1, 'USER', u.id,
              (ARRAY['appointment.created', 'appointment.updated', 'appointment.status_changed'])[(k % 3) + 1],
              'appointment', a.id, least(a.start_at, now()) - k * interval '37 minutes'
         FROM appointments a
         CROSS JOIN generate_series(1, $2::int) k
         CROSS JOIN LATERAL (
           SELECT m.user_id AS id FROM clinic_memberships m WHERE m.clinic_id = $1 LIMIT 1
         ) u
        WHERE a.clinic_id = $1`,
      [clinicId, options.auditPerAppointment],
    );
    await client.query('COMMIT');
    await client.query('ANALYZE');
    const { rows } = await client.query<Volume>(
      `SELECT (SELECT count(*)::int FROM patients WHERE clinic_id = $1) AS patients,
              (SELECT count(*)::int FROM appointments WHERE clinic_id = $1) AS appointments,
              (SELECT count(*)::int FROM charges WHERE clinic_id = $1) AS charges,
              (SELECT count(*)::int FROM payments WHERE clinic_id = $1) AS payments,
              (SELECT count(*)::int FROM audit_logs WHERE clinic_id = $1) AS "auditLogs"`,
      [clinicId],
    );
    return rows[0]!;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
