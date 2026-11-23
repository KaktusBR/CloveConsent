-- A super-admin's view ends once (ruling R25): at most one admin.impersonation_stop row per view, so
-- parallel or replayed attempts to end it record nothing and change nothing (src/server/data/admin.ts).
CREATE UNIQUE INDEX "audit_log_impersonation_ends_once" ON "audit_log" USING btree (("meta"->>'impersonation')) WHERE "audit_log"."action" = 'admin.impersonation_stop';