CREATE TABLE "numbering_series" (
	"prefix" text PRIMARY KEY NOT NULL,
	"start_value" integer DEFAULT 1 NOT NULL,
	"padding" integer DEFAULT 4 NOT NULL,
	"include_year" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "numbering_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "numbering_prefix" text;--> statement-breakpoint
ALTER TABLE "numbering_series" ADD CONSTRAINT "numbering_series_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "numbering_series" ADD CONSTRAINT "numbering_series_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_numbering_prefix_numbering_series_prefix_fk" FOREIGN KEY ("numbering_prefix") REFERENCES "public"."numbering_series"("prefix") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Series predeterminadas para cada tipo de documento.
INSERT INTO "numbering_series" ("prefix") VALUES
  ('MEM'), ('NDE'), ('INF'), ('ACT'), ('PLE'), ('CV'), ('OFI'), ('CRT'), ('DOC')
ON CONFLICT ("prefix") DO NOTHING;--> statement-breakpoint
-- Los contadores históricos se guardaban por tipo; ahora la clave es el prefijo.
UPDATE "document_counters" SET "scope" = CASE "scope"
  WHEN 'memorandum' THEN 'MEM'
  WHEN 'delivery_note' THEN 'NDE'
  WHEN 'report' THEN 'INF'
  WHEN 'meeting_minutes' THEN 'ACT'
  WHEN 'evaluation_plan' THEN 'PLE'
  WHEN 'resume' THEN 'CV'
  WHEN 'letter' THEN 'OFI'
  WHEN 'certificate' THEN 'CRT'
  WHEN 'blank' THEN 'DOC'
  ELSE "scope"
END
WHERE "scope" IN (
  'memorandum', 'delivery_note', 'report', 'meeting_minutes', 'evaluation_plan',
  'resume', 'letter', 'certificate', 'blank'
);--> statement-breakpoint
-- Las plantillas existentes heredan el prefijo y la regla de su tipo.
UPDATE "templates" SET
  "numbering_prefix" = CASE "doc_type"
    WHEN 'memorandum' THEN 'MEM'
    WHEN 'delivery_note' THEN 'NDE'
    WHEN 'report' THEN 'INF'
    WHEN 'meeting_minutes' THEN 'ACT'
    WHEN 'evaluation_plan' THEN 'PLE'
    WHEN 'resume' THEN 'CV'
    WHEN 'letter' THEN 'OFI'
    WHEN 'certificate' THEN 'CRT'
    WHEN 'blank' THEN 'DOC'
  END,
  "numbering_enabled" = CASE
    WHEN "doc_type" IN ('resume', 'blank') THEN false
    ELSE true
  END;