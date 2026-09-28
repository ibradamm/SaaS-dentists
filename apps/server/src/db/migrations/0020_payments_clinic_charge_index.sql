DROP INDEX "payments_charge_idx";--> statement-breakpoint
CREATE INDEX "payments_clinic_charge_idx" ON "payments" USING btree ("clinic_id","charge_id");