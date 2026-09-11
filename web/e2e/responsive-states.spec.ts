import { test, expect } from "@playwright/test";
import { noOverflow } from "./fixtures";
test.use({ isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
for (const theme of ["light", "dark"])
  for (const locale of ["zh-CN", "en", "ja"]) {
    test(`touch auth ${theme} ${locale}`, async ({ page }) => {
      await page.setViewportSize({ width: 393, height: 659 });
      await page.addInitScript(
        ({ theme, locale }) => {
          localStorage.setItem("theme", theme);
          localStorage.setItem("hoshi-locale", locale);
        },
        { theme, locale },
      );
      await page.route("**/api/**", (r) =>
        r.fulfill({
          status: r.request().url().endsWith("/bootstrap") ? 200 : 401,
          contentType: "application/json",
          body: r.request().url().endsWith("/bootstrap")
            ? '{"registration":true}'
            : "{}",
        }),
      );
      await page.goto("/");
      await page.locator(".login-form").waitFor();
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.getElementById("root")!.scrollHeight,
        ),
      ).toBeLessThanOrEqual(660);
      await page.locator("#login-password").fill("Touch-test-only");
      await page.locator(".password-reveal").tap();
      await expect(page.locator("#login-password")).toHaveAttribute(
        "type",
        "text",
      );
      await page.locator(".login-form > .text-button").tap();
      await expect(page.locator("#login-password")).toHaveAttribute(
        "type",
        "password",
      );
      await noOverflow(page);
      await page.locator(".login-form > .primary").scrollIntoViewIfNeeded();
      await page.setViewportSize({ width: 844, height: 390 });
      await noOverflow(page);
      await page.locator(".login-form > .primary").scrollIntoViewIfNeeded();
      const box = await page.locator(".login-form > .primary").boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(391);
      await page.setViewportSize({ width: 393, height: 659 });
      await page.locator(".login-form > .text-button").tap();
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: `../design/responsive-audit/touch-${test.info().project.name}-${theme}-${locale}.png`,
      });
    });
  }
