import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createAccount } from "@/lib/accounts";
import {
  claimJobById,
  claimNextJob,
  enqueueDueRefreshes,
  enqueueRefresh,
  executeJob,
  requestRefresh,
} from "@/lib/refresh";
import { AdapterError } from "@/lib/providers/types";
import { createTestUser, resetDatabase } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

describe("refresh job queue (database)", () => {
  it("allows only one active job per account", async () => {
    const user = await createTestUser();
    const account = await createAccount({
      userId: user.id,
      provider: "TOKENHARBOR",
      displayName: "Live Harbor",
      authMode: "LIVE",
      credential: "thk_live_test_key_value",
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => enqueueRefresh(account.id, "MANUAL")),
    );

    const ids = new Set(results.map((result) => result.job.id));
    expect(ids.size).toBe(1);
    expect(results.filter((result) => result.existing).length).toBe(4);

    const claimed = await claimJobById(results[0]!.job.id);
    expect(claimed?.status).toBe("RUNNING");
    expect(claimed?.attemptCount).toBe(1);

    // A second claim of the same job is a no-op.
    expect(await claimJobById(results[0]!.job.id)).toBeNull();
  });

  it("schedules only due, active live accounts and is idempotent", async () => {
    const user = await createTestUser();
    const live = await createAccount({
      userId: user.id,
      provider: "TOKENHARBOR",
      displayName: "Live",
      authMode: "LIVE",
      credential: "thk_live_test_key_value",
    });
    const manual = await createAccount({
      userId: user.id,
      provider: "RIVER_AI",
      displayName: "Manual",
      authMode: "MANUAL",
    });

    await prisma.providerAccount.update({
      where: { id: live.id },
      data: { nextRefreshAt: new Date(Date.now() - 60_000) },
    });

    expect(await enqueueDueRefreshes()).toBe(1);
    expect(await enqueueDueRefreshes()).toBe(0);

    const jobs = await prisma.refreshJob.findMany();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.providerAccountId).toBe(live.id);
    expect(jobs[0]?.trigger).toBe("SCHEDULED");

    // Manual accounts never receive scheduled jobs.
    expect(jobs.some((job) => job.providerAccountId === manual.id)).toBe(false);
  });

  it("skips manual connections instead of calling a provider", async () => {
    const user = await createTestUser();
    const account = await createAccount({
      userId: user.id,
      provider: "TOKENHARBOR",
      displayName: "Manual",
      authMode: "MANUAL",
    });

    const { job } = await enqueueRefresh(account.id, "MANUAL");
    const claimed = await claimJobById(job.id);
    expect(claimed).not.toBeNull();

    const outcome = await executeJob(claimed!);
    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") expect(outcome.reason).toContain("Manual");

    const finished = await prisma.refreshJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(finished.status).toBe("SKIPPED");
    expect(finished.errorCode).toBe("MANUAL_MODE");
  });

  it("refuses live refresh requests for manual connections", async () => {
    const user = await createTestUser();
    const account = await createAccount({
      userId: user.id,
      provider: "COMMANDCODE",
      displayName: "Manual Command",
      authMode: "MANUAL",
    });

    await expect(requestRefresh(user.id, account.id)).rejects.toBeInstanceOf(AdapterError);
  });

  it("claims jobs atomically for concurrent workers", async () => {
    const user = await createTestUser();
    const account = await createAccount({
      userId: user.id,
      provider: "TOKENHARBOR",
      displayName: "Live",
      authMode: "LIVE",
      credential: "thk_live_test_key_value",
    });
    await enqueueRefresh(account.id, "MANUAL");

    const [first, second] = await Promise.all([claimNextJob(), claimNextJob()]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });
});
