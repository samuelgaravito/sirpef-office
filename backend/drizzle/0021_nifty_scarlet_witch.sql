-- ─────────────────────────────────────────────────────────────────────────────
-- La serie es la dueña de la enumeración; la plantilla solo conserva el
-- interruptor.
--
-- Hasta aquí el prefijo vivía duplicado: `templates.numbering_prefix` (la
-- copia que leía la aplicación) y `numbering_series.prefix` (la de la serie).
-- Con el prefijo duplicado, la aplicación y la tabla podían discrepar y
-- guardar no llegaba a la serie.
--
-- Ahora la serie es la única fuente de verdad: el prefijo (la etiqueta del
-- número), el número inicial, los dígitos y el reinicio anual viven en
-- `numbering_series`. En `templates` queda solo `numbering_enabled`.
--
-- El prefijo deja de ser obligatorio: una serie puede numerar sin etiqueta
-- (`0007-2026`) y el concepto de «código automático» desaparece (ya no hay
-- quien asigne un prefijo por la espalda).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Las plantillas con prefijo pero sin serie (numeración apagada) reciben
--    la suya, para no perder su etiqueta al retirar la columna.
INSERT INTO "numbering_series" (
  "template_id", "template_name", "prefix", "start_value", "padding", "include_year"
)
SELECT t.id, t.name, t.numbering_prefix, 1, 4, true
FROM "templates" t
WHERE t.numbering_prefix IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "numbering_series" s WHERE s.template_id = t.id)
ON CONFLICT ("template_id") DO NOTHING;
--> statement-breakpoint

-- 2. El prefijo de la serie es el que se veía en la aplicación: la copia de
--    la plantilla manda si las dos divergen.
UPDATE "numbering_series" s
SET "prefix" = t.numbering_prefix
FROM "templates" t
WHERE t.id = s.template_id
  AND t.numbering_prefix IS NOT NULL
  AND s.prefix <> t.numbering_prefix;
--> statement-breakpoint

-- 3. El prefijo vacío es una serie sin etiqueta: `0007-2026`.
ALTER TABLE "numbering_series" ALTER COLUMN "prefix" SET DEFAULT '';
--> statement-breakpoint

-- 4. La serie es la dueña del prefijo: la plantilla ya no lo guarda.
ALTER TABLE "templates" DROP COLUMN "numbering_prefix";
--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "numbering_prefix_auto";
