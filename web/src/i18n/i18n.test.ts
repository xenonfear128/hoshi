import { describe, it, expect, afterEach } from "vitest";
import { messages } from "./messages";
import {
  setLocale,
  tr,
  projectName,
  errorText,
  dateTime,
  number,
} from "./index";
afterEach(() => setLocale("zh-CN"));
describe("three-language UI", () => {
  it("keeps all interpolation placeholders in both translations", () => {
    const placeholders = (text: string) =>
      [...text.matchAll(/\{\d+\}/g)].map((x) => x[0]).sort();
    for (const [source, values] of Object.entries(messages))
      for (const [language, text] of Object.entries(values)) {
        expect(text.trim(), source + language).not.toBe("");
        expect(placeholders(text), source + language).toEqual(
          placeholders(source),
        );
      }
  });
  it("uses exactly one project name for the selected locale", () => {
    for (const [locale, name] of [
      ["zh-CN", "星"],
      ["ja", "Hoshi"],
      ["en", "Stellar"],
    ] as const) {
      setLocale(locale);
      expect(projectName()).toBe(name);
    }
  });
  it("does not interpret user interpolation as another placeholder or HTML", () => {
    setLocale("en");
    expect(
      tr("删除 {0}？不可撤销，目录必须为空。", ["<script>{1}</script>"]),
    ).toContain("<script>{1}</script>");
  });
  it("localizes known errors after switching while preserving remote diagnostics", () => {
    setLocale("en");
    const english = errorText("invalid email or password");
    setLocale("ja");
    expect(errorText(english)).toBe(
      "メールアドレスまたはパスワードが正しくありません",
    );
    expect(errorText("remote: /srv/星.txt: EIO")).toBe(
      "remote: /srv/星.txt: EIO",
    );
  });
  it("formats dates and quantities with the active locale", () => {
    setLocale("en");
    expect(number(12345)).toBe("12,345");
    expect(dateTime("2026-09-10T10:00:00Z")).toContain("Sep");
    setLocale("ja");
    expect(dateTime("2026-09-10T10:00:00Z")).not.toContain("Sep");
  });
});
