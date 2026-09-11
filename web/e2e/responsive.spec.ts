import { test, expect, type Page } from "@playwright/test";
import { fixture, noOverflow, openGlobalAction } from "./fixtures";
import { setLocale, tr } from "../src/i18n";
const sizes = [
  [320, 568],
  [360, 640],
  [375, 667],
  [390, 664],
  [393, 659],
  [430, 739],
  [568, 320],
  [844, 390],
  [750, 750],
  [768, 1024],
  [820, 980],
  [1024, 650],
  [1280, 746],
  [1366, 768],
  [1512, 1000],
  [1920, 1080],
  [2560, 1080],
];
async function reachable(page: Page, selector: string) {
  const item = page.locator(selector).last();
  await item.scrollIntoViewIfNeeded();
  const box = await item.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(
    (await page.evaluate(() => innerHeight)) + 1,
  );
}
for (const [width, height] of sizes)
  for (const locale of ["zh-CN", "en", "ja"] as const) {
    test(`login ${width}x${height} ${locale}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(
        (locale) => localStorage.setItem("hoshi-locale", locale),
        locale,
      );
      await page.route("**/api/**", (r) =>
        r.fulfill({
          status: r.request().url().endsWith("/bootstrap") ? 200 : 401,
          contentType: "application/json",
          body: "{}",
        }),
      );
      await page.goto("/");
      await page.locator(".login-form").waitFor();
      await page.evaluate(() => document.fonts.ready);
      await noOverflow(page);
      if (height >= 568)
        expect(
          await page.evaluate(
            () => document.getElementById("root")!.scrollHeight,
          ),
        ).toBeLessThanOrEqual(height + 1);
      await reachable(page, ".login-form > .primary");
      await page.setViewportSize({ width, height: Math.min(height, 350) });
      await page.locator("#login-password").fill("Keyboard-layout-check");
      await reachable(page, ".login-form > .primary");
      await noOverflow(page);
    });
    test(`pages ${width}x${height} ${locale}`, async ({ page }) => {
      test.setTimeout(45000);
      setLocale(locale);
      await page.setViewportSize({ width, height });
      await page.addInitScript(
        (locale) => localStorage.setItem("hoshi-locale", locale),
        locale,
      );
      await fixture(page);
      await noOverflow(page);
      await page
        .getByRole("button", { name: tr("添加主机"), exact: true })
        .first()
        .click();
      await noOverflow(page);
      await reachable(page, ".modal footer button");
      await page.getByRole("button", { name: tr("关闭"), exact: true }).click();
      await openGlobalAction(page, tr("AI 服务与订阅"));
      await noOverflow(page);
      await reachable(page, ".settings-modal form footer button");
      await page.getByRole("button", { name: tr("关闭"), exact: true }).click();
      await page
        .getByRole("button", { name: tr("AI 运维"), exact: true })
        .click();
      await noOverflow(page);
      await reachable(page, ".ai-request button");
      await page
        .getByRole("button", { name: tr("主机管理"), exact: true })
        .click();
      await page
        .getByRole("button", { name: tr("连接"), exact: true })
        .first()
        .click();
      await page
        .locator(".xterm-helper-textarea")
        .waitFor({ state: "attached" });
      await noOverflow(page);
      const tabs = page.locator(".mobile-work-tabs");
      if (await tabs.isVisible())
        await tabs
          .getByRole("button", { name: tr("文件"), exact: true })
          .click();
      await page
        .getByRole("button", {
          name: "production-config-with-a-long-readable-name.yaml",
          exact: true,
        })
        .click();
      await noOverflow(page);
      await reachable(page, ".file-editor-modal footer button");
    });
  }
