CREATE TABLE "auth_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_account_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "auth_account_invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_account_invitation_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "auth_account_invitation_role_check" CHECK ("auth_account_invitation"."role" in ('owner', 'admin', 'editor', 'viewer')),
	CONSTRAINT "auth_account_invitation_status_check" CHECK ("auth_account_invitation"."status" in ('pending', 'accepted', 'rejected', 'canceled'))
);
--> statement-breakpoint
CREATE TABLE "auth_account_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_account_member_account_user_unique" UNIQUE("account_id","user_id"),
	CONSTRAINT "auth_account_member_role_check" CHECK ("auth_account_member"."role" in ('owner', 'admin', 'editor', 'viewer'))
);
--> statement-breakpoint
ALTER TABLE "auth_session" ADD COLUMN "active_account_id" uuid;--> statement-breakpoint
ALTER TABLE "auth_account_invitation" ADD CONSTRAINT "auth_account_invitation_account_id_auth_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_account_invitation" ADD CONSTRAINT "auth_account_invitation_inviter_id_auth_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_account_member" ADD CONSTRAINT "auth_account_member_account_id_auth_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_account_member" ADD CONSTRAINT "auth_account_member_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_account_invitation_account_id_idx" ON "auth_account_invitation" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "auth_account_invitation_email_idx" ON "auth_account_invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "auth_account_member_user_id_idx" ON "auth_account_member" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_account_id_auth_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_active_account_id_auth_account_id_fk" FOREIGN KEY ("active_account_id") REFERENCES "public"."auth_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Added by hand. The organization plugin's tables are identity tables like the other auth_* tables
-- (ruling R2): no row-level security, by decision; they say who belongs to which account, and every
-- request checks them (src/server/data/accounts.ts). Only the app role reaches them, with exactly what the
-- app does (test/db/rls.test.ts checks these grants): accounts are created and renamed, never deleted (and
-- locked FOR NO KEY UPDATE by the owner trigger below, which needs UPDATE); members are added, changed
-- and removed; invitations are created and change status, never deleted. Nothing for cmp_system.
GRANT SELECT, INSERT, UPDATE ON "auth_account", "auth_account_invitation" TO "cmp_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_account_member" TO "cmp_app";--> statement-breakpoint
-- Added by hand. An account always keeps an owner: a change of a member's role or a removal that would
-- leave its account without one fails (check_violation, constraint auth_account_keeps_an_owner), from
-- any code path. Only a change to an owner's row is checked. The account row is locked first, so concurrent changes of one account's members run one
-- after the other and each count sees the others' committed changes (two owners demoting each other at
-- once cannot both succeed). When the account itself is being deleted its members go with it.
CREATE FUNCTION "auth_account_keeps_an_owner"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM 1 FROM public.auth_account WHERE id = OLD.account_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auth_account_member WHERE account_id = OLD.account_id AND role = 'owner') THEN
    RAISE EXCEPTION 'an account keeps at least one owner' USING ERRCODE = 'check_violation', CONSTRAINT = 'auth_account_keeps_an_owner';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "auth_account_keeps_an_owner" AFTER UPDATE OF "role", "account_id" OR DELETE ON "auth_account_member"
  FOR EACH ROW WHEN (OLD."role" = 'owner') EXECUTE FUNCTION "auth_account_keeps_an_owner"();
