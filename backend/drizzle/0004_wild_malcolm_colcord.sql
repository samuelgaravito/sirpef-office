ALTER TABLE "documents" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "documents" d
SET "description" = LEFT(t."description", 500)
FROM "templates" t
WHERE d."template_id" = t."id" AND d."description" = '';
