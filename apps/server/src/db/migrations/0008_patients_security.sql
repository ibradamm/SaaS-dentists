-- Isolation et droits des tables patients et import (voir docs/adr/0005-import-de-donnees.md).

-- patients : lecture, création, modification par cabinet. Suppression physique réservée aux
-- patients issus d'un import (annulation du lot) ; les autres sont archivés.
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE patients FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY patients_tenant ON patients FOR SELECT USING (clinic_id = app.current_clinic_id());
--> statement-breakpoint
CREATE POLICY patients_insert ON patients FOR INSERT WITH CHECK (clinic_id = app.current_clinic_id());
--> statement-breakpoint
CREATE POLICY patients_update ON patients FOR UPDATE
  USING (clinic_id = app.current_clinic_id())
  WITH CHECK (clinic_id = app.current_clinic_id());
--> statement-breakpoint
CREATE POLICY patients_delete_imported ON patients FOR DELETE
  USING (clinic_id = app.current_clinic_id() AND import_batch_id IS NOT NULL);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON patients TO dental_app;
--> statement-breakpoint
GRANT UPDATE (
  last_name, first_name, birth_date, email, administrative_note, status, archived_at,
  search_text, version
) ON patients TO dental_app;
--> statement-breakpoint
CREATE TRIGGER patients_set_updated_at BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

ALTER TABLE patient_contacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE patient_contacts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY patient_contacts_tenant ON patient_contacts FOR ALL
  USING (clinic_id = app.current_clinic_id())
  WITH CHECK (clinic_id = app.current_clinic_id());
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON patient_contacts TO dental_app;
--> statement-breakpoint
GRANT UPDATE (relationship, label, is_primary) ON patient_contacts TO dental_app;
--> statement-breakpoint
CREATE TRIGGER patient_contacts_set_updated_at BEFORE UPDATE ON patient_contacts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- Notes médicales : ajout seul.
ALTER TABLE patient_medical_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE patient_medical_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY patient_medical_notes_tenant ON patient_medical_notes FOR ALL
  USING (clinic_id = app.current_clinic_id())
  WITH CHECK (clinic_id = app.current_clinic_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON patient_medical_notes TO dental_app;
--> statement-breakpoint

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE import_batches FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY import_batches_tenant ON import_batches FOR ALL
  USING (clinic_id = app.current_clinic_id())
  WITH CHECK (clinic_id = app.current_clinic_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON import_batches TO dental_app;
--> statement-breakpoint
GRANT UPDATE (status, counts, committed_at, reverted_at) ON import_batches TO dental_app;
--> statement-breakpoint
CREATE TRIGGER import_batches_set_updated_at BEFORE UPDATE ON import_batches
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

ALTER TABLE import_rows ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE import_rows FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY import_rows_tenant ON import_rows FOR ALL
  USING (clinic_id = app.current_clinic_id())
  WITH CHECK (clinic_id = app.current_clinic_id());
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON import_rows TO dental_app;
--> statement-breakpoint
GRANT UPDATE (status, data, issues, patient_id) ON import_rows TO dental_app;
