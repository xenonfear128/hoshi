import { test, expect } from "@playwright/test";
import { fixture } from "./fixtures";
for (const [width, height] of [
  [393, 659],
  [1280, 746],
]) {
  test(`bounded scroll ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await fixture(page);
    await page.route("**/api/hosts", (r) =>
      r.fulfill({
        json: Array.from({ length: 30 }, (_, i) => ({
          id: String(i),
          name: "Host " + i,
          address: "example.com",
          username: "root",
          port: 22,
          authType: "password",
        })),
      }),
    );
    await page.reload();
    await expect(page.locator(".host-card")).toHaveCount(30);
    const root = page.locator("#root");
    await root.evaluate((e) => e.scrollTo(0, e.scrollHeight));
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, 5000);
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    expect(await root.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
    const bottom = await page.locator(".home-foot").boundingBox();
    expect(bottom!.y + bottom!.height).toBeGreaterThan(height - 160);
    expect(bottom!.y).toBeLessThan(height);
    await page
      .getByRole("button", { name: "添加主机", exact: true })
      .first()
      .click();
    await expect(root).toHaveCSS("overflow", "hidden");
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(root).toHaveCSS("overflow", "auto");
    await page.route("**/api/hosts", (r) => r.fulfill({ json: [] }));
    await page.reload();
    await page.locator(".home>.empty").waitFor();
    if (width >= 1000)
      expect(await root.evaluate((e) => e.scrollHeight)).toBeLessThanOrEqual(
        height + 1,
      );
    await page.route("**/api/me", (r) => r.fulfill({ status: 401, json: {} }));
    await page.reload();
    await page.locator(".login-form").waitFor();
    await root.evaluate((e) => e.scrollTo(0, e.scrollHeight));
    await page.mouse.wheel(0, 5000);
    await page.waitForTimeout(250);
    expect(await root.evaluate((e) => e.scrollTop)).toBe(0);
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });
}
