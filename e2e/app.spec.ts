import { test, expect } from "@playwright/test";

test("register, add a manual provider, and track a quota window", async ({ page }) => {
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

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Personal Harbor" })).toBeVisible();
  await expect(page.getByText("60%").first()).toBeVisible();
  await expect(page.getByText("Manual", { exact: true }).first()).toBeVisible();
});

test("rejects an invalid sign-in without leaking account state", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("Email or password is incorrect")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
