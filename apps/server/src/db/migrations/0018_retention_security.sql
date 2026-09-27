-- Conservation des données (docs/adr/0011) : purge quotidienne par le worker, au moindre
-- privilège. Le rôle applicatif n'obtient que :
--   1. la liste des identifiants de cabinets (et rien d'autre de la table clinics), pour
--      traiter chaque cabinet dans son propre contexte (withTenant, RLS inchangée) ;
--   2. la suppression des sessions de son cabinet terminées depuis plus de 30 jours. La règle
--      est dans la politique : même une requête erronée ne peut pas supprimer une session
--      active ou récente.

-- 1. Identifiants des cabinets. La table reste soumise à la RLS forcée, y compris pour son
-- propriétaire : cette politique, limitée au rôle propriétaire, permet à la fonction ci-dessous
-- (exécutée avec les droits du propriétaire) de lister les identifiants.
CREATE POLICY clinics_maintenance_ids ON clinics FOR SELECT TO dental_owner USING (true);
--> statement-breakpoint
CREATE FUNCTION app.maintenance_clinic_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$ SELECT id FROM public.clinics ORDER BY id $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.maintenance_clinic_ids() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.maintenance_clinic_ids() TO dental_app;
--> statement-breakpoint

-- 2. Sessions terminées : révoquées, expirées (12 h) ou inactives (60 min), depuis plus de
-- 30 jours. Les durées suivent SECURITY_POLICY (security-policy.ts) ; un test les compare.
CREATE POLICY sessions_delete_ended ON sessions FOR DELETE USING (
  clinic_id = app.current_clinic_id()
  AND coalesce(revoked_at, least(expires_at, last_seen_at + interval '60 minutes'))
      < now() - interval '30 days'
);
--> statement-breakpoint
GRANT DELETE ON sessions TO dental_app;
