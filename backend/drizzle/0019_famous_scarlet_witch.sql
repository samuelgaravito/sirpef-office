-- ─────────────────────────────────────────────────────────────────────────────
-- Numeración por plantilla: cada plantilla tiene su propia enumeración.
--
-- Antes, la serie de numeración se identificaba por el prefijo (`prefix` era la
-- clave primaria) y el contador también (`document_counters.scope`). Eso
-- obligaba a que el prefijo fuera único entre las plantillas vivas y hacía que
-- dos plantillas que lo compartieran (la papelera liberaba el prefijo)
-- compartieran contador: sus números se intercalaban y la que se restauraba
-- perdía su enumeración.
--
-- Ahora la serie tiene identificador propio y la plantilla la referencia con
-- `templates.numbering_series_id` (índice único: la relación es 1 a 1). El
-- prefijo queda como la etiqueta visible del número y puede repetirse: cada
-- plantilla enumera por separado, con su contador y su suelo.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. La plantilla ya no apunta a la serie por el prefijo: el prefijo queda
--    como copia legible en `templates.numbering_prefix`.
ALTER TABLE "templates" DROP CONSTRAINT "templates_numbering_prefix_numbering_series_prefix_fk";
--> statement-breakpoint
DROP INDEX "templates_numbering_prefix_unique_idx";
--> statement-breakpoint

-- 2. El número de un documento es único dentro de su serie (dos plantillas
--    pueden usar el mismo prefijo y enumerar por separado).
DROP INDEX "documents_doc_number_idx";
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "numbering_series_id" uuid;
--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "numbering_series_id" uuid;
--> statement-breakpoint

-- 3. La serie gana identificador propio y deja de estar clavada al prefijo.
ALTER TABLE "numbering_series" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;
--> statement-breakpoint
ALTER TABLE "numbering_series" DROP CONSTRAINT "numbering_series_pkey";
--> statement-breakpoint
ALTER TABLE "numbering_series" ADD CONSTRAINT "numbering_series_pkey" PRIMARY KEY ("id");
--> statement-breakpoint

-- 3a. Cada plantilla con numeración recibe su propia serie, heredando la
--     configuración de la serie antigua de su prefijo.
DO $$
DECLARE
  t record;
  cfg jsonb;
  new_id uuid;
BEGIN
  -- Configuración heredada de cada prefijo (la más antigua gana).
  CREATE TEMP TABLE _legacy_cfg ON COMMIT DROP AS
  SELECT DISTINCT ON (prefix)
    prefix,
    jsonb_build_object(
      'start_value', start_value,
      'padding', padding,
      'include_year', include_year,
      'created_by', created_by,
      'updated_by', updated_by,
      'created_at', created_at,
      'updated_at', updated_at
    ) AS cfg
  FROM numbering_series
  ORDER BY prefix, created_at;

  FOR t IN
    SELECT id, numbering_prefix
    FROM templates
    WHERE numbering_prefix IS NOT NULL
    ORDER BY created_at, id
  LOOP
    SELECT c.cfg INTO cfg FROM _legacy_cfg c WHERE c.prefix = t.numbering_prefix;

    INSERT INTO numbering_series (
      prefix, start_value, padding, include_year,
      created_by, updated_by, created_at, updated_at
    )
    VALUES (
      t.numbering_prefix,
      COALESCE((cfg ->> 'start_value')::int, 1),
      COALESCE((cfg ->> 'padding')::int, 4),
      COALESCE((cfg ->> 'include_year')::boolean, true),
      (cfg ->> 'created_by')::uuid,
      (cfg ->> 'updated_by')::uuid,
      COALESCE((cfg ->> 'created_at')::timestamptz, now()),
      COALESCE((cfg ->> 'updated_at')::timestamptz, now())
    )
    RETURNING id INTO new_id;

    UPDATE templates SET numbering_series_id = new_id WHERE id = t.id;
  END LOOP;

  DROP TABLE _legacy_cfg;
END $$;
--> statement-breakpoint

-- 3b. Las series antiguas (identificadas por el prefijo) se retiran: sus
--     números ya están en la serie de su plantilla.
DELETE FROM "numbering_series" s
WHERE NOT EXISTS (SELECT 1 FROM templates t WHERE t.numbering_series_id = s.id);
--> statement-breakpoint

-- 4. El contador viaja con la serie: el ámbito antiguo era el prefijo.
ALTER TABLE "document_counters" ADD COLUMN "series_id" uuid;
--> statement-breakpoint
UPDATE "document_counters" c
SET "series_id" = (
  SELECT t.numbering_series_id
  FROM templates t
  WHERE t.numbering_prefix = c.scope
  ORDER BY t.created_at, t.id
  LIMIT 1
)
WHERE c."series_id" IS NULL;
--> statement-breakpoint

-- 4a. Los contadores sin serie (prefijos que ya no tiene ninguna plantilla)
--     se descartan: su enumeración ya no existe.
DELETE FROM "document_counters" WHERE "series_id" IS NULL;
--> statement-breakpoint

ALTER TABLE "document_counters" DROP CONSTRAINT "document_counters_scope_year_pk";
--> statement-breakpoint
ALTER TABLE "document_counters" DROP COLUMN "scope";
--> statement-breakpoint
ALTER TABLE "document_counters" ALTER COLUMN "series_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "document_counters" ADD CONSTRAINT "document_counters_series_id_year_pk" PRIMARY KEY ("series_id", "year");
--> statement-breakpoint

-- 5. Cada documento apunta a la serie que lo emitió: la de su plantilla.
UPDATE documents d
SET numbering_series_id = t.numbering_series_id
FROM templates t
WHERE d.template_id = t.id
  AND t.numbering_series_id IS NOT NULL
  AND d.numbering_value IS NOT NULL
  AND d.numbering_series_id IS NULL;
--> statement-breakpoint

-- 6. El suelo de cada serie nunca puede quedar por debajo del número ya
--    emitido: el contador se recalcula con los documentos vivos.
INSERT INTO "document_counters" ("series_id", "year", "counter")
SELECT d.numbering_series_id, d.numbering_year, MAX(d.numbering_value)
FROM documents d
WHERE d.numbering_series_id IS NOT NULL
  AND d.numbering_value IS NOT NULL
  AND d.deleted_at IS NULL
GROUP BY d.numbering_series_id, d.numbering_year
ON CONFLICT ("series_id", "year")
DO UPDATE SET "counter" = GREATEST(document_counters.counter, EXCLUDED.counter);
--> statement-breakpoint

-- 7. Claves foráneas e índices.
ALTER TABLE "templates" ADD CONSTRAINT "templates_numbering_series_id_numbering_series_id_fk" FOREIGN KEY ("numbering_series_id") REFERENCES "public"."numbering_series"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_counters" ADD CONSTRAINT "document_counters_series_id_numbering_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."numbering_series"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_numbering_series_id_numbering_series_id_fk" FOREIGN KEY ("numbering_series_id") REFERENCES "public"."numbering_series"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "numbering_series_prefix_idx" ON "numbering_series" USING btree ("prefix");
--> statement-breakpoint
CREATE UNIQUE INDEX "templates_numbering_series_unique_idx" ON "templates" USING btree ("numbering_series_id") WHERE "templates"."numbering_series_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "documents_doc_number_series_idx" ON "documents" USING btree ("numbering_series_id","doc_number") WHERE "documents"."doc_number" is not null and "documents"."deleted_at" IS NULL and "documents"."numbering_series_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "documents_doc_number_idx" ON "documents" USING btree ("doc_number") WHERE "documents"."doc_number" is not null and "documents"."deleted_at" IS NULL and "documents"."numbering_series_id" is null;
