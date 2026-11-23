-- Better Auth's admin plugin is no longer used (impersonation is the app's own, server-only endpoints:
-- src/server/auth/account-endpoints.ts): its user fields go. A super-admin is an address in
-- SUPER_ADMIN_EMAILS, never a role in the database.
ALTER TABLE "auth_user" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "auth_user" DROP COLUMN "banned";--> statement-breakpoint
ALTER TABLE "auth_user" DROP COLUMN "ban_reason";--> statement-breakpoint
ALTER TABLE "auth_user" DROP COLUMN "ban_expires";