// Better Auth answers failures with an English message and a code. People see only our translated text,
// chosen by code (and by status for the rate limiter, which sends no code); anything unknown gets the
// generic text, never the library's.
import { m } from '../paraglide/messages.js'

type Message = () => string

const BY_CODE: Readonly<Record<string, Message>> = {
  INVALID_EMAIL_OR_PASSWORD: m.auth_error_invalid_credentials,
  INVALID_PASSWORD: m.auth_error_wrong_password,
  INVALID_EMAIL: m.auth_error_invalid_email,
  EMAIL_NOT_VERIFIED: m.auth_error_email_not_verified,
  PASSWORD_TOO_SHORT: m.auth_error_password_length,
  PASSWORD_TOO_LONG: m.auth_error_password_length,
  PASSWORD_COMPROMISED: m.auth_error_password_compromised,
  USER_ALREADY_EXISTS: m.auth_error_user_exists,
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: m.auth_error_user_exists,
  INVALID_TOKEN: m.auth_error_link_invalid,
  TOKEN_EXPIRED: m.auth_error_link_invalid,
  INVALID_CODE: m.auth_error_invalid_code,
  INVALID_BACKUP_CODE: m.auth_error_invalid_code,
  INVALID_TWO_FACTOR_COOKIE: m.auth_error_challenge_expired,
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: m.auth_error_challenge_expired,
  ACCOUNT_TEMPORARILY_LOCKED: m.auth_error_locked,
  UNAUTHORIZED: m.auth_error_session_expired,
  SESSION_EXPIRED: m.auth_error_session_expired,
  SESSION_NOT_FRESH: m.auth_error_session_expired,
  AUTH_CANCELLED: m.auth_error_passkey_cancelled,
  REGISTRATION_CANCELLED: m.auth_error_passkey_cancelled,
  AUTHENTICATION_FAILED: m.auth_error_passkey_failed,
  PASSKEY_NOT_FOUND: m.auth_error_passkey_failed,
  CHALLENGE_NOT_FOUND: m.auth_error_passkey_failed,
  FAILED_TO_VERIFY_REGISTRATION: m.auth_error_passkey_failed,
  PREVIOUSLY_REGISTERED: m.auth_error_passkey_exists,
}

/** The translated message for a failed auth call, in the page's language. */
export function authErrorMessage(error: { code?: string | undefined; status?: number | undefined } | null | undefined): string {
  // the code first: some refusals with a code of their own are 429s too (the second-step lockout)
  const message = error?.code !== undefined && Object.hasOwn(BY_CODE, error.code) ? BY_CODE[error.code] : undefined
  if (message) return message()
  return error?.status === 429 ? m.auth_error_rate_limited() : m.auth_error_generic()
}
