-- Custom migration: the auth.cleanup queue and what its job (run by the worker as cmp_system) may do.
-- Expired sessions and one-time challenges, and finished rate-limit windows, hold client addresses and
-- user agents (personal data) for no purpose: the job deletes them every 15 minutes
-- (src/server/data/auth-cleanup.ts). cmp_system may read only the column each delete filters on.
-- The worker runs pg-boss's scheduler, which keeps its own queue and calls create_queue for it at every
-- start (an INSERT ... ON CONFLICT DO NOTHING into pgboss.queue, which cmp_system may do directly anyway).
-- The queue is created here; cmp_system gets EXECUTE on create_queue for that call. A queue with its own
-- table (partition) needs DDL cmp_system does not have, so it still cannot change the schema.
SELECT pgboss.create_queue('__pgboss__send-it', '{"policy":"standard"}'::jsonb);--> statement-breakpoint
GRANT EXECUTE ON FUNCTION pgboss.create_queue(text, jsonb) TO "cmp_system";--> statement-breakpoint
SELECT pgboss.create_queue('auth.cleanup', '{"policy":"standard","retryLimit":2,"retryDelay":60,"expireInSeconds":300,"retentionSeconds":3600,"deleteAfterSeconds":86400}'::jsonb);--> statement-breakpoint
GRANT SELECT ("expires_at"), DELETE ON "auth_session" TO "cmp_system";--> statement-breakpoint
GRANT SELECT ("expires_at"), DELETE ON "auth_verification" TO "cmp_system";--> statement-breakpoint
GRANT SELECT ("last_request"), DELETE ON "auth_rate_limit" TO "cmp_system";
