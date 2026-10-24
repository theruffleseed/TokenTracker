import { execFileSync } from "node:child_process";

/**
 * Applies migrations to the test database before the integration suite runs.
 * The database is created by docker/init-test-db.sql on first container boot.
 */
export default function globalSetup(): void {
  const databaseUrl =
    process.env.TEST_DATABASE_URL ??
    "postgresql://tokentracker:tokentracker@localhost:5433/tokentracker_test?schema=public";

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
}
