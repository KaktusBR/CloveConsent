CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"account_id" uuid,
	"action" text NOT NULL,
	"target" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "audit_log_account_created_idx" ON "audit_log" USING btree ("account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "audit_log_app_select" ON "audit_log" AS PERMISSIVE FOR SELECT TO "cmp_app" USING ("audit_log"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "audit_log_app_insert" ON "audit_log" AS PERMISSIVE FOR INSERT TO "cmp_app" WITH CHECK ("audit_log"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "audit_log_system_select" ON "audit_log" AS PERMISSIVE FOR SELECT TO "cmp_system" USING (true);--> statement-breakpoint
CREATE POLICY "audit_log_system_insert" ON "audit_log" AS PERMISSIVE FOR INSERT TO "cmp_system" WITH CHECK (true);--> statement-breakpoint
-- Added by hand (drizzle-kit emits neither): row-level security applies to the owner too, and the
-- runtime roles get only what the policies above need. No UPDATE, DELETE or TRUNCATE: append-only.
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO "cmp_app", "cmp_system";--> statement-breakpoint
GRANT SELECT, INSERT ON "audit_log" TO "cmp_app", "cmp_system";
