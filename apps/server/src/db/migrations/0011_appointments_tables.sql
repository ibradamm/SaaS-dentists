CREATE TABLE "appointment_statuses" (
	"code" text PRIMARY KEY NOT NULL,
	"occupies_slot" boolean NOT NULL,
	"sort_order" smallint NOT NULL,
	CONSTRAINT "appointment_statuses_code_format" CHECK ("appointment_statuses"."code" ~ '^[A-Z][A-Z_]*$')
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" uuid DEFAULT app.current_clinic_id() NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_type_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"occupies_slot" boolean DEFAULT true NOT NULL,
	"note" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancellation_reason" text,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_range" CHECK ("appointments"."end_at" > "appointments"."start_at"),
	CONSTRAINT "appointments_duration" CHECK ("appointments"."end_at" - "appointments"."start_at" between interval '5 minutes' and interval '480 minutes'),
	CONSTRAINT "appointments_grid" CHECK (extract(epoch from "appointments"."start_at")::bigint % 300 = 0 and extract(epoch from "appointments"."end_at")::bigint % 300 = 0),
	CONSTRAINT "appointments_note_length" CHECK (char_length("appointments"."note") <= 500),
	CONSTRAINT "appointments_reason_length" CHECK (char_length("appointments"."cancellation_reason") <= 200)
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_status_appointment_statuses_code_fk" FOREIGN KEY ("status") REFERENCES "public"."appointment_statuses"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_practitioner_fk" FOREIGN KEY ("clinic_id","practitioner_id") REFERENCES "public"."practitioners"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_type_fk" FOREIGN KEY ("clinic_id","appointment_type_id") REFERENCES "public"."appointment_types"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_clinic_start_idx" ON "appointments" USING btree ("clinic_id","start_at");--> statement-breakpoint
CREATE INDEX "appointments_practitioner_start_idx" ON "appointments" USING btree ("practitioner_id","start_at");--> statement-breakpoint
CREATE INDEX "appointments_patient_start_idx" ON "appointments" USING btree ("patient_id","start_at");