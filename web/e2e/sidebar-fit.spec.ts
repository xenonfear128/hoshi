import { test, expect } from "@playwright/test";
import { fixture } from "./fixtures";
for (const [width, height] of [
  [1280, 640],
  [390, 740],
  [1366, 768],
  [1280, 720],
  [1024, 768],
  [1920, 1080],
  [390, 844],
]) {
  test(`sidebar fits ${width}x${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await fixture(page);
    await page
      .getByRole("button", { name: "连接", exact: true })
      .first()
      .click();
    if (width < 768) {
      const tab = page
        .locator(".mobile-work-tabs button")
        .filter({ hasText: "监控" });
      await tab.click();
    }
    await expect(page.locator(".monitor")).toBeVisible();
    await page.waitForTimeout(900);
    const size = await page.locator(".monitor").evaluate((el) => ({
      height: el.clientHeight,
      scroll: el.scrollHeight,
      bottom: el.getBoundingClientRect().bottom,
      last: el.querySelector(".monitor-totals")!.getBoundingClientRect().bottom,
    }));
    console.log({ width, height, ...size });
    await page.screenshot({
      path: testInfo.outputPath(`sidebar-${width}.png`),
    });
    expect(size.scroll).toBeLessThanOrEqual(size.height + 1);
    expect(size.last).toBeLessThanOrEqual(size.bottom);
    await page.screenshot({
      path: testInfo.outputPath(`sidebar-${width}.png`),
    });
  });
}
