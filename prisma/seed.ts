import "../src/bootstrap-env";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";

/**
 * Optional operator seed. It never inserts demo quotas or fake balances.
 * Set SEED_EMAIL and SEED_PASSWORD to create (or update) one account.
 */
async function main(): Promise<void> {
  const email = process.env.SEED_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_PASSWORD;

  if (!email || !password) {
    console.log(
      "No seed user created. Set SEED_EMAIL and SEED_PASSWORD to provision an account. " +
        "Demo quota fixtures are intentionally not loaded into the database.",
    );
    return;
  }

  if (password.length < 10) {
    throw new Error("SEED_PASSWORD must be at least 10 characters");
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, passwordHash, displayName: process.env.SEED_NAME || null },
    update: { passwordHash },
    select: { id: true, email: true },
  });

  console.log(`Seeded user ${user.email} (${user.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
