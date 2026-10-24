import { AdapterError } from "./types";

export interface JsonResponse {
  status: number;
  headers: Headers;
  data: unknown;
  url: string;
  attempts: number;
}

export interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** Extra attempts after the first request. Capped at 2. */
  retries?: number;
  fetchImpl?: typeof fetch;
  /** Injectable sleep for tests. */
  sleepImpl?: (ms: number) => Promise<void>;
}

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RETRIES = 2;

const defaultSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read-only JSON client with a hard timeout and bounded retries for transient
 * failures. Authentication errors are never retried, and request headers are
 * never included in error messages.
 */
export async function requestJson(url: string, options: RequestOptions = {}): Promise<JsonResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = 1 + Math.min(options.retries ?? 1, MAX_RETRIES);
  const sleep = options.sleepImpl ?? defaultSleep;
  let lastError: AdapterError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

    try {
      const response = await fetchImpl(url, {
        method: options.method ?? "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "TokenTracker/0.1 (+https://github.com/theruffleseed/TokenTracker)",
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        redirect: "follow",
        cache: "no-store",
      });

      const text = await readLimitedBody(response);
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));

      if (response.status === 401 || response.status === 403) {
        throw new AdapterError(
          response.status === 401 ? "INVALID_CREDENTIALS" : "FORBIDDEN",
          response.status === 401
            ? "The provider rejected this API key"
            : "This API key is not allowed to read usage",
          { httpStatus: response.status, diagnostics: [`HTTP ${response.status}`] },
        );
      }

      if (response.status === 429) {
        lastError = new AdapterError("RATE_LIMITED", "The provider rate-limited the request", {
          httpStatus: 429,
          retryAfterSeconds: retryAfter ?? 60,
        });
        if (attempt < maxAttempts) {
          await sleep(Math.min((retryAfter ?? 2) * 1000, 5_000));
          continue;
        }
        throw lastError;
      }

      if (response.status >= 500) {
        lastError = new AdapterError("PROVIDER_UNAVAILABLE", "The provider is temporarily unavailable", {
          httpStatus: response.status,
          retryAfterSeconds: retryAfter,
        });
        if (attempt < maxAttempts) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw lastError;
      }

      if (response.status === 204 || text.trim() === "") {
        return { status: response.status, headers: response.headers, data: null, url, attempts: attempt };
      }

      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new AdapterError("MALFORMED_RESPONSE", "The provider returned a non-JSON response", {
          httpStatus: response.status,
          diagnostics: [`HTTP ${response.status}`, "invalid JSON"],
        });
      }

      if (response.status >= 400) {
        throw new AdapterError(
          "PROVIDER_ERROR",
          `The provider rejected the request (HTTP ${response.status})`,
          { httpStatus: response.status, diagnostics: [`HTTP ${response.status}`] },
        );
      }

      return { status: response.status, headers: response.headers, data, url, attempts: attempt };
    } catch (error) {
      if (error instanceof AdapterError) {
        if (error.code !== "RATE_LIMITED" && error.code !== "PROVIDER_UNAVAILABLE") throw error;
        lastError = error;
      } else if (isAbortError(error)) {
        lastError = new AdapterError("TIMEOUT", "The provider did not respond in time", {
          cause: error,
        });
      } else {
        lastError = new AdapterError("NETWORK_ERROR", "Could not reach the provider", {
          cause: error,
        });
      }

      if (attempt < maxAttempts) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new AdapterError("UNKNOWN", "The provider request failed");
}

async function readLimitedBody(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new AdapterError("MALFORMED_RESPONSE", "The provider response was unexpectedly large");
  }

  const text = await response.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new AdapterError("MALFORMED_RESPONSE", "The provider response was unexpectedly large");
  }
  return text;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

function backoffMs(attempt: number): number {
  return 400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 150);
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}
