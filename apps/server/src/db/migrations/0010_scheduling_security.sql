-- Praticiens, types de rendez-vous, horaires et indisponibilités : absence de chevauchement
-- garantie par la base, isolation par cabinet et droits (voir docs/adr/0006).

-- btree_gist permet de combiner égalité (praticien, jour) et chevauchement de plages dans une
-- même contrainte d'exclusion. Il servira aussi à l'anti double réservation (Phase 5).
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- Jamais deux périodes d'horaires en même temps pour un praticien.
ALTER TABLE working_schedules ADD CONSTRAINT working_schedules_no_overlap
  EXCLUDE USING gist (practitioner_id WITH =, daterange(valid_from, valid_to, '[)') WITH &&);
--> statement-breakpoint
-- Jamais deux plages qui se chevauchent le même jour d'une période (plages adjacentes permises).
ALTER TABLE working_intervals ADD CONSTRAINT working_intervals_no_overlap
  EXCLUDE USING gist (schedule_id WITH =, weekday WITH =, int4range(start_minute, end_minute) WITH &&);
--> statement-breakpoint

GRANT UPDATE (address_line1, address_line2, postal_code, city, phone, email) ON clinics TO dental_app;
--> statement-breakpoint

-- practitioners : archivage seulement, jamais de suppression (les rendez-vous les référenceront).
ALTER TABLE practitioners ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE practitioners FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY practitioners_tenant ON practitioners FOR ALL
  USING (clinic_id = app.current_clinic_id())
  WITH CHECK (clinic_id = app.current_clinic_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON practitioners TO dental_app;
--> statement-breakpoint
GRANT UPDATE (display_name, user_id, color, status, archived_at, version) ON practitioners TO dental_app;
--> statement-breakpoint
CREATE TRIGGER practitioners_set_updated_at BEFORE UPDATE ON practitioners
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- appointment_types : archivage seulement.
ALTER TABLE appointment_types ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE appointment_types FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY appointment_types_tenant ON appointment_types FOR ALL
  USING (clinic_id = app.current_clinic_id())
  WITH CHECK (clinic_id = app.current_clinic_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON appointment_types TO dental_app;
--> statement-breakpoint
GRANT UPDATE (name, duration_minutes, color, status, archived_at, version) ON appointment_types TO dental_app;
--> statement-breakpoint
CREATE TRIGGER appointment_types_set_updated_at BEFORE UPDATE ON appointment_types
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- working_schedules : suppression d'une période future (remplacée par la précédente).
ALTER TABLE working_schedules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE working_schedules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY working_schedules_tenant ON working_schedules FOR ALL
  USING (clinic_id = app.current_clinic_id())
  WITH CHECK (clinic_id = app.current_clinic_id());
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON working_schedules TO dental_app;
--> statement-breakpoint
GRANT UPDATE (valid_to, version) ON working_schedules TO dental_app;
--> statement-breakpoint
CREATE TRIGGER working_schedules_set_updated_at BEFORE UPDATE ON working_schedules
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- working_intervals : remplacées en bloc (suppression puis insertion), jamais modifiées.
ALTER TABLE working_intervals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE working_intervals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY working_intervals_tenant ON working_intervals FOR ALL
  USING (clinic_id = app.current_clinic_id())
  WITH CHECK (clinic_id = app.current_clinic_id());
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON working_intervals TO dental_app;
--> statement-breakpoint

ALTER TABLE availability_blocks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE availability_blocks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY availability_blocks_tenant ON availability_blocks FOR ALL
  USING (clinic_id = app.current_clinic_id())
  WITH CHECK (clinic_id = app.current_clinic_id());
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON availability_blocks TO dental_app;
--> statement-breakpoint
GRANT UPDATE (kind, start_at, end_at, all_day, label, version) ON availability_blocks TO dental_app;
--> statement-breakpoint
CREATE TRIGGER availability_blocks_set_updated_at BEFORE UPDATE ON availability_blocks
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
