export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "REGISTRATION_DISABLED"
  | "INTERNAL_ERROR";

const statusByCode: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  REGISTRATION_DISABLED: 403,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = statusByCode[code];
    this.details = details;
  }
}

/** Strips credentials and request payloads from text that reaches logs. */
export function sanitizeMessage(input: unknown, maxLength = 300): string {
  const raw =
    input instanceof Error
      ? input.message
      : typeof input === "string"
        ? input
        : "Unexpected error";

  const redacted = raw
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/((?:api[_-]?key|token|secret|authorization)["'\s:=]+)[^\s"',;]+/gi, "$1[redacted]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]");

  return redacted.slice(0, maxLength);
}
