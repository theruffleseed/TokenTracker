import "../bootstrap-env";
import { prisma } from "../lib/db";
import { claimNextJob, enqueueDueRefreshes, executeJob, recoverStuckJobs } from "../lib/refresh";
import { purgeExpiredDataWithLock } from "../lib/retention";

/**
 * Process all currently due jobs once, then exit. Useful for cron platforms
 * that do not keep a long-running worker process.
 */
async function main(): Promise<void> {
  await recoverStuckJobs();
  const enqueued = await enqueueDueRefreshes();
  console.log(`[worker:once] enqueued ${enqueued} job(s)`);

  let processed = 0;
  while (processed < 50) {
    const job = await claimNextJob();
    if (!job) break;
    const outcome = await executeJob(job);
    processed += 1;
    console.log(`[worker:once] ${job.id} -> ${outcome.status}`);
  }

  const purge = await purgeExpiredDataWithLock();
  if (purge) console.log("[worker:once] retention", purge);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("[worker:once] fatal", error);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
