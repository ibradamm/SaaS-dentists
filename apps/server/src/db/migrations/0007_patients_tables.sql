CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" uuid DEFAULT app.current_clinic_id() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"file_name" text NOT NULL,
	"date_format" text NOT NULL,
	"total_rows" integer NOT NULL,
	"counts" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"committed_at" timestamp with time zone,
	"reverted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_clinic_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "import_batches_kind_values" CHECK ("import_batches"."kind" in ('PATIENTS')),
	CONSTRAINT "import_batches_status_values" CHECK ("import_batches"."status" in ('DRAFT', 'COMMITTED', 'REVERTED', 'DISCARDED')),
	CONSTRAINT "import_batches_file_name_length" CHECK (char_length("import_batches"."file_name") between 1 and 255),
	CONSTRAINT "import_batches_total_rows_range" CHECK ("import_batches"."total_rows" between 1 and 20000)
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" uuid DEFAULT app.current_clinic_id() NOT NULL,
	"batch_id" uuid NOT NULL,
	"line" integer NOT NULL,
	"status" text NOT NULL,
	"dedup_key" text,
	"external_ref" text,
	"data" jsonb,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"patient_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_rows_batch_line_key" UNIQUE("batch_id","line"),
	CONSTRAINT "import_rows_status_values" CHECK ("import_rows"."status" in ('VALID', 'INVALID', 'DUPLICATE_IN_FILE', 'EXISTING'))
);
--> statement-breakpoint
CREATE TABLE "patient_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" uuid DEFAULT app.current_clinic_id() NOT NULL,
	"patient_id" uuid NOT NULL,
	"phone_e164" text NOT NULL,
	"relationship" text DEFAULT 'SELF' NOT NULL,
	"label" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_contacts_patient_phone_key" UNIQUE("patient_id","phone_e164"),
	CONSTRAINT "patient_contacts_phone_format" CHECK ("patient_contacts"."phone_e164" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "patient_contacts_relationship_values" CHECK ("patient_contacts"."relationship" in ('SELF', 'GUARDIAN', 'OTHER')),
	CONSTRAINT "patient_contacts_label_length" CHECK (char_length("patient_contacts"."label") <= 60)
);
--> statement-breakpoint
CREATE TABLE "patient_medical_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" uuid DEFAULT app.current_clinic_id() NOT NULL,
	"patient_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"content_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" uuid DEFAULT app.current_clinic_id() NOT NULL,
	"last_name" text NOT NULL,
	"first_name" text NOT NULL,
	"birth_date" date,
	"email" text,
	"administrative_note" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_source" text NOT NULL,
	"import_batch_id" uuid,
	"external_ref" text,
	"search_text" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_clinic_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "patients_last_name_length" CHECK (char_length("patients"."last_name") between 1 and 100),
	CONSTRAINT "patients_first_name_length" CHECK (char_length("patients"."first_name") between 1 and 100),
	CONSTRAINT "patients_email_format" CHECK ("patients"."email" is null or "patients"."email" ~ '^[^@\s]+@[^@\s]+$'),
	CONSTRAINT "patients_note_length" CHECK (char_length("patients"."administrative_note") <= 1000),
	CONSTRAINT "patients_status_values" CHECK ("patients"."status" in ('ACTIVE', 'ARCHIVED')),
	CONSTRAINT "patients_source_values" CHECK ("patients"."created_source" in ('STAFF', 'IMPORT')),
	CONSTRAINT "patients_external_ref_length" CHECK (char_length("patients"."external_ref") <= 64),
	CONSTRAINT "patients_birth_date_range" CHECK ("patients"."birth_date" is null or "patients"."birth_date" >= date '1900-01-01')
);
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_fk" FOREIGN KEY ("clinic_id","batch_id") REFERENCES "public"."import_batches"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_medical_notes" ADD CONSTRAINT "patient_medical_notes_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_import_batch_fk" FOREIGN KEY ("clinic_id","import_batch_id") REFERENCES "public"."import_batches"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batches_clinic_created_idx" ON "import_batches" USING btree ("clinic_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_rows_batch_dedup_idx" ON "import_rows" USING btree ("batch_id","dedup_key");--> statement-breakpoint
CREATE INDEX "import_rows_batch_ref_idx" ON "import_rows" USING btree ("batch_id","external_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_contacts_one_primary_key" ON "patient_contacts" USING btree ("patient_id") WHERE "patient_contacts"."is_primary";--> statement-breakpoint
CREATE INDEX "patient_contacts_clinic_phone_idx" ON "patient_contacts" USING btree ("clinic_id","phone_e164");--> statement-breakpoint
CREATE INDEX "patient_medical_notes_patient_idx" ON "patient_medical_notes" USING btree ("clinic_id","patient_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "patients_clinic_external_ref_key" ON "patients" USING btree ("clinic_id","external_ref") WHERE "patients"."external_ref" is not null;--> statement-breakpoint
CREATE INDEX "patients_search_trgm_idx" ON "patients" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "patients_clinic_identity_idx" ON "patients" USING btree ("clinic_id","search_text","birth_date");--> statement-breakpoint
CREATE INDEX "patients_import_batch_idx" ON "patients" USING btree ("import_batch_id");