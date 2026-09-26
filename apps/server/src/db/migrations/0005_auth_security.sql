-- Sécurité des tables d'authentification (voir docs/adr/0003-authentification.md).
-- Toutes les politiques échouent fermées : sans variable de contexte, aucune ligne n'est visible.

REVOKE EXECUTE ON FUNCTION app.current_user_id(), app.auth_email(), app.session_token_hash() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_user_id(), app.auth_email(), app.session_token_hash() TO dental_app;
--> statement-breakpoint

-- users : compte commun à la plateforme. Visible uniquement :
--   - pendant la vérification du mot de passe, pour l'e-mail saisi (app.auth_email) ;
--   - pendant la connexion, par le compte lui-même (app.user_id) ;
--   - par un cabinet dont il est membre (app.clinic_id).
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY users_select ON users FOR SELECT USING (
  email = app.auth_email()
  OR id = app.current_user_id()
  OR EXISTS (
    SELECT 1 FROM clinic_memberships m
    WHERE m.user_id = users.id AND m.clinic_id = app.current_clinic_id()
  )
);
--> statement-breakpoint
CREATE POLICY users_update ON users FOR UPDATE
  USING (
    email = app.auth_email()
    OR id = app.current_user_id()
    OR EXISTS (
      SELECT 1 FROM clinic_memberships m
      WHERE m.user_id = users.id AND m.clinic_id = app.current_clinic_id()
    )
  )
  WITH CHECK (
    email = app.auth_email()
    OR id = app.current_user_id()
    OR EXISTS (
      SELECT 1 FROM clinic_memberships m
      WHERE m.user_id = users.id AND m.clinic_id = app.current_clinic_id()
    )
  );
--> statement-breakpoint
-- Création d'un compte : uniquement depuis un cabinet (gestion des utilisateurs), suivie de
-- l'appartenance dans la même transaction.
CREATE POLICY users_insert ON users FOR INSERT WITH CHECK (app.current_clinic_id() IS NOT NULL);
--> statement-breakpoint
GRANT SELECT, INSERT ON users TO dental_app;
--> statement-breakpoint
-- Ni l'e-mail ni le statut plateforme ne sont modifiables par l'application.
GRANT UPDATE (
  full_name, password_hash, must_change_password, mfa_secret_enc, mfa_enabled_at,
  mfa_last_time_step, failed_login_count, locked_until, last_login_at, password_changed_at
) ON users TO dental_app;
--> statement-breakpoint
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- clinic_memberships : isolées par cabinet. Pendant la connexion (pas encore de cabinet),
-- le compte voit ses propres appartenances pour choisir le cabinet.
ALTER TABLE clinic_memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE clinic_memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memberships_select ON clinic_memberships FOR SELECT USING (
  clinic_id = app.current_clinic_id()
  OR (user_id = app.current_user_id() AND app.current_clinic_id() IS NULL)
);
--> statement-breakpoint
CREATE POLICY memberships_insert ON clinic_memberships FOR INSERT
  WITH CHECK (clinic_id = app.current_clinic_id());
--> statement-breakpoint
CREATE POLICY memberships_update ON clinic_memberships FOR UPDATE
  USING (clinic_id = app.current_clinic_id())
  WITH CHECK (clinic_id = app.current_clinic_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON clinic_memberships TO dental_app;
--> statement-breakpoint
GRANT UPDATE (role, status) ON clinic_memberships TO dental_app;
--> statement-breakpoint
CREATE TRIGGER clinic_memberships_set_updated_at BEFORE UPDATE ON clinic_memberships
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- sessions : visible par l'empreinte du jeton présenté, ou par le cabinet (révocation lors
-- d'une désactivation ou d'un changement de rôle). Jamais supprimées par l'application.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sessions_select ON sessions FOR SELECT USING (
  token_hash = app.session_token_hash() OR clinic_id = app.current_clinic_id()
);
--> statement-breakpoint
CREATE POLICY sessions_insert ON sessions FOR INSERT
  WITH CHECK (clinic_id = app.current_clinic_id());
--> statement-breakpoint
CREATE POLICY sessions_update ON sessions FOR UPDATE
  USING (token_hash = app.session_token_hash() OR clinic_id = app.current_clinic_id())
  WITH CHECK (token_hash = app.session_token_hash() OR clinic_id = app.current_clinic_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON sessions TO dental_app;
--> statement-breakpoint
GRANT UPDATE (token_hash, state, csrf_token, mfa_attempts, last_seen_at, revoked_at)
  ON sessions TO dental_app;
