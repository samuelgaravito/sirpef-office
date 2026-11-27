ALTER TABLE "document_messages" ADD COLUMN "annulled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_messages" ADD COLUMN "annulled_reason" text;