CREATE TYPE "public"."document_message_status" AS ENUM('pending_approval', 'sent', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "document_message_recipients" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_message_recipients_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "document_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" "document_message_status" DEFAULT 'pending_approval' NOT NULL,
	"document_version" integer NOT NULL,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"rejected_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "menu_keys" SET DEFAULT ARRAY['home','inbox','documents','templates','designs']::text[];--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "locked_by" uuid;--> statement-breakpoint
ALTER TABLE "document_message_recipients" ADD CONSTRAINT "document_message_recipients_message_id_document_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."document_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_message_recipients" ADD CONSTRAINT "document_message_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_messages" ADD CONSTRAINT "document_messages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_messages" ADD CONSTRAINT "document_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_messages" ADD CONSTRAINT "document_messages_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_message_recipients_user_idx" ON "document_message_recipients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "document_messages_document_idx" ON "document_messages" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_messages_sender_idx" ON "document_messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "document_messages_status_idx" ON "document_messages" USING btree ("status");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "users" SET "menu_keys" = array_append("menu_keys", 'inbox') WHERE NOT ('inbox' = ANY("menu_keys"));