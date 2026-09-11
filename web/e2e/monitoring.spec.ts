import { test, expect, type Page } from "@playwright/test";
import { fixture, noOverflow } from "./fixtures";
const host = {
  id: "monitored",
  name: "Singapore · Monitoring",
  address: "10.24.8.12",
  port: 22,
  username: "devops",
  group: "Production",
  note: "",
  authType: "password",
  hasCredential: true,
  fingerprint: "SHA256:fixture",
  agentEnabled: true,
  agentStatus: "online",
};
const settings = {
  intervalSeconds: 3,
  interfaces: [],
  excludeInterfaces: [],
  mounts: [],
  excludeMounts: [],
  billingDay: 1,
  timezone: "UTC",
  quotaBytes: 107374182400,
  paused: false,
  gpu: true,
  checks: [
    {
      id: "health",
      name: "API health",
      kind: "http",
      url: "https://example.com/health",
      host: "",
      port: 443,
      timeoutMs: 1000,
      intervalSeconds: 30,
    },
  ],
};
const sample = {
  sampledAt: new Date().toISOString(),
  hostname: "production",
  os: "Ubuntu 24.04",
  kernel: "6.8.0",
  arch: "amd64",
  cores: 8,
  uptime: 36000,
  version: "0.1.0",
  cpu: 37.3,
  perCoreCPU: [10, 35, 22, 63, 45, 10, 50, 40],
  memoryTotal: 8589934592,
  memoryUsed: 4294967296,
  swapTotal: 0,
  swapUsed: 0,
  load: [0.2, 0.3, 0.4],
  processes: 119,
  tcp: 47,
  udp: 13,
  capabilities: { gpu: "unsupported", perCoreCPU: "available" },
  network: [
    {
      name: "eth0",
      default: true,
      rxBytes: 50000,
      txBytes: 23000,
      rxErrors: 0,
      txErrors: 1,
      rxDrops: 0,
      txDrops: 1,
    },
    {
      name: "docker0",
      default: false,
      rxBytes: 10000,
      txBytes: 10000,
      rxErrors: 0,
      txErrors: 0,
      rxDrops: 0,
      txDrops: 0,
    },
  ],
  mounts: [
    {
      mount: "/",
      total: 107374182400,
      used: 34359738368,
      free: 73014444032,
      device: "/dev/vda1",
    },
  ],
  disks: [{ name: "vda" }],
  gpus: [],
};
const stat = (n: number) => ({
  count: 3,
  sum: n * 3,
  average: n,
  min: n - 1,
  max: n + 2,
});
async function setup(page: Page) {
  await fixture(page);
  const writes: { path: string; data: unknown }[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    let data: unknown;
    if (path === "/api/hosts" && req.method() === "GET") data = [host];
    else if (path === "/api/hosts" && req.method() === "POST")
      data = { ...host, ...req.postDataJSON(), id: "new-host" };
    else if (path === "/api/monitor/summary")
      data = {
        [host.id]: {
          status: "online",
          values: { cpu: 37, memory: 50, rx: 230000, tx: 93000 },
          lastSeen: new Date().toISOString(),
        },
      };
    else if (path.endsWith("/agent"))
      data = {
        enabled: true,
        status: "online",
        agentID: "agent",
        version: "0.1.0",
        lastSeen: new Date().toISOString(),
        lastCurrent: new Date().toISOString(),
        settings,
        capabilities: sample.capabilities,
      };
    else if (path.endsWith("/monitor"))
      data = {
        status: "online",
        sample,
        values: {
          cpu: 37.3,
          memory: 50,
          rx: 230000,
          tx: 93000,
          "net:eth0:rx": 230000,
          "net:eth0:tx": 93000,
          "disk:vda:read": 45000,
          "disk:vda:write": 75000,
        },
        settings,
        gap: false,
        periods: {
          day: {
            interfaces: {
              eth0: { rx: 5e9, tx: 1e9, rxPeak: 1e6, txPeak: 1e5 },
            },
          },
          month: {
            interfaces: {
              eth0: { rx: 40e9, tx: 10e9, rxPeak: 8e6, txPeak: 3e5 },
            },
          },
        },
      };
    else if (path.endsWith("/monitor/history"))
      data = {
        step: 10,
        points: Array.from({ length: 120 }, (_, i) => ({
          time: new Date(Date.now() - (119 - i) * 10000).toISOString(),
          count: i === 55 ? 0 : 3,
          gap: i === 55,
          metrics:
            i === 55
              ? {}
              : {
                  cpu: stat(30 + Math.sin(i / 10) * 12),
                  memory: stat(50),
                  "net:eth0:rx": stat(230000 + Math.sin(i / 10) * 30000),
                  "net:eth0:tx": stat(90000),
                },
          checks: {
            health: {
              success: 2,
              failure: 1,
              unavailable: 0,
              latency: stat(24),
            },
          },
          traffic: {},
        })),
      };
    else if (path.endsWith("/monitor/events"))
      data = [
        {
          id: "event",
          kind: "agent_offline_recovered",
          severity: "info",
          createdAt: new Date().toISOString(),
          data: { value: 0 },
        },
      ];
    else if (
      path.endsWith("/agent/jobs") ||
      path.endsWith("/alerts/deliveries")
    )
      data = [];
    else if (path.endsWith("/alerts"))
      data = {
        enabled: true,
        offlineGraceSeconds: 180,
        durationSeconds: 60,
        recoverySeconds: 30,
        cooldownSeconds: 300,
        hysteresisPercent: 5,
        cpuPercent: 90,
        memoryPercent: 90,
        diskPercent: 95,
        muteUntil: null,
        hasWebhook: true,
      };
    else if (path.endsWith("/agent/registration"))
      data = {
        serverURL: "https://hoshi.example",
        registrationToken: "SECRET-MUST-NOT-APPEAR-IN-COMMANDS",
      };
    else {
      await route.fallback();
      return;
    }
    if (req.method() !== "GET") writes.push({ path, data: req.postDataJSON() });
    await route.fulfill({ json: data });
  });
  await page.reload();
  return writes;
}
for (const [width, height] of [
  [360, 740],
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1440, 900],
])
  for (const theme of ["light", "dark"])
    for (const locale of ["zh-CN", "en", "ja"]) {
      test(`monitor pages ${width} ${theme} ${locale}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height });
        await page.addInitScript(
          ({ theme, locale }) => {
            localStorage.setItem("theme", theme);
            localStorage.setItem("hoshi-locale", locale);
          },
          { theme, locale },
        );
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await setup(page);
        await page.locator(".host-monitor-summary").click();
        await expect(page.locator(".monitor-heading h1")).toHaveText(host.name);
        await expect(
          page.locator(".monitor-chart canvas").first(),
        ).toBeVisible();
        for (let tab = 0; tab < 5; tab++) {
          await page.locator(".monitor-tabs button").nth(tab).click();
          await expect(page.locator(".monitor-content")).toBeVisible();
          await noOverflow(page);
          const box = await page.locator(".monitor-content").boundingBox();
          expect(box!.width).toBeGreaterThan(width < 600 ? 290 : 500);
          expect(box!.y + box!.height).toBeLessThanOrEqual(height + 2);
        }
        expect(errors).toEqual([]);
        if (width === 390 && locale === "zh-CN")
          await page.screenshot({
            path: testInfo.outputPath(`monitor-${theme}-390.png`),
          });
      });
    }
test("manual config stays out of commands and settings preserve advanced values", async ({
  page,
}) => {
  await setup(page);
  await page.locator(".host-monitor-summary").click();
  await page.locator(".monitor-tabs button").nth(4).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载私有配置", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("config.json");
  expect(await page.locator(".manual-install").innerText()).not.toContain(
    "SECRET-MUST",
  );
  await expect(page.getByLabel("账期配额（GiB，0 为不限）")).toHaveValue("100");
  await expect(page.getByLabel("Webhook URL", { exact: false })).toHaveValue(
    "",
  );
});
test("optional monitoring defaults off and manual save opens settings", async ({
  page,
}) => {
  const writes = await setup(page);
  await page
    .getByRole("button", { name: "添加主机", exact: true })
    .first()
    .click();
  const toggle = page.locator(".monitoring-option input[type=checkbox]");
  await expect(toggle).not.toBeChecked();
  await page.getByLabel("主机名称", { exact: true }).fill("New host");
  await page.getByLabel("地址", { exact: true }).fill("192.0.2.12");
  await page.getByLabel("用户名", { exact: true }).fill("root");
  await toggle.check();
  await page.getByRole("button", { name: "手动安装", exact: true }).click();
  await page.getByRole("button", { name: "保存主机", exact: true }).click();
  await expect(page.locator(".monitor-heading h1")).toHaveText("New host");
  expect(writes.some((w) => w.path.endsWith("/agent/jobs"))).toBe(false);
});
