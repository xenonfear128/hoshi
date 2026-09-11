import { test, expect } from "@playwright/test";
import { fixture, noOverflow, openGlobalAction } from "./fixtures";
const copy = {
  "zh-CN": {
    brand: "星",
    heading: "连接每一颗星。",
    connect: "连接",
    settings: "AI 服务与订阅",
    close: "关闭",
    monitor: "监控",
    files: "文件",
    terminal: "终端",
    helper: "命令助手",
    mode: "自然语言指令",
    host: "主机管理",
    ai: "AI 运维",
    request: "运维需求",
    byok: "自带密钥 BYOK",
    subscription: "平台订阅",
  },
  ja: {
    brand: "Hoshi",
    heading: "すべての星を、つなぐ。",
    connect: "接続",
    settings: "AI サービス・契約",
    close: "閉じる",
    monitor: "監視",
    files: "ファイル",
    terminal: "ターミナル",
    helper: "コマンド支援",
    mode: "自然言語の指示",
    host: "ホスト管理",
    ai: "AI 運用",
    request: "運用リクエスト",
    byok: "自分のキーを使用（BYOK）",
    subscription: "プラットフォーム契約",
  },
  en: {
    brand: "Stellar",
    heading: "Connect every star.",
    connect: "Connect",
    settings: "AI & subscription",
    close: "Close",
    monitor: "Monitor",
    files: "Files",
    terminal: "Terminal",
    helper: "Assistant",
    mode: "Natural-language command",
    host: "Hosts",
    ai: "AI operations",
    request: "Operations request",
    byok: "Bring your own key",
    subscription: "Platform subscription",
  },
};
const chooseLocale = async (
  page: import("@playwright/test").Page | import("@playwright/test").Locator,
  locale: string,
) => {
  await page
    .getByRole("button", {
      name: /^(界面语言|表示言語|Interface language)$/,
    })
    .click();
  await page.locator(`.language-panel button[lang="${locale}"]`).click();
};
for (const width of [390, 1280])
  for (const locale of ["zh-CN", "ja", "en"] as const) {
    test(`${locale} complete UI and live switching at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      let connections = 0;
      page.on("request", (r) => {
        if (new URL(r.url()).pathname.endsWith("/connect")) connections++;
      });
      await fixture(page);
      await chooseLocale(page, locale);
      const text = copy[locale];
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator(".hoshi-wordmark")).toHaveText(text.brand);
      await expect(page).toHaveTitle(new RegExp("^" + text.brand + " SSH$"));
      await expect(
        page.getByRole("heading", { name: text.heading, exact: true }),
      ).toBeVisible();
      await noOverflow(page);
      await page.screenshot({
        path: `../design/i18n-home-${locale}-${width}.png`,
        animations: "disabled",
      });
      await openGlobalAction(page, text.settings);
      await expect(
        page.getByRole("dialog", { name: text.settings }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: text.subscription, exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: text.byok, exact: true }),
      ).toBeVisible();
      await noOverflow(page);
      const settingsDialog = page.getByRole("dialog");
      const switched = locale === "en" ? "ja" : "en";
      await chooseLocale(settingsDialog, switched);
      await expect(
        page.getByRole("dialog", { name: copy[switched].settings }),
      ).toBeVisible();
      await chooseLocale(settingsDialog, locale);
      await page.getByRole("button", { name: text.close, exact: true }).click();
      await page
        .getByRole("button", { name: text.connect, exact: true })
        .first()
        .click();
      await expect(page.locator(".xterm-helper-textarea")).toBeAttached();
      const terminal = await page
        .locator(".xterm-helper-textarea")
        .elementHandle();
      if (width === 390) {
        await page
          .locator(".mobile-work-tabs")
          .getByRole("button", { name: text.monitor, exact: true })
          .click();
        await expect(page.locator(".monitor")).toBeVisible();
        await noOverflow(page);
        await page
          .locator(".mobile-work-tabs")
          .getByRole("button", { name: text.files, exact: true })
          .click();
        await expect(
          page.getByRole("button", {
            name: "production-config-with-a-long-readable-name.yaml",
            exact: true,
          }),
        ).toBeVisible();
        await noOverflow(page);
        await page
          .locator(".mobile-work-tabs")
          .getByRole("button", { name: text.terminal, exact: true })
          .click();
      }
      await page
        .getByRole("button", { name: text.helper, exact: true })
        .click();
      await page
        .getByRole("textbox", { name: text.mode, exact: true })
        .fill("keep this draft / 星");
      const next = locale === "en" ? "ja" : "en";
      await chooseLocale(page, next);
      await expect(page.locator(".hoshi-wordmark")).toHaveText(
        copy[next].brand,
      );
      await expect(
        page.getByRole("textbox", { name: copy[next].mode, exact: true }),
      ).toHaveValue("keep this draft / 星");
      expect(
        await terminal!.evaluate(
          (el) => el === document.querySelector(".xterm-helper-textarea"),
        ),
      ).toBe(true);
      expect(connections).toBe(1);
      await chooseLocale(page, locale);
      await noOverflow(page);
      await page.screenshot({
        path: `../design/i18n-workspace-${locale}-${width}.png`,
        animations: "disabled",
      });
      await page.getByRole("button", { name: text.ai, exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: text.request, exact: true }),
      ).toBeVisible();
      await noOverflow(page);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator(".hoshi-wordmark")).toHaveText(text.brand);
      expect(errors).toEqual([]);
    });
  }
test("login detects browser language and retains typed credentials on switch", async ({
  browser,
}) => {
  const context = await browser.newContext({
    locale: "ja-JP",
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.route("**/api/me", (r) =>
    r.fulfill({ status: 401, json: { error: "login required" } }),
  );
  await page.route("**/api/bootstrap", (r) =>
    r.fulfill({ json: { registration: true } }),
  );
  await page.goto(process.env.E2E_ORIGIN || "http://localhost:8080");
  await expect(page.locator(".hoshi-wordmark")).toHaveText("Hoshi");
  await page
    .getByLabel("メールアドレス", { exact: true })
    .fill("draft@example.com");
  await chooseLocale(page, "en");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "draft@example.com",
  );
  await expect(page.locator(".hoshi-wordmark")).toHaveText("Stellar");
  await noOverflow(page);
  await page.screenshot({
    path: "../design/i18n-login-en-mobile.png",
    animations: "disabled",
  });
  await context.close();
});
