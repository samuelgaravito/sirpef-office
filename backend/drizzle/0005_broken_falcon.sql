ALTER TYPE "public"."document_status" ADD VALUE 'sent';--> statement-breakpoint
ALTER TYPE "public"."document_status" ADD VALUE 'approved';--> statement-breakpoint
ALTER TYPE "public"."document_status" ADD VALUE 'rejected';--> statement-breakpoint
ALTER TYPE "public"."document_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "designs" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;