import { execFileSync } from "node:child_process";

export default function globalSetup(): void {
  const databaseUrl =
    process.env.TEST_DATABASE_URL ??
    "postgresql://tokentracker:tokentracker@localhost:5433/tokentracker_test?schema=public";

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
}
