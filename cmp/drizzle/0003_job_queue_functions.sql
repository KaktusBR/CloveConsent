-- Custom migration: pg-boss's SQL functions are SECURITY INVOKER and reachable only through the schema's
-- USAGE grant, but Postgres gives EXECUTE on every new function to PUBLIC. Take it back, now and for
-- the functions later pg-boss migrations add, and grant only what the runtime roles' statements call:
-- job_now() (the insert of cmp_app; fetch, complete, fail and maintenance of cmp_system). The others
-- (create_queue, delete_queue, job_table_format, job_table_run, job_table_run_async) change the schema
-- and stay with the owner.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss FROM PUBLIC;--> statement-breakpoint
-- (a per-schema REVOKE cannot remove PUBLIC's default, so this covers every function the owner creates:
-- a function the runtime roles must call gets an explicit grant in its migration)
ALTER DEFAULT PRIVILEGES FOR ROLE "cmp_owner" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION pgboss.job_now() TO "cmp_app", "cmp_system";
