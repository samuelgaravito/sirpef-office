-- ─────────────────────────────────────────────────────────────────────────────
-- La serie de numeración declara a su plantilla.
--
-- El vínculo vivía en `templates.numbering_series_id`: para saber de quién era
-- una enumeración había que unir con `templates`. Ahora lo declara la propia
-- serie, con `template_id` (FK, índice único: una enumeración por plantilla) y
-- con `template_name`, una copia legible del nombre de esa plantilla, para
-- poder leer la tabla de un vistazo sin unir nada.
--
-- El vínculo antiguo se retira: queda un solo sitio donde vive, así que no
-- puede desincronizarse.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. La serie declara su plantilla: primero las columnas, sin obligaciones.
ALTER TABLE "numbering_series" ADD COLUMN "template_id" uuid;
--> statement-breakpoint
ALTER TABLE "numbering_series" ADD COLUMN "template_name" text;
--> statement-breakpoint

-- 2. Se hereda el vínculo actual: la plantilla que tenía cada serie.
UPDATE "numbering_series" s
SET "template_id" = t.id,
    "template_name" = t.name
FROM "templates" t
WHERE t.numbering_series_id = s.id;
--> statement-breakpoint

-- 3. Las series sin plantilla (restos de borrados en firme) se retiran con su
--    contador: su enumeración ya no pertenece a nadie.
DELETE FROM "document_counters"
WHERE "series_id" IN (SELECT id FROM "numbering_series" WHERE "template_id" IS NULL);
--> statement-breakpoint
DELETE FROM "numbering_series" WHERE "template_id" IS NULL;
--> statement-breakpoint

-- 4. La plantilla es obligatoria y única: una enumeración por plantilla.
ALTER TABLE "numbering_series" ALTER COLUMN "template_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "numbering_series" ALTER COLUMN "template_name" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "numbering_series" ADD CONSTRAINT "numbering_series_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "numbering_series_template_id_unique_idx" ON "numbering_series" USING btree ("template_id");
--> statement-breakpoint

-- 5. El vínculo antiguo se retira: ahora lo declara la serie.
ALTER TABLE "templates" DROP CONSTRAINT "templates_numbering_series_id_numbering_series_id_fk";
--> statement-breakpoint
DROP INDEX "templates_numbering_series_unique_idx";
--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "numbering_series_id";
