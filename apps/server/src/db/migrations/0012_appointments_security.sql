-- Rendez-vous : statuts, anti double réservation garantie par la base, isolation par cabinet
-- et droits (voir docs/adr/0007).

-- Statuts du MVP. Ajouter un statut = une ligne ici (nouvelle migration) : la contrainte
-- d'exclusion s'appuie sur occupies_slot, pas sur une liste de statuts.
INSERT INTO appointment_statuses (code, occupies_slot, sort_order) VALUES
  ('SCHEDULED', true, 10),
  ('COMPLETED', true, 20),
  ('NO_SHOW', false, 30),
  ('CANCELLED', false, 40);
--> statement-breakpoint

-- Table de référence commune à tous les cabinets : lecture seule pour l'application.
ALTER TABLE appointment_statuses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE appointment_statuses FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY appointment_statuses_read ON appointment_statuses FOR SELECT USING (true);
--> statement-breakpoint
GRANT SELECT ON appointment_statuses TO dental_app;
--> statement-breakpoint

-- occupies_slot est toujours recalculé depuis le statut : la valeur fournie à l'insertion est
-- ignorée, et l'application n'a aucun droit UPDATE sur cette colonne.
CREATE FUNCTION app.appointments_sync_occupies_slot() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  -- Statut inconnu : true par défaut, la clé étrangère refuse ensuite la ligne.
  NEW.occupies_slot := coalesce(
    (SELECT s.occupies_slot FROM appointment_statuses s WHERE s.code = NEW.status),
    true
  );
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER appointments_sync_occupies_slot BEFORE INSERT OR UPDATE OF status ON appointments
  FOR EACH ROW EXECUTE FUNCTION app.appointments_sync_occupies_slot();
--> statement-breakpoint

-- Jamais deux rendez-vous qui occupent le même temps pour un praticien (plages adjacentes
-- permises) ; jamais un même patient à deux rendez-vous en même temps.
ALTER TABLE appointments ADD CONSTRAINT appointments_no_practitioner_overlap
  EXCLUDE USING gist (practitioner_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
  WHERE (occupies_slot);
--> statement-breakpoint
ALTER TABLE appointments ADD CONSTRAINT appointments_no_patient_overlap
  EXCLUDE USING gist (patient_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
  WHERE (occupies_slot);
--> statement-breakpoint

-- Jamais supprimés : l'annulation est un statut (historique complet).
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY appointments_tenant ON appointments FOR ALL
  USING (clinic_id = app.current_clinic_id())
  WITH CHECK (clinic_id = app.current_clinic_id());
--> statement-breakpoint
-- INSERT sur la table : l'ORM cite toutes les colonnes (DEFAULT pour les autres). La valeur
-- de occupies_slot fournie à l'insertion est de toute façon remplacée par le déclencheur.
GRANT SELECT, INSERT ON appointments TO dental_app;
--> statement-breakpoint
-- Le patient d'un rendez-vous ne change pas (on annule et on recrée) ; occupies_slot jamais.
GRANT UPDATE (
  practitioner_id, appointment_type_id, start_at, end_at, status, note, cancelled_at,
  cancelled_by, cancellation_reason, version
) ON appointments TO dental_app;
--> statement-breakpoint
CREATE TRIGGER appointments_set_updated_at BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
