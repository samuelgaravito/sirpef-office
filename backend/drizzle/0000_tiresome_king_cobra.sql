CREATE TYPE "public"."doc_type" AS ENUM('memorandum', 'delivery_note', 'report', 'meeting_minutes', 'evaluation_plan', 'resume', 'letter', 'certificate', 'blank');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('draft', 'in_review', 'final', 'archived');--> statement-breakpoint
CREATE TYPE "public"."share_permission" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."version_kind" AS ENUM('auto', 'manual', 'ai', 'export', 'restore');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"anchor" jsonb NOT NULL,
	"body" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "designs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tokens" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_counters" (
	"scope" text NOT NULL,
	"year" integer NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "document_counters_scope_year_pk" PRIMARY KEY("scope","year")
);
--> statement-breakpoint
CREATE TABLE "document_shares" (
	"document_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"permission" "share_permission" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_shares_document_id_user_id_pk" PRIMARY KEY("document_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"kind" "version_kind" DEFAULT 'auto' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"template_id" uuid,
	"design_id" uuid,
	"title" text NOT NULL,
	"doc_type" "doc_type" DEFAULT 'blank' NOT NULL,
	"status" "document_status" DEFAULT 'draft' NOT NULL,
	"doc_number" text,
	"content" jsonb NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"design_id" uuid,
	"name" text NOT NULL,
	"doc_type" "doc_type" DEFAULT 'blank' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body" jsonb NOT NULL,
	"ai_instructions" text,
	"version" integer DEFAULT 1 NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "designs" ADD CONSTRAINT "designs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_design_id_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."designs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_design_id_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."designs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_entity_idx" ON "activities" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "comments_document_idx" ON "comments" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "designs_owner_idx" ON "designs" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_unique_idx" ON "document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "document_versions_document_idx" ON "document_versions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "documents_owner_idx" ON "documents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "documents_updated_idx" ON "documents" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "documents_template_idx" ON "documents" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "documents_design_idx" ON "documents" USING btree ("design_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_doc_number_idx" ON "documents" USING btree ("doc_number");--> statement-breakpoint
CREATE INDEX "documents_content_gin_idx" ON "documents" USING gin (to_tsvector('simple', "content"::text));--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_idx" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_versions_unique_idx" ON "template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "templates_owner_idx" ON "templates" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "templates_design_idx" ON "templates" USING btree ("design_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));