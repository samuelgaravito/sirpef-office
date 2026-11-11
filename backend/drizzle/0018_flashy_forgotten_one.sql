ALTER TABLE "templates" ADD COLUMN "numbering_prefix_auto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Las plantillas sin numeración no ocupan serie: liberan su prefijo para que
-- otra plantilla pueda usarlo.
UPDATE "templates" SET "numbering_prefix" = NULL WHERE "numbering_enabled" = false AND "numbering_prefix" IS NOT NULL;--> statement-breakpoint
-- Prefijos duplicados entre plantillas vivas: la más antigua conserva el
-- suyo y las demás reciben un código corto propio, para que cada una tenga su
-- serie y sus números no se intercalen.
DO $$
DECLARE
  dup record;
  candidate text;
  taken boolean;
BEGIN
  FOR dup IN
    SELECT t.id, t.numbering_prefix
    FROM templates t
    WHERE t.deleted_at IS NULL
      AND t.numbering_enabled
      AND t.numbering_prefix IS NOT NULL
      AND t.id <> (
        SELECT t2.id
        FROM templates t2
        WHERE t2.deleted_at IS NULL
          AND t2.numbering_enabled
          AND t2.numbering_prefix = t.numbering_prefix
        ORDER BY t2.created_at, t2.id
        LIMIT 1
      )
  LOOP
    candidate := upper(substr(replace(dup.id::text, '-', ''), 1, 4));
    taken := true;
    WHILE taken LOOP
      taken :=
        EXISTS (
          SELECT 1 FROM templates t
          WHERE t.deleted_at IS NULL AND t.numbering_prefix = candidate AND t.id <> dup.id
        )
        OR EXISTS (SELECT 1 FROM numbering_series s WHERE s.prefix = candidate);
      IF taken THEN
        candidate := candidate || substr(replace(dup.id::text, '-', ''), length(candidate) + 1, 1);
      END IF;
    END LOOP;

    INSERT INTO numbering_series (prefix) VALUES (candidate) ON CONFLICT (prefix) DO NOTHING;
    UPDATE templates
    SET numbering_prefix = candidate, numbering_prefix_auto = true
    WHERE id = dup.id;
  END LOOP;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "templates_numbering_prefix_unique_idx" ON "templates" USING btree ("numbering_prefix") WHERE "templates"."numbering_prefix" is not null and "templates"."deleted_at" is null;
