import "../bootstrap-env";
import { getEnv } from "../lib/env";
import { prisma } from "../lib/db";
import {
  claimNextJob,
  enqueueDueRefreshes,
  executeJob,
  recoverStuckJobs,
} from "../lib/refresh";
import { purgeExpiredDataWithLock } from "../lib/retention";

const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

let running = true;
let lastRetentionRun = 0;

function log(message: string, extra?: unknown): void {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[worker ${new Date().toISOString()}] ${message}${suffix}`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function schedulerLoop(): Promise<void> {
  const interval = getEnv().WORKER_POLL_INTERVAL_MS;

  while (running) {
    try {
      const enqueued = await enqueueDueRefreshes();
      if (enqueued > 0) log("enqueued due refreshes", { count: enqueued });
    } catch (error) {
      log("scheduler error", { error: error instanceof Error ? error.message : "unknown" });
    }

    await sleep(interval);
  }
}

async function retentionLoop(): Promise<void> {
  // Give the app a moment to finish starting, then run every six hours.
  await sleep(10_000);
  while (running) {
    if (Date.now() - lastRetentionRun > RETENTION_INTERVAL_MS) {
      lastRetentionRun = Date.now();
      try {
        const result = await purgeExpiredDataWithLock();
        if (result) log("retention purge complete", result);
      } catch (error) {
        log("retention error", { error: error instanceof Error ? error.message : "unknown" });
      }
    }
    await sleep(60_000);
  }
}

async function workerLoop(lane: number): Promise<void> {
  const poll = getEnv().WORKER_POLL_INTERVAL_MS;

  while (running) {
    try {
      const job = await claimNextJob();
      if (!job) {
        await sleep(poll);
        continue;
      }

      const outcome = await executeJob(job);
      log("refresh finished", { lane, jobId: job.id, outcome: outcome.status });
    } catch (error) {
      log("worker loop error", {
        lane,
        error: error instanceof Error ? error.message : "unknown",
      });
      await sleep(poll);
    }
  }
}

async function main(): Promise<void> {
  const env = getEnv();
  log("starting", {
    concurrency: env.WORKER_CONCURRENCY,
    pollMs: env.WORKER_POLL_INTERVAL_MS,
    experimentalAdapters: env.ENABLE_EXPERIMENTAL_ADAPTERS,
  });

  await recoverStuckJobs().catch(() => 0);

  const shutdown = async (signal: string) => {
    if (!running) return;
    running = false;
    log("shutting down", { signal });
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await Promise.all([
    schedulerLoop(),
    retentionLoop(),
    ...Array.from({ length: env.WORKER_CONCURRENCY }, (_, index) => workerLoop(index + 1)),
  ]);
}

main().catch(async (error) => {
  console.error("[worker] fatal", error);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
