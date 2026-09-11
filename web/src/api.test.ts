import { setLocale } from "./i18n";
beforeEach(() => setLocale("zh-CN"));
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { shellQuote, bytes, streamChat } from "./api";
afterEach(() => vi.unstubAllGlobals());
describe("shell path handling", () => {
  it("preserves metacharacters as literal data", () => {
    const paths = [
      "/tmp/a b; echo UNSAFE",
      "/tmp/$(printf INJECTED)",
      "/tmp/a'b\"c",
      "/tmp/中文\nfile",
    ];
    for (const path of paths) {
      const result = execFileSync(
        "/bin/sh",
        ["-c", `printf '%s' ${shellQuote(path)}`],
        { encoding: "utf8" },
      );
      expect(result).toBe(path);
    }
  });
  it("does not display unavailable network data as zero", () => {
    expect(bytes(NaN)).toBe("—");
    expect(bytes(0)).toBe("0 B");
    expect(bytes(1024)).toBe("1.0 KB");
  });
});
describe("AI stream client", () => {
  function mockStream(text: string) {
    const bytes = new TextEncoder().encode(text);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                for (let i = 0; i < bytes.length; i += 3)
                  controller.enqueue(bytes.slice(i, i + 3));
                controller.close();
              },
            }),
            { status: 200 },
          ),
      ),
    );
  }
  it("handles UTF-8 and fragmented event boundaries", async () => {
    mockStream(
      'event: content\ndata: {"content":"中文"}\n\nevent: done\ndata: {"content":"中文命令"}\n\n',
    );
    const updates: string[] = [];
    expect(
      await streamChat([{ role: "user", content: "测试" }], "", (s) =>
        updates.push(s),
      ),
    ).toBe("中文命令");
    expect(updates).toEqual(["中文", "中文命令"]);
  });
  it("rejects an interrupted stream", async () => {
    mockStream('event: content\ndata: {"content":"partial"}\n\n');
    await expect(
      streamChat([{ role: "user", content: "test" }], "", () => {}),
    ).rejects.toThrow("中断");
  });
  it("surfaces server errors without accepting output", async () => {
    mockStream('event: error\ndata: {"error":"insufficient credits"}\n\n');
    await expect(
      streamChat([{ role: "user", content: "test" }], "", () => {}),
    ).rejects.toThrow("insufficient credits");
  });
});
