CREATE TABLE "appointment_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" uuid DEFAULT app.current_clinic_id() NOT NULL,
	"name" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"color" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_types_clinic_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "appointment_types_name_length" CHECK (char_length("appointment_types"."name") between 1 and 100),
	CONSTRAINT "appointment_types_duration_range" CHECK ("appointment_types"."duration_minutes" between 5 and 480 and "appointment_types"."duration_minutes" % 5 = 0),
	CONSTRAINT "appointment_types_color_format" CHECK ("appointment_types"."color" ~ '^#[0-9a-f]{6}$'),
	CONSTRAINT "appointment_types_status_values" CHECK ("appointment_types"."status" in ('ACTIVE', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE TABLE "availability_blocks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" uuid DEFAULT app.current_clinic_id() NOT NULL,
	"practitioner_id" uuid,
	"kind" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"label" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_blocks_kind_values" CHECK ("availability_blocks"."kind" in ('ABSENCE', 'BLOCK')),
	CONSTRAINT "availability_blocks_range" CHECK ("availability_blocks"."end_at" > "availability_blocks"."start_at"),
	CONSTRAINT "availability_blocks_max_duration" CHECK ("availability_blocks"."end_at" - "availability_blocks"."start_at" <= interval '366 days'),
	CONSTRAINT "availability_blocks_label_length" CHECK (char_length("availability_blocks"."label") <= 100)
);
--> statement-breakpoint
CREATE TABLE "practitioners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" uuid DEFAULT app.current_clinic_id() NOT NULL,
	"display_name" text NOT NULL,
	"user_id" uuid,
	"color" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practitioners_clinic_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "practitioners_display_name_length" CHECK (char_length("practitioners"."display_name") between 1 and 100),
	CONSTRAINT "practitioners_color_format" CHECK ("practitioners"."color" ~ '^#[0-9a-f]{6}$'),
	CONSTRAINT "practitioners_status_values" CHECK ("practitioners"."status" in ('ACTIVE', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE TABLE "working_intervals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" uuid DEFAULT app.current_clinic_id() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "working_intervals_weekday_range" CHECK ("working_intervals"."weekday" between 1 and 7),
	CONSTRAINT "working_intervals_minutes_range" CHECK ("working_intervals"."start_minute" >= 0 and "working_intervals"."start_minute" < "working_intervals"."end_minute" and "working_intervals"."end_minute" <= 1440),
	CONSTRAINT "working_intervals_minutes_grid" CHECK ("working_intervals"."start_minute" % 5 = 0 and "working_intervals"."end_minute" % 5 = 0)
);
--> statement-breakpoint
CREATE TABLE "working_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" uuid DEFAULT app.current_clinic_id() NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "working_schedules_clinic_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "working_schedules_valid_range" CHECK ("working_schedules"."valid_to" is null or "working_schedules"."valid_to" > "working_schedules"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "address_line2" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "appointment_types" ADD CONSTRAINT "appointment_types_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_practitioner_fk" FOREIGN KEY ("clinic_id","practitioner_id") REFERENCES "public"."practitioners"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_membership_fk" FOREIGN KEY ("clinic_id","user_id") REFERENCES "public"."clinic_memberships"("clinic_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_intervals" ADD CONSTRAINT "working_intervals_schedule_fk" FOREIGN KEY ("clinic_id","schedule_id") REFERENCES "public"."working_schedules"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_schedules" ADD CONSTRAINT "working_schedules_practitioner_fk" FOREIGN KEY ("clinic_id","practitioner_id") REFERENCES "public"."practitioners"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_types_active_name_key" ON "appointment_types" USING btree ("clinic_id",lower("name")) WHERE "appointment_types"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "availability_blocks_clinic_start_idx" ON "availability_blocks" USING btree ("clinic_id","start_at");--> statement-breakpoint
CREATE INDEX "availability_blocks_practitioner_start_idx" ON "availability_blocks" USING btree ("practitioner_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "practitioners_clinic_user_key" ON "practitioners" USING btree ("clinic_id","user_id") WHERE "practitioners"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "working_intervals_schedule_idx" ON "working_intervals" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "working_schedules_practitioner_idx" ON "working_schedules" USING btree ("practitioner_id","valid_from");--> statement-breakpoint
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_address_lengths" CHECK (coalesce(char_length("clinics"."address_line1"), 0) <= 200 and coalesce(char_length("clinics"."address_line2"), 0) <= 200 and coalesce(char_length("clinics"."postal_code"), 0) <= 20 and coalesce(char_length("clinics"."city"), 0) <= 100);--> statement-breakpoint
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_phone_format" CHECK ("clinics"."phone" is null or "clinics"."phone" ~ '^\+[1-9][0-9]{6,14}$');--> statement-breakpoint
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_email_format" CHECK ("clinics"."email" is null or "clinics"."email" ~ '^[^@\s]+@[^@\s]+$');