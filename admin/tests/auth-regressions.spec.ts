import { test, expect } from "@playwright/test";
import { fixture, login } from "./fixture";

test("new authenticator enrollment renders the SDK QR image", async ({
  page,
  context,
}) => {
  await fixture(context, { mfa: true, enrollment: true });
  await login(page);
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  const qr = page.getByAltText("Scan with your authenticator app");
  await expect(qr).toBeVisible();
  await expect
    .poll(() => qr.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
});
