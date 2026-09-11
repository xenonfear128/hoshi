import { test, expect } from "@playwright/test";
import { fixture } from "./fixtures";
for (const theme of ["dark", "light"])
  for (const width of [1280, 390]) {
    test(`custom selects ${theme} ${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
      await fixture(page);
      await page
        .getByRole("button", { name: "连接", exact: true })
        .first()
        .click();
      const size = page.getByRole("combobox", { name: "终端字号" });
      await size.click();
      await expect(page.locator(".select-menu:popover-open")).toBeVisible();
      await page.getByRole("option", { name: "18px", exact: true }).click();
      await expect(size).toHaveText("18px");
      await size.focus();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Home");
      await page.keyboard.press("Enter");
      await expect(size).toHaveText("12px");
      await size.click();
      await page.keyboard.press("Escape");
      await expect(size).toBeFocused();
      await expect(page.locator(".select-menu:popover-open")).toHaveCount(0);
      if (width < 768)
        await page.getByRole("button", { name: "监控", exact: true }).click();
      await page.getByRole("combobox", { name: "磁盘挂载点" }).click();
      const menu = page.locator(".select-menu:popover-open");
      await expect(menu).toBeVisible();
      const rect = await menu.boundingBox();
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(844);
      await page.waitForTimeout(250);
      await page.screenshot({
        path: testInfo.outputPath(`select-${theme}-${width}.png`),
      });
      await page
        .getByRole("option")
        .filter({ hasText: "/var/lib/docker" })
        .click();
      await expect(
        page.getByRole("combobox", { name: "磁盘挂载点" }),
      ).toContainText("/var/lib/docker");
      await expect(page.locator("select")).toHaveCount(0);
    });
  }
test("select inside host form keeps dialog and keyboard focus", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "添加主机", exact: true })
    .first()
    .click();
  const auth = page.getByRole("combobox", { name: "认证方式", exact: true });
  await auth.click();
  await page.getByRole("option", { name: "SSH 私钥", exact: true }).click();
  await expect(page.getByLabel("私钥", { exact: true })).toBeVisible();
  await auth.click();
  await page.keyboard.press("Escape");
  await expect(auth).toBeVisible();
  await expect(auth).toBeFocused();
  await auth.click();
  await page.keyboard.press("Tab");
  await expect(page.locator(".select-menu:popover-open")).toHaveCount(0);
});
