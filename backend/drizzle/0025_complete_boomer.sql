CREATE TABLE "ai_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"ollama_version" text,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gpu" boolean DEFAULT false NOT NULL,
	"vram_gb" real,
	"tokens_per_second" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_nodes" ADD CONSTRAINT "ai_nodes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_nodes_token_unique_idx" ON "ai_nodes" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ai_nodes_user_idx" ON "ai_nodes" USING btree ("user_id");