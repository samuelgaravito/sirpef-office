ALTER TABLE "refresh_tokens" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "auth_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "refresh_tokens_device_idx" ON "refresh_tokens" USING btree ("device_id");