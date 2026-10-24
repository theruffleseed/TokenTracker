import { prisma } from "@/lib/db";

/** Clears every application table while preserving migrations. */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditEvent",
      "RefreshJob",
      "UsageRecord",
      "CreditSnapshot",
      "QuotaSnapshot",
      "ProviderAccount",
      "Session",
      "User"
    RESTART IDENTITY CASCADE
  `);
}

export async function createTestUser(email = `user-${crypto.randomUUID()}@example.com`) {
  return prisma.user.create({
    data: {
      email,
      passwordHash: "scrypt$16384$8$1$placeholder$placeholder",
      displayName: "Test User",
    },
  });
}
