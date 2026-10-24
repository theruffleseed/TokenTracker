import { prisma } from "./db";
import { hashPassword, verifyPassword } from "./password";
import { AppError } from "./errors";
import { recordAudit } from "./audit";

export async function updateSettings(
  userId: string,
  input: {
    displayName?: string | null;
    timezone?: string;
    refreshIntervalMin?: number;
    quotaRetentionDays?: number;
    usageRetentionDays?: number;
    auditRetentionDays?: number;
  },
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.displayName !== undefined ? { displayName: input.displayName || null } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.refreshIntervalMin !== undefined
        ? { refreshIntervalMin: input.refreshIntervalMin }
        : {}),
      ...(input.quotaRetentionDays !== undefined
        ? { quotaRetentionDays: input.quotaRetentionDays }
        : {}),
      ...(input.usageRetentionDays !== undefined
        ? { usageRetentionDays: input.usageRetentionDays }
        : {}),
      ...(input.auditRetentionDays !== undefined
        ? { auditRetentionDays: input.auditRetentionDays }
        : {}),
    },
  });

  await recordAudit({
    userId,
    eventType: "SETTINGS_UPDATED",
    metadata: { fields: Object.keys(input) },
  });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) throw new AppError("UNAUTHORIZED", "Account not found");

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) throw new AppError("FORBIDDEN", "Current password is incorrect");

  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw new AppError("BAD_REQUEST", "Choose a password you have not used here before");
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  await recordAudit({ userId, eventType: "SETTINGS_UPDATED", metadata: { kind: "password" } });
}
