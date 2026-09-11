import { test, expect } from "@playwright/test";
import { fixture } from "./fixtures";
test("per-corner glass keeps square bottom corners without a second rim", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // @ts-ignore Vite serves the source module for this optical check.
    const { GlassRenderer } = await import("/src/glass/renderer.ts");
    const r = new GlassRenderer(),
      c = document.createElement("canvas");
    try {
      r.backdrop(innerWidth, innerHeight, false);
      r.draw(c, new DOMRect(0, 0, 300, 60), [16, 16, 0, 0], false, 0.24);
      const ctx = c.getContext("2d")!;
      const x = Math.floor((c.width / 300) * 2),
        y = Math.floor((c.height / 60) * 2);
      return {
        top: ctx.getImageData(x, y, 1, 1).data[3],
        bottom: ctx.getImageData(x, c.height - y - 1, 1, 1).data[3],
        error: r.gl.getError(),
      };
    } finally {
      r.dispose();
    }
  });
  expect(result).toEqual({ top: 0, bottom: 255, error: 0 });
});
for (const locale of ["zh-CN", "ja", "en"])
  test(`local font loads ${locale}`, async ({ page }) => {
    await page.addInitScript(
      (l) => localStorage.setItem("hoshi-locale", l),
      locale,
    );
    await fixture(page);
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(async () => {
      const cjk =
        document.documentElement.lang === "ja"
          ? "Noto Sans JP Variable"
          : "Noto Sans SC Variable";
      const names = ["Geist Variable", cjk, "JetBrains Mono Variable"];
      return await Promise.all(
        names.map(async (name) => ({
          name,
          count: (
            await document.fonts.load(
              `14px "${name}"`,
              name.startsWith("Noto")
                ? "星主机日本語"
                : "Stellar SSH 0123456789",
            )
          ).length,
        })),
      );
    });
    for (const f of result) expect(f.count, f.name).toBeGreaterThan(0);
    await expect(page.locator("html")).toHaveCSS(
      "font-family",
      /Geist Variable/,
    );
  });
