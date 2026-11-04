ALTER TABLE "designs" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "deleted_at" timestamp with time zone;