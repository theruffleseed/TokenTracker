/**
 * Deterministic test environment. These values are not secrets and are only
 * used by Vitest. The credential key is 32 bytes of 0x01, base64-encoded.
 */
Object.assign(process.env, { NODE_ENV: "test" });
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://tokentracker:tokentracker@localhost:5433/tokentracker_test?schema=public";
process.env.AUTH_SECRET = "test-auth-secret-value-that-is-long-enough-000000";
process.env.CREDENTIAL_ENCRYPTION_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
process.env.CREDENTIAL_ENCRYPTION_KEY_VERSION = "1";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_COOKIE_SECURE = "false";
process.env.ALLOW_REGISTRATION = "true";
process.env.REFRESH_DEFAULT_INTERVAL_MINUTES = "30";
process.env.ENABLE_EXPERIMENTAL_ADAPTERS = "true";
process.env.WORKER_POLL_INTERVAL_MS = "1000";
process.env.INLINE_REFRESH = "false";
process.env.PROVIDER_HTTP_TIMEOUT_MS = "2000";
