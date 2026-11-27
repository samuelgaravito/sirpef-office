CREATE TABLE "totp_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"secret_encrypted" text NOT NULL,
	"key_id" text DEFAULT '1' NOT NULL,
	"algorithm" text DEFAULT 'SHA1' NOT NULL,
	"digits" integer DEFAULT 6 NOT NULL,
	"period" integer DEFAULT 30 NOT NULL,
	"paired_device_id" text NOT NULL,
	"paired_device_label" text DEFAULT '' NOT NULL,
	"last_used_step" bigint,
	"secret_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "totp_credentials_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "totp_device_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"purpose" text NOT NULL,
	"nonce_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "totp_pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"created_by_device_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "totp_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signature_challenges" ADD COLUMN "totp_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "signature_challenges" ADD COLUMN "totp_step" integer;--> statement-breakpoint
ALTER TABLE "signature_challenges" ADD COLUMN "totp_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "signature_challenges" ADD COLUMN "totp_authorized_device_id" uuid;--> statement-breakpoint
ALTER TABLE "totp_credentials" ADD CONSTRAINT "totp_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totp_device_challenges" ADD CONSTRAINT "totp_device_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totp_device_challenges" ADD CONSTRAINT "totp_device_challenges_device_id_mobile_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."mobile_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totp_pairing_codes" ADD CONSTRAINT "totp_pairing_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totp_pairing_codes" ADD CONSTRAINT "totp_pairing_codes_created_by_device_id_mobile_devices_id_fk" FOREIGN KEY ("created_by_device_id") REFERENCES "public"."mobile_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totp_recovery_codes" ADD CONSTRAINT "totp_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "totp_credentials_user_idx" ON "totp_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "totp_device_challenges_nonce_idx" ON "totp_device_challenges" USING btree ("nonce_hash");--> statement-breakpoint
CREATE INDEX "totp_device_challenges_user_idx" ON "totp_device_challenges" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "totp_pairing_codes_hash_idx" ON "totp_pairing_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "totp_pairing_codes_user_idx" ON "totp_pairing_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "totp_recovery_codes_hash_idx" ON "totp_recovery_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "totp_recovery_codes_user_idx" ON "totp_recovery_codes" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "signature_challenges" ADD CONSTRAINT "signature_challenges_totp_authorized_device_id_mobile_devices_id_fk" FOREIGN KEY ("totp_authorized_device_id") REFERENCES "public"."mobile_devices"("id") ON DELETE set null ON UPDATE no action;