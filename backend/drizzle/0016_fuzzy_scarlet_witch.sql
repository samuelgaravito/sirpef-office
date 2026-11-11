ALTER TABLE "designs" DROP CONSTRAINT "designs_current_needs_base_check";--> statement-breakpoint
ALTER TABLE "designs" DROP CONSTRAINT "designs_base_design_id_designs_id_fk";
--> statement-breakpoint
DROP INDEX "designs_base_design_idx";--> statement-breakpoint
DROP INDEX "designs_current_variant_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "designs_current_unique_idx" ON "designs" USING btree ("owner_id") WHERE "designs"."is_current";--> statement-breakpoint
ALTER TABLE "designs" DROP COLUMN "base_design_id";