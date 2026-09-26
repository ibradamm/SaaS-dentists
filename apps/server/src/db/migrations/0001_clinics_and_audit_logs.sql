CREATE TABLE "clinics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"locale" text NOT NULL,
	"currency" char(3) NOT NULL,
	"country_code" char(2) NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinics_name_length" CHECK (char_length("clinics"."name") between 1 and 200),
	CONSTRAINT "clinics_currency_format" CHECK ("clinics"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "clinics_country_format" CHECK ("clinics"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "clinics_status_values" CHECK ("clinics"."status" in ('ACTIVE', 'SUSPENDED'))
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" uuid DEFAULT app.current_clinic_id() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"changes" jsonb,
	"request_id" text,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_actor_type_values" CHECK ("audit_logs"."actor_type" in ('USER', 'AGENT', 'SYSTEM')),
	CONSTRAINT "audit_logs_action_format" CHECK ("audit_logs"."action" ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$')
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_clinic_created_idx" ON "audit_logs" USING btree ("clinic_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_clinic_entity_idx" ON "audit_logs" USING btree ("clinic_id","entity_type","entity_id");