ALTER TYPE "public"."document_message_status" ADD VALUE 'superseded';--> statement-breakpoint
ALTER TYPE "public"."version_kind" ADD VALUE 'emergency';--> statement-breakpoint
CREATE TABLE "document_emergency_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"original_message_id" uuid,
	"reason" text NOT NULL,
	"previous_status" text NOT NULL,
	"previous_version" integer NOT NULL,
	"previous_locked_at" timestamp with time zone,
	"previous_locked_by" uuid,
	"previous_doc_number" text,
	"before_content_sha256" text NOT NULL,
	"after_content_sha256" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"result_version" integer,
	"result_message_id" uuid,
	"reauth_method" text DEFAULT 'totp' NOT NULL,
	"totp_step" integer,
	"ip" text,
	"user_agent" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_signatures" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD COLUMN "superseded_reason" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "emergency_edit_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "emergency_edit_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "signature_certificates" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "signature_certificates" ADD COLUMN "superseded_reason" text;--> statement-breakpoint
ALTER TABLE "signature_certificates" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
ALTER TABLE "document_emergency_edits" ADD CONSTRAINT "document_emergency_edits_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_emergency_edits" ADD CONSTRAINT "document_emergency_edits_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_emergency_edits" ADD CONSTRAINT "document_emergency_edits_original_message_id_document_messages_id_fk" FOREIGN KEY ("original_message_id") REFERENCES "public"."document_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_emergency_edits" ADD CONSTRAINT "document_emergency_edits_previous_locked_by_users_id_fk" FOREIGN KEY ("previous_locked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_emergency_edits" ADD CONSTRAINT "document_emergency_edits_result_message_id_document_messages_id_fk" FOREIGN KEY ("result_message_id") REFERENCES "public"."document_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_emergency_edits_document_idx" ON "document_emergency_edits" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_emergency_edits_open_idx" ON "document_emergency_edits" USING btree ("document_id") WHERE "document_emergency_edits"."status" = 'open';--> statement-breakpoint
ALTER TABLE "signature_certificates" ADD CONSTRAINT "signature_certificates_superseded_by_users_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;