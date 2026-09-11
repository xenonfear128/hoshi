import { test, expect } from "@playwright/test";
import { fixture, noOverflow, openGlobalAction } from "./fixtures";
for (const width of [360, 390, 768, 1512]) {
  test(`glass and responsive workflows at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 751 ? 844 : 1000 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const inputs = await fixture(page);
    await expect(page).toHaveTitle("星 · SSH · SFTP · 实时监控 · AI 运维");
    await expect(page.locator(".hoshi-wordmark")).toHaveText("星");
    await expect(page.locator("html")).toHaveAttribute("data-glass", "webgl");
    await expect(page.locator(".nav.glass-ready")).toHaveCount(1);
    expect(
      await page
        .locator(".nav .glass-canvas")
        .first()
        .evaluate(
          (canvas: HTMLCanvasElement) =>
            canvas
              .getContext("2d")!
              .getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[3],
        ),
    ).toBeGreaterThan(200);
    await noOverflow(page);
    await page.screenshot({
      animations: "disabled",
      path: `../design/hoshi-home-${width}-dark.png`,
    });
    await openGlobalAction(page, "切换主题");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.screenshot({
      animations: "disabled",
      path: `../design/hoshi-home-${width}-light.png`,
    });
    await page
      .getByRole("button", { name: "添加主机", exact: true })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await noOverflow(page);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await openGlobalAction(page, "AI 服务与订阅");
    await expect(page.getByRole("dialog")).toBeVisible();
    await noOverflow(page);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page
      .getByRole("button", { name: "连接", exact: true })
      .first()
      .click();
    await expect(page.getByText("SSH 已连接", { exact: true })).toBeVisible();
    await noOverflow(page);
    if (width < 751) {
      await expect(page.locator(".monitor")).not.toBeVisible();
      await page.getByRole("button", { name: "Tab", exact: true }).click();
      expect(inputs).toContain("\t");
      await page.getByRole("button", { name: "Ctrl+C", exact: true }).click();
      expect(inputs).toContain("\x03");
      await page.getByRole("button", { name: "监控", exact: true }).click();
      await expect(page.getByLabel("网卡", { exact: true })).toBeVisible();
      await page
        .getByRole("combobox", { name: "磁盘挂载点", exact: true })
        .click();
      await page.getByRole("option").nth(1).click();
      await noOverflow(page);
      await page.screenshot({
        animations: "disabled",
        path: `../design/hoshi-monitor-${width}.png`,
      });
      await page.getByRole("button", { name: "文件", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "远端路径" }),
      ).toBeVisible();
      await noOverflow(page);
      await page
        .getByRole("button", {
          name: "production-config-with-a-long-readable-name.yaml",
          exact: true,
        })
        .click();
      await expect(page.locator(".cm-content")).toBeVisible();
      await noOverflow(page);
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      await page.screenshot({
        animations: "disabled",
        path: `../design/hoshi-files-${width}.png`,
      });
      await page.getByRole("button", { name: "终端", exact: true }).click();
    }
    await page.getByRole("button", { name: "命令助手", exact: true }).click();
    await expect(
      page.getByPlaceholder("例如：查找 /var/log 下超过 100 MB 的日志文件"),
    ).toBeVisible();
    await page.screenshot({
      animations: "disabled",
      path: `../design/hoshi-workspace-${width}.png`,
    });
    await page.getByRole("button", { name: "AI 运维", exact: true }).click();
    await expect(page.getByLabel("运维需求")).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      animations: "disabled",
      path: `../design/hoshi-ai-${width}.png`,
    });
    expect(errors).toEqual([]);
  });
}
test("WebGL unavailable retains functional mobile interface", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      type: string,
      ...args: unknown[]
    ) {
      if (type === "webgl") return null;
      return original.call(this, type, ...args);
    } as typeof original;
  });
  await fixture(page);
  await expect(page.locator("html")).toHaveAttribute("data-glass", "fallback");
  await page
    .getByRole("button", { name: "添加主机", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "AI 运维", exact: true }).click();
  await expect(page.getByLabel("运维需求")).toBeVisible();
  await noOverflow(page);
});

test("context loss falls back and page remains operable", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      type: string,
      ...args: unknown[]
    ) {
      const ctx = original.call(this, type, ...args);
      if (type === "webgl" && ctx)
        (
          window as unknown as { glassContext: WebGLRenderingContext }
        ).glassContext = ctx as WebGLRenderingContext;
      return ctx;
    } as typeof original;
  });
  await fixture(page);
  await expect(page.locator("html")).toHaveAttribute("data-glass", "webgl");
  await page.evaluate(() =>
    (window as unknown as { glassContext: WebGLRenderingContext }).glassContext
      .getExtension("WEBGL_lose_context")!
      .loseContext(),
  );
  await openGlobalAction(page, "切换主题");
  if (await page.locator(".global-menu-toggle").isVisible())
    await page.locator(".global-menu-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-glass", "fallback");
  await page
    .getByRole("button", { name: "添加主机", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("phone rotation and reduced-motion preserve session and keyboard controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const inputs = await fixture(page);
  await page.getByRole("button", { name: "连接", exact: true }).first().click();
  await expect(page.getByText("SSH 已连接", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ctrl", exact: true }).click();
  await page.keyboard.type("c");
  expect(inputs).toContain("\x03");
  await expect(
    page.getByRole("button", { name: "Ctrl", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator(".terminal-keys")).toBeVisible();
  await expect(page.getByText("SSH 已连接", { exact: true })).toBeVisible();
  await noOverflow(page);
  await page.setViewportSize({ width: 390, height: 540 });
  const bounds = await page.locator(".terminal-keys").boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(540);
  await noOverflow(page);
  await page.getByRole("button", { name: "监控", exact: true }).click();
  await expect(page.getByLabel("网卡", { exact: true })).toBeVisible();
});
