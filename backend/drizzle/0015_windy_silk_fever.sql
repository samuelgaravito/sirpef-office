ALTER TABLE "designs" ADD COLUMN "base_design_id" uuid;--> statement-breakpoint
ALTER TABLE "designs" ADD COLUMN "is_current" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "designs" ADD CONSTRAINT "designs_base_design_id_designs_id_fk" FOREIGN KEY ("base_design_id") REFERENCES "public"."designs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "designs_base_design_idx" ON "designs" USING btree ("base_design_id");--> statement-breakpoint
CREATE UNIQUE INDEX "designs_current_variant_idx" ON "designs" USING btree ("base_design_id") WHERE "designs"."is_current";--> statement-breakpoint
ALTER TABLE "designs" ADD CONSTRAINT "designs_current_needs_base_check" CHECK ("designs"."is_current" = false or "designs"."base_design_id" is not null);