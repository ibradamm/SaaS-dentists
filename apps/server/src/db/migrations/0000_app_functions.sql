-- Fonctions utilitaires partagées par toutes les tables métier.
CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint

-- Cabinet du contexte de transaction courant (fixé par withTenant via set_config local).
-- NULLIF : après une transaction, un paramètre personnalisé déjà utilisé dans la session vaut ''
-- et non NULL. Sans contexte, la fonction renvoie NULL : les politiques RLS ne laissent alors
-- rien passer (échec fermé).
CREATE FUNCTION app.current_clinic_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.clinic_id', true), '')::uuid $$;
--> statement-breakpoint

CREATE FUNCTION app.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
