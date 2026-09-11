import { test, expect } from "@playwright/test";
import { fixture } from "./fixtures";

test("language panel fits phone, supports keyboard and preserves its parent dialog", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.getByRole("button", { name: "界面语言", exact: true }).click();
  const panel = page.locator(".language-panel:popover-open");
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "中文", exact: true }),
  ).toBeFocused();
  await page.screenshot({ path: "../design/language-panel-390.png" });
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("ArrowDown");
  await expect(
    panel.getByRole("button", { name: "日本語", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "界面语言", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "添加主机", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "界面语言", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(panel).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
