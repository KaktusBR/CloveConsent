CREATE TABLE "entitlements" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"plan_id" text,
	"paid_until" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entitlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name_key" text NOT NULL,
	"limits" jsonb NOT NULL,
	CONSTRAINT "plans_id_check" CHECK ("plans"."id" ~ '^[a-z][a-z0-9-]*$'),
	CONSTRAINT "plans_limits_check" CHECK (jsonb_typeof("plans"."limits") = 'object' and "plans"."limits" ?& array['sites', 'languages', 'scansPerMonth', 'recordsPerMonth', 'members'])
);
--> statement-breakpoint
ALTER TABLE "auth_session" ADD COLUMN "impersonated_by" uuid;--> statement-breakpoint
ALTER TABLE "auth_user" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "auth_user" ADD COLUMN "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "auth_user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "auth_user" ADD COLUMN "ban_expires" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_account_id_auth_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_impersonated_by_auth_user_id_fk" FOREIGN KEY ("impersonated_by") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "entitlements_app_select" ON "entitlements" AS PERMISSIVE FOR SELECT TO "cmp_app" USING ("entitlements"."account_id" = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "entitlements_system_select" ON "entitlements" AS PERMISSIVE FOR SELECT TO "cmp_system" USING (true);--> statement-breakpoint
CREATE POLICY "entitlements_system_insert" ON "entitlements" AS PERMISSIVE FOR INSERT TO "cmp_system" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "entitlements_system_update" ON "entitlements" AS PERMISSIVE FOR UPDATE TO "cmp_system" USING (true) WITH CHECK (true);--> statement-breakpoint
-- Added by hand. entitlements is tenant data (src/server/data/schema/plans.ts): row-level security forced
-- on the owner too. The app role reads its current account's row (the request gate); the system role
-- reads and writes any row (the super-admin console, through asSystem). No DELETE, no TRUNCATE.
ALTER TABLE "entitlements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "entitlements" TO "cmp_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "entitlements" TO "cmp_system";--> statement-breakpoint
-- Added by hand. plans is reference data, the same for every account (no account_id, no row-level
-- security, test/db/rls.test.ts): read by the app and system roles, changed by migrations only.
GRANT SELECT ON "plans" TO "cmp_app", "cmp_system";--> statement-breakpoint
-- The plans and their limits (a later plan may change them by migration; prices live with the payment
-- provider). `name_key` is the catalog key of the plan's name.
INSERT INTO "plans" ("id", "name_key", "limits") VALUES
  ('starter', 'plan_starter', '{"sites": 1, "languages": 2, "scansPerMonth": 10, "recordsPerMonth": 10000, "members": 3}'),
  ('business', 'plan_business', '{"sites": 5, "languages": 5, "scansPerMonth": 50, "recordsPerMonth": 100000, "members": 10}'),
  ('agency', 'plan_agency', '{"sites": 25, "languages": 24, "scansPerMonth": 250, "recordsPerMonth": 1000000, "members": 25}');--> statement-breakpoint
-- Added by hand. The super-admin console (asSystem, cmp_system) lists and searches accounts and shows
-- their members by name and address: SELECT of exactly those columns, nothing else on identity tables.
GRANT SELECT ("id", "name", "created_at") ON "auth_account" TO "cmp_system";--> statement-breakpoint
GRANT SELECT ("account_id", "user_id", "role") ON "auth_account_member" TO "cmp_system";--> statement-breakpoint
GRANT SELECT ("id", "name", "email") ON "auth_user" TO "cmp_system";
