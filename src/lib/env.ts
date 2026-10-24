import { z } from "zod";

const booleanish = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((value) => value === true || value === "true" || value === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  CREDENTIAL_ENCRYPTION_KEY: z
    .string()
    .min(1, "CREDENTIAL_ENCRYPTION_KEY is required")
    .refine((value) => {
      try {
        return Buffer.from(value, "base64").length === 32;
      } catch {
        return false;
      }
    }, "CREDENTIAL_ENCRYPTION_KEY must be 32 bytes encoded as base64"),
  CREDENTIAL_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_COOKIE_SECURE: booleanish.default(false),
  ALLOW_REGISTRATION: booleanish.default(true),
  REFRESH_DEFAULT_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  ENABLE_EXPERIMENTAL_ADAPTERS: booleanish.default(false),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(15000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  INLINE_REFRESH: booleanish.default(true),
  PROVIDER_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  /** Intended for isolated test environments only; never enable in production. */
  RATE_LIMIT_DISABLED: booleanish.default(false),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Reads and validates environment variables lazily so builds do not require
 * runtime secrets, while misconfiguration still fails fast at first use.
 */
export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  cached = parsed.data;
  return cached;
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === "production";
}

/** Test helper: forget the cached environment after mutating process.env. */
export function resetEnvCacheForTests(): void {
  cached = null;
}
