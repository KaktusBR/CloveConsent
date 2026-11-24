// Where the e2e server writes its log (stdout and stderr; playwright.config.ts): e2e/isolation.spec.ts reads
// the lines of its own requests (by X-Request-Id) to check that nothing of another account was logged.
export const SERVER_LOG = 'e2e-server.log'
