-- Variables de contexte d'authentification, positionnées par transaction (set_config local),
-- sur le modèle de app.current_clinic_id(). Sans contexte, elles valent NULL : les politiques
-- RLS ne laissent alors rien passer.

-- Compte en cours de connexion (après vérification du mot de passe, avant choix du cabinet).
CREATE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- E-mail en cours de vérification (étape mot de passe de la connexion).
CREATE FUNCTION app.auth_email() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.auth_email', true), '') $$;
--> statement-breakpoint

-- Empreinte du jeton de session présenté par la requête.
CREATE FUNCTION app.session_token_hash() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.session_token_hash', true), '') $$;
