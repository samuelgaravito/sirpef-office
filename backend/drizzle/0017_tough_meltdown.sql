CREATE TABLE "template_shares" (
	"template_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"permission" "share_permission" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_shares_template_id_user_id_pk" PRIMARY KEY("template_id","user_id")
);
--> statement-breakpoint
DROP INDEX "documents_doc_number_idx";--> statement-breakpoint
ALTER TABLE "template_shares" ADD CONSTRAINT "template_shares_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_shares" ADD CONSTRAINT "template_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "template_shares_user_idx" ON "template_shares" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_doc_number_idx" ON "documents" USING btree ("doc_number") WHERE "documents"."deleted_at" IS NULL;