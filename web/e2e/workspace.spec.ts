import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("real login, SSH, SFTP, theme and ownership boundaries", async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(!process.env.TEST_SSH_KEY, "requires isolated OpenSSH fixture");
  const origin = baseURL!;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto("/");
  await page.getByRole("button", { name: "还没有账号？注册" }).click();
  const email = `e2e-${Date.now()}@example.com`;
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page
    .getByLabel("密码", { exact: true })
    .fill("e2e-long-unique-password");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "连接每一颗星。" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "添加主机", exact: true })
    .first()
    .click();
  await page.getByLabel("主机名称").fill("E2E Linux");
  await page.getByLabel("地址", { exact: true }).fill("127.0.0.1");
  await page.getByLabel("端口", { exact: true }).fill("22222");
  await page.getByLabel("用户名", { exact: true }).fill("root");
  await page.getByRole("combobox", { name: "认证方式", exact: true }).click();
  await page.getByRole("option", { name: "SSH 私钥", exact: true }).click();
  await page
    .getByLabel("私钥", { exact: true })
    .fill(readFileSync(process.env.TEST_SSH_KEY!, "utf8"));
  await page.getByRole("button", { name: "保存主机" }).click();
  await page.getByRole("button", { name: "连接", exact: true }).click();
  await page
    .getByRole("dialog", { name: "确认操作" })
    .getByRole("button", { name: "信任并连接", exact: true })
    .click();
  await expect(page.getByText("SSH 已连接", { exact: true })).toBeVisible();
  const remoteDir = `/tmp/remoter-e2e-dir-${Date.now()}`;
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type(
    `mkdir ${remoteDir}; clear; printf "E2E_TERMINAL_OK\\n"`,
  );
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => page.locator(".xterm-screen").innerText())
    .toContain("E2E_TERMINAL_OK");
  const terminalBeforeLanguageSwitch = await page
    .locator(".xterm-helper-textarea")
    .elementHandle();
  for (const [locale, connected] of [
    ["en", "SSH connected"],
    ["ja", "SSH 接続済み"],
    ["zh-CN", "SSH 已连接"],
  ]) {
    await page
      .getByRole("button", {
        name: /^(界面语言|Interface language|表示言語)$/,
      })
      .click();
    await page.locator(`.language-panel button[lang="${locale}"]`).click();
    await expect(page.getByText(connected, { exact: true })).toBeVisible();
    await expect(page.locator(".session-tab")).toHaveCount(1);
  }
  expect(
    await terminalBeforeLanguageSwitch!.evaluate(
      (el) => el === document.querySelector(".xterm-helper-textarea"),
    ),
  ).toBe(true);
  await expect(
    page.getByRole("combobox", { name: "采样间隔", exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "远端路径" }).fill(remoteDir);
  await page.getByRole("textbox", { name: "远端路径" }).press("Enter");
  const name = `remoter-e2e-${Date.now()}.txt`;
  await page.locator("input[type=file]").setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from("first version"),
  });
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator(".cm-content").fill("second version 中文");
  await page.getByRole("button", { name: "保存文件" }).click();
  await expect(page.getByRole("button", { name: "保存文件" })).toBeDisabled();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page
    .locator("tr")
    .filter({ has: page.getByRole("button", { name, exact: true }) })
    .locator(".file-actions summary")
    .click();
  const downloadEvent = page.waitForEvent("download");
  await page
    .locator("tr")
    .filter({ has: page.getByRole("button", { name, exact: true }) })
    .getByTitle("下载", { exact: true })
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(name);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe("second version 中文");
  await page
    .locator("tr")
    .filter({ has: page.getByRole("button", { name, exact: true }) })
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "确认操作" })
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "切换主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "命令助手", exact: true }).click();
  await expect(
    page.getByPlaceholder("例如：查找 /var/log 下超过 100 MB 的日志文件"),
  ).toBeVisible();
  await page.screenshot({ path: "../design/verified-workspace-light.png" });
  await page.getByRole("button", { name: "切换主题" }).click();
  await page.screenshot({ path: "../design/verified-workspace-dark.png" });
  await page.getByRole("button", { name: "传输中心", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "传输中心" })).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText(name, { exact: true }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "主机管理", exact: true }).click();
  await page.getByRole("button", { name: "连接", exact: true }).click();
  await expect(page.locator(".session-tab")).toHaveCount(2);
  await page.getByRole("combobox", { name: "分屏会话", exact: true }).click();
  await page.getByRole("option").nth(1).click();
  await expect(page.locator(".workspace-container:visible")).toHaveCount(2);
  await expect(page.getByText("SSH 已连接", { exact: true })).toHaveCount(2);
  await page.getByRole("combobox", { name: "分屏会话", exact: true }).click();
  await page.getByRole("option", { name: "单终端视图", exact: true }).click();
  const hosts = await (await context.request.get("/api/hosts")).json();
  const foreign = await context
    .browser()!
    .newContext({ ignoreHTTPSErrors: process.env.E2E_INSECURE_TLS === "true" });
  await foreign.request.post(origin + "/api/register", {
    headers: { Origin: origin },
    data: {
      email: `foreign-${Date.now()}@example.com`,
      password: "other-long-password",
    },
  });
  const forbidden = await foreign.request.delete(
    origin + "/api/hosts/" + hosts[0].id,
    { headers: { Origin: origin } },
  );
  expect(forbidden.status()).toBe(404);
  await foreign.close();
  await page
    .locator(".workspace-container:visible .xterm-helper-textarea")
    .focus();
  await page.keyboard.type(`rmdir ${remoteDir}; printf "E2E_CLEANUP_OK\\n"`);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () =>
      page.locator(".workspace-container:visible .xterm-screen").innerText(),
    )
    .toContain("E2E_CLEANUP_OK");
  await context.request.post("/api/logout", {
    headers: { Origin: origin },
    data: {},
  });
  expect((await context.request.get("/api/me")).status()).toBe(401);
  expect(errors).toEqual([]);
});

test("temporary private key is used without persistence and is cleared after logout", async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(!process.env.TEST_SSH_KEY, "requires OpenSSH");
  const origin = baseURL!;
  const response = await context.request.post("/api/register", {
    headers: { Origin: origin },
    data: {
      email: `temporary-${Date.now()}@example.com`,
      password: "temporary-test-password",
    },
  });
  expect(response.status()).toBe(200);
  const hostResponse = await context.request.post("/api/hosts", {
    headers: { Origin: origin },
    data: {
      name: "临时凭据主机",
      address: "127.0.0.1",
      port: 22222,
      username: "root",
      authType: "key",
      group: "",
      note: "",
    },
  });
  expect(hostResponse.status()).toBe(200);
  page.on("dialog", (d) => d.accept());
  await page.goto("/");
  await page.getByRole("button", { name: "连接", exact: true }).click();
  await page
    .getByRole("dialog", { name: "确认操作" })
    .getByRole("button", { name: "信任并连接", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "临时连接凭据 · 临时凭据主机" }),
  ).toBeVisible();
  await page
    .getByLabel("SSH 私钥", { exact: true })
    .fill(readFileSync(process.env.TEST_SSH_KEY!, "utf8"));
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "连接", exact: true })
    .click();
  await expect(page.getByText("SSH 已连接", { exact: true })).toBeVisible();
  const hosts = await (await context.request.get("/api/hosts")).json();
  expect(hosts[0].hasCredential).toBe(false);
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(storage).not.toContain("PRIVATE KEY");
  await context.request.post("/api/logout", {
    headers: { Origin: origin },
    data: {},
  });
  await expect(page.getByText("SSH 已连接", { exact: true })).toHaveCount(0);
});

test("switching accounts clears the previous host list before a slow refresh", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = baseURL!,
    email = `owner-${Date.now()}@example.com`;
  expect(
    (
      await context.request.post("/api/register", {
        headers: { Origin: origin },
        data: { email, password: "owner-cache-test-password" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await context.request.post("/api/hosts", {
        headers: { Origin: origin },
        data: {
          name: "PREVIOUS_ACCOUNT_PRIVATE_HOST",
          address: "192.168.1.10",
          port: 22,
          username: "devops",
          authType: "password",
          group: "",
          note: "",
        },
      })
    ).status(),
  ).toBe(200);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "PREVIOUS_ACCOUNT_PRIVATE_HOST" }),
  ).toBeVisible();
  await page.getByTitle(email, { exact: true }).click();
  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
  await page.getByRole("button", { name: "还没有账号？注册" }).click();
  await page
    .getByLabel("邮箱", { exact: true })
    .fill(`new-owner-${Date.now()}@example.com`);
  await page
    .getByLabel("密码", { exact: true })
    .fill("new-owner-cache-password");
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/hosts", async (route) => {
    await paused;
    await route.continue();
  });
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "连接每一颗星。" }),
  ).toBeVisible();
  await expect(
    page.getByText("PREVIOUS_ACCOUNT_PRIVATE_HOST", { exact: true }),
  ).toHaveCount(0);
  release();
  await expect(
    page.getByRole("heading", { name: "添加第一台服务器" }),
  ).toBeVisible();
  await context.request.post("/api/logout", {
    headers: { Origin: origin },
    data: {},
  });
});
