-- Account and invitation limits (ruling R22, LIMITS in src/server/data/accounts.ts): who created an
-- account, and an index for the invitations a person sent in the last day.
ALTER TABLE "auth_account" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_account_invitation_inviter_created_idx" ON "auth_account_invitation" USING btree ("inviter_id","created_at");