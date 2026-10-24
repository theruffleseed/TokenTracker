import type { AuditEventType, Prisma } from "@prisma/client";
import { prisma } from "./db";

const SECRET_KEY_PATTERN = /(token|secret|password|credential|authorization|api[-_]?key|cookie)/i;

/**
 * Recursively removes values that look like credentials and truncates strings.
 * Audit metadata must never contain a raw provider key or session token.
 */
export function redactMetadata(value: unknown, depth = 0): Prisma.InputJsonValue {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) {
    return null as unknown as Prisma.InputJsonValue;
  }
  if (typeof value === "string") return value.slice(0, 200);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactMetadata(item, depth + 1));

  if (typeof value === "object") {
    const out: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = redactMetadata(nested, depth + 1);
      }
    }
    return out;
  }

  return String(value).slice(0, 200);
}

export async function recordAudit(input: {
  userId: string;
  eventType: AuditEventType;
  providerAccountId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditEvent
    .create({
      data: {
        userId: input.userId,
        eventType: input.eventType,
        providerAccountId: input.providerAccountId ?? null,
        metadata: redactMetadata(input.metadata ?? {}),
      },
    })
    .catch((error) => {
      // Auditing must never break the user-facing operation.
      console.warn("[audit] failed to write event", sanitizeForLog(error));
    });
}

function sanitizeForLog(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : "unknown";
}
