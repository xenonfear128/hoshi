import { test, expect, type Page } from "@playwright/test";
import { fixture, noOverflow } from "./fixtures";
import { setLocale, tr } from "../src/i18n";
async function globalAction(page: Page, label: string) {
  const toggle = page.locator(".global-menu-toggle");
  if (
    (await toggle.isVisible()) &&
    !(await page
      .locator(".global-actions")
      .evaluate((e) => e.classList.contains("open")))
  )
    await toggle.click();
  await page.getByRole("button", { name: label, exact: true }).click();
}
for (const width of [390, 768, 1280, 1512])
  for (const theme of ["dark", "light"])
    for (const locale of ["zh-CN", "ja", "en"] as const) {
      test(`readable ${width} ${theme} ${locale}`, async ({ page }) => {
        test.setTimeout(60000);
        setLocale(locale);
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 1000,
        });
        await page.addInitScript(
          ({ locale, theme }) => {
            localStorage.setItem("hoshi-locale", locale);
            localStorage.setItem("theme", theme);
          },
          { locale, theme },
        );
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await fixture(page);
        await expect(page.locator(".host-card")).toHaveCount(2);
        await page.evaluate(() => document.fonts.ready);
        const prefix = `../design/ui-refinement/${width}-${theme}-${locale}`;
        const shot = async (name: string) => {
          await noOverflow(page);
          await page.screenshot({
            path: `${prefix}-${name}.png`,
            animations: "disabled",
          });
        };
        await shot("home");
        expect(
          await page
            .locator(".host-card .mono")
            .first()
            .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
        ).toBeGreaterThanOrEqual(12);
        if (width === 390) {
          const b = await page.locator(".connect-button").first().boundingBox();
          expect(b!.y + b!.height).toBeLessThan(770);
        }
        await page
          .getByRole("button", { name: tr("添加主机"), exact: true })
          .first()
          .click();
        await shot("host");
        await page
          .getByRole("button", { name: tr("关闭"), exact: true })
          .click();
        await globalAction(page, tr("AI 服务与订阅"));
        await shot("settings");
        const gap = await page
          .locator(".settings-modal")
          .evaluate(
            (e) =>
              e.querySelector(".usage-heading")!.getBoundingClientRect().top -
              e.querySelector("form footer")!.getBoundingClientRect().bottom,
          );
        expect(gap).toBeGreaterThanOrEqual(24);
        await page
          .getByRole("button", { name: tr("平台订阅"), exact: true })
          .click();
        await shot("subscription");
        await page
          .getByRole("button", { name: tr("关闭"), exact: true })
          .click();
        await page
          .getByRole("button", { name: tr("AI 运维"), exact: true })
          .click();
        await expect(page.locator(".ai-request")).toBeVisible();
        await shot("ai");
        if (width === 390) {
          expect(await page.locator(".task-history").isVisible()).toBe(false);
          const b = await page.locator(".ai-request button").boundingBox();
          expect(b!.y + b!.height).toBeLessThan(767);
        }
        await page
          .getByRole("button", { name: tr("主机管理"), exact: true })
          .click();
        await page
          .getByRole("button", { name: tr("连接"), exact: true })
          .first()
          .click();
        await expect(page.locator(".xterm-helper-textarea")).toBeAttached();
        await shot("workspace");
        if (width === 390) {
          await page
            .locator(".mobile-work-tabs")
            .getByRole("button", { name: tr("监控"), exact: true })
            .click();
          await page
            .locator(".monitor")
            .evaluate((e) => (e.scrollTop = e.scrollHeight));
          await shot("network");
          await page
            .locator(".mobile-work-tabs")
            .getByRole("button", { name: tr("文件"), exact: true })
            .click();
        }
        await shot("files");
        await page
          .getByRole("button", {
            name: "production-config-with-a-long-readable-name.yaml",
            exact: true,
          })
          .click();
        await expect(page.locator(".cm-content")).toBeVisible();
        await shot("editor");
        const h = await page.locator(".file-editor-modal h2").evaluate((e) => {
          const s = getComputedStyle(e);
          return {
            height: e.getBoundingClientRect().height,
            line: parseFloat(s.lineHeight),
          };
        });
        expect(h.height).toBeLessThanOrEqual(h.line * 2 + 1);
        const editor = await page.locator(".editor-content").boundingBox();
        expect(editor!.height).toBeGreaterThan(350);
        if (width >= 1280) expect(editor!.width).toBeGreaterThan(850);
        await page
          .getByRole("button", { name: tr("关闭"), exact: true })
          .click();
        if (width === 390)
          await page
            .locator(".mobile-work-tabs")
            .getByRole("button", { name: tr("终端"), exact: true })
            .click();
        await page
          .getByRole("button", { name: tr("命令助手"), exact: true })
          .click();
        await shot("assistant");
        expect(
          await page
            .locator(".command-assistant .select-trigger")
            .evaluate((e) => e.clientWidth),
        ).toBeGreaterThan(250);
        expect(errors).toEqual([]);
      });
    }
