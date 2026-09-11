import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
test("phone SSH, monitor, SFTP editing and streaming download", async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(!process.env.TEST_SSH_KEY, "requires isolated SSH fixture");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  const headers = { Origin: baseURL! };
  const registration = await context.request.post("/api/register", {
    headers,
    data: {
      email: `phone-${Date.now()}@example.com`,
      password: "phone-test-long-password",
    },
  });
  expect(registration.status()).toBe(200);
  const host = await context.request.post("/api/hosts", {
    headers,
    data: {
      name: "Mobile Linux",
      address: "127.0.0.1",
      port: 22222,
      username: "root",
      authType: "key",
      credential: {
        privateKey: readFileSync(process.env.TEST_SSH_KEY!, "utf8"),
      },
      group: "验证",
      note: "",
    },
  });
  expect(host.status()).toBe(200);
  await page.goto("/");
  await page.getByRole("button", { name: "连接", exact: true }).click();
  await page
    .getByRole("dialog", { name: "确认操作" })
    .getByRole("button", { name: "信任并连接", exact: true })
    .click();
  await expect(page.getByText("SSH 已连接", { exact: true })).toBeVisible();
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type('printf "PHONE_SSH_OK\\n"');
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.locator(".xterm-screen").innerText())
    .toContain("PHONE_SSH_OK");
  await page.getByRole("button", { name: "监控", exact: true }).tap();
  await expect(page.getByLabel("网卡", { exact: true })).toHaveValue(/.+/);
  await expect(page.getByText("每秒采样", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "文件", exact: true }).tap();
  await page.getByRole("textbox", { name: "远端路径" }).fill("/tmp");
  await page.getByRole("textbox", { name: "远端路径" }).press("Enter");
  const name = `phone-${Date.now()}.txt`;
  await page.locator("input[type=file]").setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from("phone transfer"),
  });
  await page.getByRole("button", { name, exact: true }).tap();
  await page.locator(".cm-content").fill("手机编辑验证");
  await page.getByRole("button", { name: "保存文件" }).tap();
  await expect(page.getByRole("button", { name: "保存文件" })).toBeDisabled();
  await page.getByRole("button", { name: "关闭", exact: true }).tap();
  const row = page
    .locator("tr")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
  await expect(row.getByTitle("修改权限")).toBeVisible();
  await row.locator(".file-actions summary").tap();
  const event = page.waitForEvent("download");
  await row.getByTitle("下载", { exact: true }).tap();
  const download = await event;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe("手机编辑验证");
  await row.getByRole("button", { name: "删除", exact: true }).tap();
  await page
    .getByRole("dialog", { name: "确认操作" })
    .getByRole("button", { name: "删除", exact: true })
    .tap();
  await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "终端", exact: true }).tap();
  await page.getByRole("button", { name: "Ctrl+C", exact: true }).tap();
  await page.screenshot({ path: "../design/glass-phone-real-ssh.png" });
  await context.request.post("/api/logout", { headers, data: {} });
  await expect(page.getByText("SSH 已连接", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
