import { test, expect } from "@playwright/test";

test("register, add a manual provider, and track quota and credits", async ({ page }) => {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();

  await page.getByLabel("Name").fill("E2E User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Quota at a glance" })).toBeVisible();
  await expect(page.getByText("No providers connected yet")).toBeVisible();

  await page.getByRole("link", { name: /Add your first provider/ }).click();
  await expect(page).toHaveURL(/\/providers\/new$/);

  await page.getByRole("button", { name: /TokenHarbor/ }).click();
  await page.getByRole("button", { name: /Manual tracking/ }).click();
  await page.getByLabel("Display name").fill("Personal Harbor");
  await page.getByLabel("Plan").fill("Office Pass");
  await page.getByRole("button", { name: "Add provider", exact: true }).click();

  await expect(page).toHaveURL(/\/providers\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "Personal Harbor" })).toBeVisible();
  await expect(page.getByText("No live quota source")).toBeVisible();

  await page.getByLabel("Window").selectOption("weekly");
  await page.getByLabel("Unit").selectOption("usd");
  await page.getByLabel("Limit", { exact: true }).fill("50");
  await page.getByLabel("Used", { exact: true }).fill("20");
  await page.getByRole("button", { name: "Save quota snapshot" }).click();

  await expect(page.getByText("Manual quota snapshot saved")).toBeVisible();
  await expect(page.getByText("60%").first()).toBeVisible();

  await page.getByLabel("Amount").fill("42.50");
  await page.getByRole("button", { name: "Save balance snapshot" }).click();
  await expect(page.getByText("Manual balance snapshot saved")).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Personal Harbor" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Weekly quota used" })).toHaveAttribute(
    "aria-valuenow",
    "40",
  );
  await expect(page.getByText("40%").first()).toBeVisible();
  await expect(page.getByText("$42.50").first()).toBeVisible();
});

test("adds a manual balance from the provider page", async ({ page }) => {
  const email = `e2e-balance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

  await page.goto("/register");
  await page.getByLabel("Name").fill("Balance User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: /Add your first provider/ }).click();
  await page.getByRole("button", { name: /River AI/ }).click();
  await page.getByRole("button", { name: /Manual tracking/ }).click();
  await page.getByLabel("Display name").fill("River Wallet");
  await page.getByRole("button", { name: "Add provider", exact: true }).click();

  await expect(page).toHaveURL(/\/providers\/[0-9a-f-]+$/);
  await page.goto("/dashboard");
  await page.getByRole("heading", { name: "River Wallet" }).click();
  await expect(page).toHaveURL(/\/providers\/[0-9a-f-]+$/);

  await page.getByRole("button", { name: "Add balance" }).click();
  await page.getByLabel("Balance (USD)").fill("12.34");
  await page.getByRole("button", { name: "Save balance", exact: true }).click();
  await expect(page.getByText("$12.34").first()).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByText("$12.34").first()).toBeVisible();
});

test("records TokenHarbor Office Pass paid and free weekly usage", async ({ page }) => {
  const email = `e2e-office-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

  await page.goto("/register");
  await page.getByLabel("Name").fill("Office User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: /Add your first provider/ }).click();
  await page.getByRole("button", { name: /TokenHarbor/ }).click();
  await page.getByRole("button", { name: /Manual tracking/ }).click();
  await page.getByLabel("Display name").fill("Office Pass");
  await page.getByRole("button", { name: "Add provider", exact: true }).click();

  await expect(page).toHaveURL(/\/providers\/[0-9a-f-]+$/);
  await page.goto("/dashboard");
  await page.getByRole("heading", { name: "Office Pass" }).click();
  await expect(page).toHaveURL(/\/providers\/[0-9a-f-]+$/);

  await page.getByRole("button", { name: "Add weekly usage" }).click();
  await page.getByLabel("Paid models").fill("54");
  await page.getByLabel("Free models").fill("20");
  await page.getByRole("button", { name: "Save usage" }).click();
  await expect(page.getByText("54%").first()).toBeVisible();

  await page.goto("/dashboard");
  await expect(
    page.getByRole("progressbar", { name: "Paid models quota used" }),
  ).toHaveAttribute("aria-valuenow", "54");
  await expect(
    page.getByRole("progressbar", { name: "Free models quota used" }),
  ).toHaveAttribute("aria-valuenow", "20");
  await expect(page.getByText("54%").first()).toBeVisible();
  await expect(page.getByText("20%").first()).toBeVisible();
});

test("imports the latest wallet balance from a TokenHarbor billing CSV", async ({ page }) => {
  const email = `e2e-csv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const csv = `Date,Type,Source pool,Amount USD,Running balance USD,Status,Order ID,PayPal capture ID
2026-10-01T10:00:00Z,Recharge,Paid pool,"1,000.00","1,000.00",completed,ord_1,cap_1
2026-10-03T09:15:00Z,Usage,Paid pool,-12.50,"987.50",completed,ord_2,
2026-10-05T09:15:00Z,Recharge,Paid pool,50.00,"1,037.50",completed,ord_3,cap_3
`;

  await page.goto("/register");
  await page.getByLabel("Name").fill("CSV User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: /Add your first provider/ }).click();
  await page.getByRole("button", { name: /TokenHarbor/ }).click();
  await page.getByRole("button", { name: /Manual tracking/ }).click();
  await page.getByLabel("Display name").fill("CSV Harbor");
  await page.getByRole("button", { name: "Add provider", exact: true }).click();

  await expect(page).toHaveURL(/\/providers\/[0-9a-f-]+$/);
  await page.getByLabel("TokenHarbor billing CSV").setInputFiles({
    name: "ledger.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });

  await expect(page.getByText("Latest ledger balance")).toBeVisible();
  await expect(page.getByText("$1,037.50")).toBeVisible();
  await expect(page.getByText("3 transactions read")).toBeVisible();
  await expect(page.getByText(/Office Pass weekly usage is not included/)).toBeVisible();

  await page.getByRole("button", { name: "Save wallet balance" }).click();
  await expect(page.getByText("Choose CSV file")).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "CSV Harbor" })).toBeVisible();
  await expect(page.getByText("$1,037.50").first()).toBeVisible();
});

test("creates and revokes a usage gateway token", async ({ page }) => {
  const email = `e2e-gateway-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

  await page.goto("/register");
  await page.getByLabel("Name").fill("Gateway User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Usage gateway" })).toBeVisible();
  await expect(page.getByText("No gateway token yet")).toBeVisible();

  await page.getByRole("button", { name: "Create gateway token" }).click();
  await expect(page.getByText("Copy this token now. It is shown only once.")).toBeVisible();
  const token = (await page.locator("code").first().textContent())?.trim() ?? "";
  expect(token).toMatch(/^ttg_[A-Za-z0-9_-]{20,}$/);

  await page.reload();
  await expect(page.getByRole("button", { name: "Rotate token" })).toBeVisible();
  await expect(page.locator("code")).toHaveCount(0);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Revoke token" }).click();
  await expect(page.getByText("No gateway token yet")).toBeVisible();
});

test("rejects an invalid sign-in without leaking account state", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("Email or password is incorrect")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
