-- Cible de la clé composite des montants dus (rendez-vous du même patient) : créée avant elle.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_patient_key" UNIQUE("clinic_id","id","patient_id");--> statement-breakpoint
CREATE TABLE "charges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" uuid DEFAULT app.current_clinic_id() NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"practitioner_id" uuid,
	"label" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancellation_reason" text,
	CONSTRAINT "charges_clinic_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "charges_clinic_id_patient_key" UNIQUE("clinic_id","id","patient_id"),
	CONSTRAINT "charges_idempotency_key" UNIQUE("clinic_id","idempotency_key"),
	CONSTRAINT "charges_amount_range" CHECK ("charges"."amount_cents" between 1 and 100000000),
	CONSTRAINT "charges_currency_format" CHECK ("charges"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "charges_label_length" CHECK (char_length("charges"."label") between 1 and 120),
	CONSTRAINT "charges_status_values" CHECK ("charges"."status" in ('OPEN', 'CANCELLED')),
	CONSTRAINT "charges_reason_length" CHECK (char_length("charges"."cancellation_reason") between 3 and 200),
	CONSTRAINT "charges_cancellation_consistent" CHECK (("charges"."status" = 'CANCELLED') = ("charges"."cancelled_at" is not null and "charges"."cancelled_by" is not null and "charges"."cancellation_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" uuid DEFAULT app.current_clinic_id() NOT NULL,
	"patient_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"status" text DEFAULT 'RECORDED' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"recorded_by" uuid,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	CONSTRAINT "payments_clinic_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "payments_idempotency_key" UNIQUE("clinic_id","idempotency_key"),
	CONSTRAINT "payments_amount_range" CHECK ("payments"."amount_cents" between 1 and 100000000),
	CONSTRAINT "payments_currency_format" CHECK ("payments"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payments_method_values" CHECK ("payments"."method" in ('CASH', 'CARD', 'CHECK', 'TRANSFER', 'OTHER')),
	CONSTRAINT "payments_status_values" CHECK ("payments"."status" in ('RECORDED', 'VOIDED')),
	CONSTRAINT "payments_reference_length" CHECK (char_length("payments"."reference") <= 60),
	CONSTRAINT "payments_reason_length" CHECK (char_length("payments"."void_reason") between 3 and 200),
	CONSTRAINT "payments_void_consistent" CHECK (("payments"."status" = 'VOIDED') = ("payments"."voided_at" is not null and "payments"."voided_by" is not null and "payments"."void_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_appointment_fk" FOREIGN KEY ("clinic_id","appointment_id","patient_id") REFERENCES "public"."appointments"("clinic_id","id","patient_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_practitioner_fk" FOREIGN KEY ("clinic_id","practitioner_id") REFERENCES "public"."practitioners"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_charge_fk" FOREIGN KEY ("clinic_id","charge_id","patient_id") REFERENCES "public"."charges"("clinic_id","id","patient_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charges_patient_idx" ON "charges" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE INDEX "charges_appointment_idx" ON "charges" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "payments_charge_idx" ON "payments" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "payments_received_idx" ON "payments" USING btree ("clinic_id","received_at");
