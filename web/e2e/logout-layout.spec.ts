import { test, expect } from "@playwright/test";
import { fixture } from "./fixtures";
for (const width of [320, 393, 768, 1024, 1280, 1512])
  for (const locale of ["zh-CN", "en", "ja"]) {
    test(`logout ${width} ${locale}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 746 });
      await page.addInitScript(
        (locale) => localStorage.setItem("hoshi-locale", locale),
        locale,
      );
      await fixture(page);
      await expect(page.locator(".host-card")).toHaveCount(2);
      const menu = page.locator(".global-menu-toggle");
      if (await menu.isVisible()) await menu.click();
      const button = page.locator(".logout-button");
      await expect(button).toBeVisible();
      const b = await button.boundingBox();
      const icon = await button.locator("svg").boundingBox();
      expect(b!.height).toBe(44);
      expect(b!.width).toBeGreaterThanOrEqual(44);
      await expect(button).toHaveCSS("border-radius", "10px");
      expect(
        Math.abs(icon!.y + icon!.height / 2 - b!.y - b!.height / 2),
      ).toBeLessThan(1);
      if (width > 1050) {
        expect(b!.width).toBe(44);
        expect(
          Math.abs(icon!.x + icon!.width / 2 - b!.x - b!.width / 2),
        ).toBeLessThan(1);
      } else {
        await expect(button.locator("span")).toBeVisible();
        expect(icon!.x - b!.x).toBeGreaterThanOrEqual(12);
      }
      if (width === 393 || width === 1280)
        await page.screenshot({
          path: `../design/logout-${width}-${locale}.png`,
        });
      await button.click();
      await expect(page.locator(".login-form")).toBeVisible();
    });
  }
