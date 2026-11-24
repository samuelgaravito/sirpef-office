CREATE TABLE "document_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"message_id" uuid,
	"user_id" uuid NOT NULL,
	"challenge_id" uuid,
	"device_id" uuid,
	"method" text DEFAULT 'drawn' NOT NULL,
	"signature_png" text NOT NULL,
	"strokes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_sha256" text NOT NULL,
	"signature_sha256" text NOT NULL,
	"sealed_pdf_sha256" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mobile_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"public_key" text NOT NULL,
	"algorithm" text DEFAULT 'ES256' NOT NULL,
	"platform" text DEFAULT 'android' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"app_version" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "signature_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"serial" text NOT NULL,
	"document_id" uuid NOT NULL,
	"signature_id" uuid NOT NULL,
	"verification_token_hash" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cert_json" jsonb NOT NULL,
	"sealed_pdf_path" text NOT NULL,
	"certificate_pdf_path" text NOT NULL,
	"sealed_pdf_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signature_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"message_id" uuid,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content_sha256" text NOT NULL,
	"nonce" text NOT NULL,
	"purpose" text DEFAULT 'approval' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_message_id_document_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."document_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_challenge_id_signature_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."signature_challenges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_device_id_mobile_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."mobile_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_certificates" ADD CONSTRAINT "signature_certificates_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_certificates" ADD CONSTRAINT "signature_certificates_signature_id_document_signatures_id_fk" FOREIGN KEY ("signature_id") REFERENCES "public"."document_signatures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_challenges" ADD CONSTRAINT "signature_challenges_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_challenges" ADD CONSTRAINT "signature_challenges_message_id_document_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."document_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_challenges" ADD CONSTRAINT "signature_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_signatures_challenge_idx" ON "document_signatures" USING btree ("challenge_id");--> statement-breakpoint
CREATE INDEX "document_signatures_document_idx" ON "document_signatures" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_signatures_user_idx" ON "document_signatures" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_devices_user_device_idx" ON "mobile_devices" USING btree ("user_id","device_id");--> statement-breakpoint
CREATE INDEX "mobile_devices_user_idx" ON "mobile_devices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_certificates_serial_idx" ON "signature_certificates" USING btree ("serial");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_certificates_token_idx" ON "signature_certificates" USING btree ("verification_token_hash");--> statement-breakpoint
CREATE INDEX "signature_certificates_document_idx" ON "signature_certificates" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_challenges_nonce_idx" ON "signature_challenges" USING btree ("nonce");--> statement-breakpoint
CREATE INDEX "signature_challenges_document_idx" ON "signature_challenges" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "signature_challenges_user_idx" ON "signature_challenges" USING btree ("user_id");