// The super-admins of the e2e server (playwright.config.ts lists them in SUPER_ADMIN_EMAILS): one per spec
// file, as spec files run in parallel.
export const SUPER_ADMIN_EMAIL = 'e2e-super-admin@example.test'
/** e2e/journey.spec.ts's. */
export const JOURNEY_SUPER_ADMIN_EMAIL = 'e2e-journey-super-admin@example.test'
