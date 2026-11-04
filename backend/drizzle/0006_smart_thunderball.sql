ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sva_uuid" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cedula" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_provider" text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_sva_sync_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "users_sva_uuid_idx" ON "users" USING btree ("sva_uuid") WHERE "users"."sva_uuid" is not null;--> statement-breakpoint
CREATE INDEX "users_active_idx" ON "users" USING btree ("is_active");