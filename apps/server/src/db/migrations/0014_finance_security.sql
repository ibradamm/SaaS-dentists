-- Paiements : isolation par cabinet, droits minimaux et invariants garantis par la base
-- (docs/adr/0009, F2 à F5).

ALTER TABLE charges ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE charges FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY charges_tenant ON charges FOR ALL
  USING (clinic_id = app.current_clinic_id())
  WITH CHECK (clinic_id = app.current_clinic_id());
--> statement-breakpoint
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payments_tenant ON payments FOR ALL
  USING (clinic_id = app.current_clinic_id())
  WITH CHECK (clinic_id = app.current_clinic_id());
--> statement-breakpoint

-- Jamais supprimés, jamais modifiés : seules les colonnes de l'annulation sont modifiables.
GRANT SELECT, INSERT ON charges, payments TO dental_app;
--> statement-breakpoint
GRANT UPDATE (status, cancelled_at, cancelled_by, cancellation_reason) ON charges TO dental_app;
--> statement-breakpoint
GRANT UPDATE (status, voided_at, voided_by, void_reason) ON payments TO dental_app;
--> statement-breakpoint

-- Codes d'erreur propres (traduits par le service) :
--   DF001 paiement supérieur au restant dû ; DF002 montant dû annulé ;
--   DF003 montant dû avec paiements valides ; DF004 transition interdite ; DF005 devise.

-- Montant dû : créé ouvert ; seule transition, OPEN → CANCELLED, définitive, et seulement sans
-- paiement valide. La mise à jour verrouille la ligne : un encaissement simultané attend.
CREATE FUNCTION app.charges_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' THEN
      RAISE EXCEPTION 'montant dû créé hors de l''état ouvert' USING ERRCODE = 'DF004';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'CANCELLED' OR NEW.status <> 'CANCELLED' THEN
    RAISE EXCEPTION 'transition interdite pour un montant dû' USING ERRCODE = 'DF004';
  END IF;
  IF EXISTS (
    SELECT 1 FROM payments p
    WHERE p.clinic_id = NEW.clinic_id AND p.charge_id = NEW.id AND p.status = 'RECORDED'
  ) THEN
    RAISE EXCEPTION 'montant dû avec paiements valides' USING ERRCODE = 'DF003';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER charges_guard BEFORE INSERT OR UPDATE ON charges
  FOR EACH ROW EXECUTE FUNCTION app.charges_guard();
--> statement-breakpoint

-- Paiement : créé encaissé, sur un montant dû ouvert de même devise, sans dépasser le restant
-- dû. La ligne du montant dû est verrouillée avant le calcul : deux encaissements simultanés
-- sont sérialisés, le second voit le premier. Seule transition : RECORDED → VOIDED, définitive.
CREATE FUNCTION app.payments_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  due integer;
  charge_status text;
  charge_currency text;
  paid bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'VOIDED' OR NEW.status <> 'VOIDED' THEN
      RAISE EXCEPTION 'transition interdite pour un paiement' USING ERRCODE = 'DF004';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status <> 'RECORDED' THEN
    RAISE EXCEPTION 'paiement créé hors de l''état encaissé' USING ERRCODE = 'DF004';
  END IF;
  SELECT c.amount_cents, c.status, c.currency INTO due, charge_status, charge_currency
    FROM charges c
    WHERE c.clinic_id = NEW.clinic_id AND c.id = NEW.charge_id
    FOR UPDATE;
  IF NOT FOUND THEN
    -- Montant dû inconnu (ou d'un autre cabinet) : la clé étrangère refuse la ligne.
    RETURN NEW;
  END IF;
  IF charge_status <> 'OPEN' THEN
    RAISE EXCEPTION 'montant dû annulé' USING ERRCODE = 'DF002';
  END IF;
  IF charge_currency <> NEW.currency THEN
    RAISE EXCEPTION 'devise différente du montant dû' USING ERRCODE = 'DF005';
  END IF;
  SELECT coalesce(sum(p.amount_cents), 0) INTO paid
    FROM payments p
    WHERE p.clinic_id = NEW.clinic_id AND p.charge_id = NEW.charge_id AND p.status = 'RECORDED';
  IF paid + NEW.amount_cents > due THEN
    RAISE EXCEPTION 'paiement supérieur au restant dû' USING ERRCODE = 'DF001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payments_guard BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION app.payments_guard();
