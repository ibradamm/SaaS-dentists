CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"mfa_secret_enc" text,
	"mfa_enabled_at" timestamp with time zone,
	"mfa_last_time_step" bigint,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_key" UNIQUE("email"),
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email")),
	CONSTRAINT "users_full_name_length" CHECK (char_length("users"."full_name") between 1 and 200),
	CONSTRAINT "users_status_values" CHECK ("users"."status" in ('ACTIVE', 'DISABLED')),
	CONSTRAINT "users_failed_login_count_positive" CHECK ("users"."failed_login_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "clinic_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" uuid DEFAULT app.current_clinic_id() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinic_memberships_clinic_user_key" UNIQUE("clinic_id","user_id"),
	CONSTRAINT "clinic_memberships_role_values" CHECK ("clinic_memberships"."role" in ('ADMIN', 'DENTIST', 'SECRETARY')),
	CONSTRAINT "clinic_memberships_status_values" CHECK ("clinic_memberships"."status" in ('ACTIVE', 'DISABLED'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"clinic_id" uuid DEFAULT app.current_clinic_id() NOT NULL,
	"user_id" uuid NOT NULL,
	"state" text NOT NULL,
	"csrf_token" text NOT NULL,
	"mfa_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" "inet",
	"user_agent" text,
	CONSTRAINT "sessions_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "sessions_state_values" CHECK ("sessions"."state" in ('MFA_PENDING', 'ACTIVE')),
	CONSTRAINT "sessions_user_agent_length" CHECK (char_length("sessions"."user_agent") <= 300)
);
--> statement-breakpoint
ALTER TABLE "clinic_memberships" ADD CONSTRAINT "clinic_memberships_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_memberships" ADD CONSTRAINT "clinic_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_membership_fk" FOREIGN KEY ("clinic_id","user_id") REFERENCES "public"."clinic_memberships"("clinic_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinic_memberships_user_idx" ON "clinic_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_clinic_user_idx" ON "sessions" USING btree ("clinic_id","user_id");