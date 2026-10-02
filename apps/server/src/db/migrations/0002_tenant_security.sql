-- Isolation multi-cabinet et droits du rôle applicatif.
-- Règle : toute table portant un clinic_id a la RLS activée ET forcée, avec une politique
-- limitant lignes lues et écrites au cabinet du contexte (test : schema-catalog.test.ts).
-- Le rôle dental_app est créé par le bootstrap (src/db/bootstrap.ts).

-- Le rôle applicatif ne crée aucun objet.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO dental_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO dental_app;
--> statement-breakpoint
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_clinic_id() TO dental_app;
--> statement-breakpoint

-- clinics : un cabinet ne voit et ne modifie que lui-même. La création d'un cabinet est une
-- opération d'administration (rôle propriétaire), pas une action de l'application.
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE clinics FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON clinics
  USING (id = app.current_clinic_id())
  WITH CHECK (id = app.current_clinic_id());
--> statement-breakpoint
GRANT SELECT, UPDATE (name, timezone, locale, settings) ON clinics TO dental_app;
--> statement-breakpoint
CREATE TRIGGER clinics_set_updated_at BEFORE UPDATE ON clinics
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- audit_logs : ajout seul pour le rôle applicatif (ni UPDATE ni DELETE).
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON audit_logs
  USING (clinic_id = app.current_clinic_id())
  WITH CHECK (clinic_id = app.current_clinic_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_logs TO dental_app;
