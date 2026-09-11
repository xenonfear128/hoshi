import { expect, type Page } from "@playwright/test";
const hosts = [
  {
    id: "demo",
    name: "Production · Singapore",
    address: "10.24.8.12",
    port: 22,
    username: "devops",
    group: "生产环境",
    note: "API 服务与边缘网关",
    authType: "key",
    hasCredential: true,
    fingerprint: "SHA256:fixture",
  },
  {
    id: "staging",
    name: "Staging · Tokyo",
    address: "10.24.16.8",
    port: 22,
    username: "deploy",
    group: "预发布",
    note: "发布验证 · PostgreSQL / Redis",
    authType: "key",
    hasCredential: true,
    fingerprint: "SHA256:fixture",
  },
];
export async function fixture(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api", "");
    let result: unknown = {};
    if (path === "/me") result = { id: "owner", email: "operator@example.com" };
    else if (path === "/hosts") result = hosts;
    else if (path.endsWith("/probe"))
      result = {
        fingerprint: "SHA256:fixture",
        previous: "SHA256:fixture",
        changed: false,
      };
    else if (path.endsWith("/connect")) result = { id: "connection" };
    else if (path.endsWith("/files"))
      result = {
        path: "/srv/remoter",
        entries: [
          {
            name: "deploy",
            directory: true,
            size: 0,
            mode: "0755",
            modified: new Date().toISOString(),
          },
          {
            name: "production-config-with-a-long-readable-name.yaml",
            directory: false,
            size: 2490,
            mode: "0644",
            modified: new Date().toISOString(),
          },
        ],
      };
    else if (path.endsWith("/text"))
      result = {
        content: "service: remoter\nreplicas: 3\n",
        version: "fixture",
      };
    else if (path === "/ai/tasks") result = [];
    else if (path === "/ai/settings")
      result = {
        source: "byok",
        baseUrl: "https://api.example.com/v1",
        model: "ops-model",
        completionModel: "ops-model",
        hasKey: true,
      };
    else if (path === "/ai/usage")
      result = { balance: 100000, records: [], subscriptionAvailable: true };
    else if (path === "/billing/config")
      result = { enabled: false, creditsPerPeriod: 100000, hasCustomer: false };
    await route.fulfill({ json: result });
  });
  const inputs: string[] = [];
  await page.routeWebSocket("**/terminal", (ws) => {
    ws.onMessage((message) => {
      const data = JSON.parse(String(message));
      if (data.type === "input") inputs.push(data.data);
    });
    ws.send(
      Buffer.from(
        "\x1b[32mdevops@production\x1b[0m:~$ uptime\r\n 23:14:08 up 42 days,  load average: 0.24, 0.31, 0.28\r\n\r\n\x1b[32mdevops@production\x1b[0m:~$ ",
      ),
    );
  });
  await page.routeWebSocket("**/metrics", (ws) => {
    for (let i = 0; i < 60; i++)
      ws.send(
        JSON.stringify({
          time: Date.now() - (59 - i) * 1000,
          cpu: 24.8,
          cores: 8,
          system: "Ubuntu 24.04 LTS",
          uptime: 3628800,
          memoryTotal: 17179869184,
          memoryAvailable: 10737418240,
          swapTotal: 0,
          swapFree: 0,
          load: [0.24, 0.31, 0.28],
          disks: [
            { mount: "/", total: 107374182400, used: 42949672960 },
            {
              mount:
                "/var/lib/docker/overlay2/a-very-long-container-path/merged",
              total: 100,
              used: 30,
            },
          ],
          network: {
            eth0: {
              sent: i * 90000 + Math.sin(i * 0.4) * 10000,
              received: i * 240000 + Math.sin(i * 0.5) * 40000,
            },
            docker0: { sent: 0, received: 0 },
          },
        }),
      );
  });
  await page.goto("/");
  return inputs;
}
export async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth + 1 &&
        document.getElementById("root")!.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

export async function openGlobalAction(page: Page, name: string) {
  const toggle = page.locator(".global-menu-toggle");
  if (
    (await toggle.isVisible()) &&
    !(await page
      .locator(".global-actions")
      .evaluate((e) => e.classList.contains("open")))
  )
    await toggle.click();
  await page.getByRole("button", { name, exact: true }).click();
}
