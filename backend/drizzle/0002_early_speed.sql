ALTER TABLE "document_versions" ADD COLUMN "header" jsonb;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "footer" jsonb;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "header" jsonb;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "footer" jsonb;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "header" jsonb;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "footer" jsonb;