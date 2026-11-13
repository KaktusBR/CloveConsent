-- Custom migration: the runtime roles insert only the event columns; id and created_at always come from
-- their defaults, so no row can be backdated or given a chosen id.
REVOKE INSERT ON "audit_log" FROM "cmp_app", "cmp_system";--> statement-breakpoint
GRANT INSERT ("actor_user_id", "account_id", "action", "target", "meta") ON "audit_log" TO "cmp_app", "cmp_system";
