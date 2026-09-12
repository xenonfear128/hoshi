import { test, expect } from "@playwright/test";
import { fixture, noOverflow, openGlobalAction } from "./fixtures";
import fs from "node:fs";
test("nested dialogs preserve drafts, focus, cancellation and exact file targets", async ({
  page,
}) => {
  await fixture(page);
  page.on("dialog", () => {
    throw new Error("Unexpected native dialog");
  });
  const operations: any[] = [];
  await page.route("**/api/connections/*/files", (r) => {
    if (r.request().method() === "POST") {
      operations.push(r.request().postDataJSON());
      return r.fulfill({ json: {} });
    }
    return r.fallback();
  });
  await page.getByRole("button", { name: "连接", exact: true }).first().click();
  const file = page.getByRole("button", {
    name: "production-config-with-a-long-readable-name.yaml",
    exact: true,
  });
  await file.click();
  await page.locator(".cm-content").fill("draft: keep\n");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  const confirmation = page.locator(".action-dialog");
  await expect(confirmation).toBeVisible();
  await expect(
    confirmation.getByRole("button", { name: "取消", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(page.locator(".cm-content")).toHaveText("draft: keep");
  await expect(page.locator(".file-editor-modal")).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await confirmation
    .getByRole("button", { name: "放弃修改", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(file).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
  const row = page.locator("tr").filter({ has: file });
  await row.locator("summary").click();
  await row.getByRole("button", { name: "移动", exact: true }).click();
  await confirmation.getByRole("textbox").fill("/srv/remoter/new name.yaml");
  await page.keyboard.press("Escape");
  expect(operations).toHaveLength(0);
  await row.getByRole("button", { name: "移动", exact: true }).click();
  await confirmation.getByRole("textbox").fill("/srv/remoter/new name.yaml");
  await confirmation.getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(() => operations.length).toBe(1);
  expect(operations[0]).toMatchObject({
    operation: "rename",
    path: "/srv/remoter/production-config-with-a-long-readable-name.yaml",
    target: "/srv/remoter/new name.yaml",
  });
  await row.getByTitle("修改权限").click();
  await confirmation.getByRole("textbox").fill("0640");
  await confirmation.getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(() => operations.length).toBe(2);
  expect(operations[1].permissions).toBe("0640");
  await row.getByRole("button", { name: "删除", exact: true }).click();
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  expect(operations).toHaveLength(2);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(confirmation.getByRole("textbox")).toBeFocused();
  await confirmation.getByRole("textbox").fill("uptime");
  await confirmation.getByRole("button", { name: "确认", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
});

test("long tasks, compact list, short keyboard viewport and doubled-scale layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  const tasks = Array.from({ length: 12 }, (_, i) => ({
    id: "task-" + i,
    hostId: "demo",
    request: "检查生产主机与日志目录，并保留最近十四天的运维记录 " + i,
    summary: "检查结果：日志目录占用较高，需要核对保留要求后再执行变更。",
    status: "complete",
    steps: [
      {
        explanation: "查看日志大小",
        risk: "read",
        command: "du -sh /var/log/*",
        output: "long-output ".repeat(2000),
      },
    ],
    result: "请先确认日志保留要求。\n".repeat(8),
  }));
  await page.route("**/api/ai/tasks", (r) => r.fulfill({ json: tasks }));
  await page.getByRole("button", { name: "紧凑列表", exact: true }).click();
  await expect(page.locator(".host-grid")).toHaveClass(/compact/);
  await noOverflow(page);
  await page.getByRole("button", { name: "AI 运维", exact: true }).click();
  await page.locator(".history-toggle").click();
  await page.locator(".history-item").last().click();
  await expect(page.locator(".task-history")).not.toBeVisible();
  await noOverflow(page);
  await page
    .locator(".ai-work")
    .evaluate((e) => (e.scrollTop = e.scrollHeight));
  await page.screenshot({
    path: "../design/ui-refinement/390-long-ai-task.png",
  });
  await page.setViewportSize({ width: 390, height: 480 });
  await page.getByLabel("运维需求").fill("补充说明");
  await page.getByLabel("运维需求").scrollIntoViewIfNeeded();
  await noOverflow(page);
  await expect(page.getByLabel("运维需求")).toBeInViewport();
  await page.screenshot({
    path: "../design/ui-refinement/390-keyboard-viewport.png",
  });
  // A 1512×1000 screen at 200% browser zoom has a 756×500 CSS-pixel layout viewport.
  await page.setViewportSize({ width: 756, height: 500 });
  await page.getByRole("button", { name: "主机管理", exact: true }).click();
  await noOverflow(page);
  await page
    .getByRole("button", { name: "添加主机", exact: true })
    .first()
    .click();
  await page.getByLabel("主机名称").fill("long-host-name-".repeat(15));
  await page
    .getByRole("button", { name: "保存主机", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "保存主机", exact: true }),
  ).toBeInViewport();
  await noOverflow(page);
  await page.screenshot({
    path: "../design/ui-refinement/200-percent-equivalent-layout.png",
  });
});

for (const theme of ["dark", "light"])
  test(`rendered font and composite text contrast ${theme}`, async ({
    page,
  }) => {
    await page.addInitScript(
      (theme) => localStorage.setItem("theme", theme),
      theme,
    );
    await fixture(page);
    await expect(page.locator(".host-card")).toHaveCount(2);
    await page.evaluate(() => document.fonts.ready);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: ".host-card h3",
    });
    const fonts = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    const used = await page.evaluate(() => {
      const el = document.querySelector(".host-card h3")!;
      return getComputedStyle(el).fontFamily;
    });
    // 可变字体在 Windows 与 Linux 实例化出的 postScriptName 不同
    // （Geist-SemiBold / Geist-Regular），这里只断言用的是本地托管的
    // Geist，而不是平台回退字体。
    expect(
      fonts.fonts.filter((f) => f.isCustomFont).map((f) => f.familyName),
      `CSS font-family: ${used} / 全部平台字体: ${JSON.stringify(fonts.fonts)}`,
    ).toContain("Geist");
    const measurements: any[] = [];
    async function measure(selector: string) {
      const el = page.locator(selector).first();
      await el.scrollIntoViewIfNeeded();
      const info = await el.evaluate((e) => {
        const s = getComputedStyle(e),
          r = e.getBoundingClientRect();
        return {
          color: s.color,
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
          style: e.getAttribute("style"),
        };
      });
      await el.evaluate((e) => {
        (e as HTMLElement).style.setProperty("transition", "none", "important");
        (e as HTMLElement).style.setProperty(
          "color",
          "transparent",
          "important",
        );
      });
      const screenshot = await page.screenshot();
      await el.evaluate((e, style) => {
        if (style === null) e.removeAttribute("style");
        else e.setAttribute("style", style);
      }, info.style);
      const bg = await page.evaluate(
        async ({ png, x, y }) => {
          const im = new Image();
          im.src = "data:image/png;base64," + png;
          await im.decode();
          const canvas = document.createElement("canvas");
          canvas.width = im.width;
          canvas.height = im.height;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(im, 0, 0);
          return [
            ...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data,
          ].slice(0, 3);
        },
        { png: screenshot.toString("base64"), x: info.x, y: info.y },
      );
      const fg = info.color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number);
      const lum = (c: number[]) =>
        c
          .map((v) => {
            v /= 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          })
          .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
      const ratio =
        (Math.max(lum(fg), lum(bg)) + 0.05) /
        (Math.min(lum(fg), lum(bg)) + 0.05);
      measurements.push({ selector, foreground: fg, background: bg, ratio });
      expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
    }
    for (const s of [
      ".page-heading p",
      ".host-note",
      ".host-card .mono",
      ".home-foot",
      ".navlink",
    ])
      await measure(s);
    await openGlobalAction(page, "AI 服务与订阅");
    await measure(".settings-modal form>.small");
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page
      .getByRole("button", { name: "连接", exact: true })
      .first()
      .click();
    await page
      .locator(".monitor")
      .evaluate((e) => (e.scrollTop = e.scrollHeight));
    await measure(".network-stats span");
    fs.writeFileSync(
      `../design/ui-refinement/contrast-${theme}.json`,
      JSON.stringify({ fonts, measurements }, null, 2),
    );
  });

for (const width of [390, 1512])
  for (const theme of ["dark", "light"])
    for (const locale of ["zh-CN", "ja", "en"])
      test(`login and registration ${width} ${theme} ${locale}`, async ({
        page,
      }) => {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 1000,
        });
        await page.addInitScript(
          ({ theme, locale }) => {
            localStorage.setItem("theme", theme);
            localStorage.setItem("hoshi-locale", locale);
          },
          { theme, locale },
        );
        await page.route("**/api/me", (r) =>
          r.fulfill({ status: 401, json: { error: "login required" } }),
        );
        await page.route("**/api/bootstrap", (r) =>
          r.fulfill({ json: { registration: true } }),
        );
        await page.goto("/");
        await expect(page.locator(".login-form")).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await noOverflow(page);
        await page.screenshot({
          path: `../design/ui-refinement/${width}-${theme}-${locale}-login.png`,
        });
        await page.locator(".login-form .text-button").click();
        await noOverflow(page);
        await page.screenshot({
          path: `../design/ui-refinement/${width}-${theme}-${locale}-register.png`,
        });
      });

for (const width of [390, 768])
  test(`global menu closes predictably at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await fixture(page);
    const toggle = page.locator(".global-menu-toggle");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await openGlobalAction(page, "切换主题");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await page.keyboard.press("Escape");
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await page
      .locator(".home.page-view.is-active .page-heading h1")
      .click({ position: { x: 4, y: 4 } });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

test("empty states, secondary menus and pending plan stay readable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await openGlobalAction(page, "传输中心");
  await expect(page.locator(".compact-empty")).toBeVisible();
  await page.screenshot({
    path: "../design/ui-refinement/390-transfers-empty.png",
  });
  await page.getByRole("button", { name: "返回工作台", exact: true }).click();
  await page.getByRole("button", { name: "工作台", exact: true }).click();
  const empty = page.locator(".workspace-deck>.empty");
  await expect(empty).toBeVisible();
  const aligned = await empty.evaluate((e) => {
    const r = e.getBoundingClientRect(),
      button = e.querySelector("button")!.getBoundingClientRect();
    return Math.abs(r.x + r.width / 2 - button.x - button.width / 2);
  });
  expect(aligned).toBeLessThan(2);
  await page.screenshot({
    path: "../design/ui-refinement/390-workspace-empty.png",
  });
  await page.getByRole("button", { name: "AI 运维", exact: true }).click();
  const task = {
    id: "pending",
    hostId: "demo",
    request: "检查磁盘占用",
    summary: "先检查，再决定是否清理",
    status: "planned",
    steps: [
      { explanation: "检查日志大小", command: "du -sh /var/log", risk: "read" },
      {
        explanation: "核对保留要求后清理",
        command: "journalctl --vacuum-time=14d",
        risk: "write",
      },
    ],
  };
  await page.route("**/api/ai/tasks", (r) =>
    r.fulfill({ json: r.request().method() === "POST" ? task : [task] }),
  );
  await page.getByLabel("运维需求").fill(task.request);
  await page.getByRole("button", { name: "生成方案", exact: true }).click();
  await expect(page.locator(".plan")).toBeVisible();
  await page.locator(".plan-actions").scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "确认方案并执行", exact: true }),
  ).toBeInViewport();
  await noOverflow(page);
  await page.screenshot({ path: "../design/ui-refinement/390-ai-plan.png" });
  await page
    .getByRole("button", { name: "确认方案并执行", exact: true })
    .click();
  await expect(page.locator(".action-dialog")).toContainText(
    "Production · Singapore",
  );
  await page.screenshot({
    path: "../design/ui-refinement/390-ai-confirmation.png",
  });
  await page
    .locator(".action-dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await page.getByRole("button", { name: "主机管理", exact: true }).click();
  await page.route("**/api/hosts", (r) => r.fulfill({ json: [] }));
  await page.reload();
  await expect(page.locator(".home .empty")).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: "../design/ui-refinement/390-hosts-empty.png",
  });
});
