import { test, expect } from "@playwright/test";

test("frosted glass has no medial-axis lighting seam and redraws deterministically", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    // Vite module import exercises the actual renderer, with a deliberately
    // uniform backdrop so background detail cannot hide lighting seams.
    // @ts-expect-error Runtime URL supplied by the local Vite server.
    const { GlassRenderer } = await import("/src/glass/renderer.ts");
    const renderer = new GlassRenderer();
    const output = [];
    try {
      for (const [w, h, radius] of [
        [370, 56, 20],
        [370, 60, 20],
        [320, 240, 28],
      ]) {
        renderer.backdrop(innerWidth, innerHeight, false);
        const scene = renderer.scene as HTMLCanvasElement;
        const ctx = scene.getContext("2d")!;
        ctx.fillStyle = "#506070";
        ctx.fillRect(0, 0, scene.width, scene.height);
        const target = document.createElement("canvas");
        const rect = new DOMRect(20, 20, w, h);
        const draw = () => {
          renderer.backdrop(innerWidth, innerHeight, false);
          renderer.draw(target, rect, radius, false, 0.5);
          return target
            .getContext("2d")!
            .getImageData(0, 0, target.width, target.height).data;
        };
        const first = draw();
        let spread = 0;
        const channelRanges = [0, 1, 2].map((channel) => {
          const values = [];
          // Include the diagonal junctions of the centerline as well as its middle.
          const inset = Math.max(12, Math.ceil(radius * 0.75));
          for (let y = inset; y < h - inset; y++) {
            for (let x = inset; x < w - inset; x++)
              values.push(first[(y * target.width + x) * 4 + channel]);
          }
          return Math.max(...values) - Math.min(...values);
        });
        spread = Math.max(...channelRanges);
        const second = draw();
        let drift = 0;
        for (let i = 0; i < first.length; i++)
          drift = Math.max(drift, Math.abs(first[i] - second[i]));
        const center =
          (Math.floor(h / 2) * target.width + Math.floor(w / 2)) * 4;
        output.push({
          w,
          h,
          spread,
          drift,
          alpha: first[center + 3],
          error: renderer.gl.getError(),
        });
      }
    } finally {
      renderer.dispose();
    }
    return output;
  });
  for (const result of results) {
    expect(result, JSON.stringify(result)).toMatchObject({
      spread: 0,
      drift: 0,
      alpha: 255,
      error: 0,
    });
  }
});
