import { useSyncExternalStore } from "react";
import { errors } from "./errors";
import { messages } from "./messages";
export type Locale = "zh-CN" | "ja" | "en";
export const localeNames: Record<Locale, string> = {
  "zh-CN": "中文",
  ja: "日本語",
  en: "English",
};
export const projectNames: Record<Locale, string> = {
  "zh-CN": "星",
  ja: "Hoshi",
  en: "Stellar",
};
const supported = (value: string | null): value is Locale =>
  value === "zh-CN" || value === "ja" || value === "en";
function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem("hoshi-locale");
    if (supported(saved)) return saved;
  } catch {
    /* Storage may be disabled. */
  }
  if (typeof navigator !== "undefined") {
    for (const language of navigator.languages || [navigator.language]) {
      if (language.startsWith("zh")) return "zh-CN";
      if (language.startsWith("ja")) return "ja";
      if (language.startsWith("en")) return "en";
    }
  }
  return "en";
}
let locale = initialLocale();
const listeners = new Set<() => void>();
export const getLocale = () => locale;
export const projectName = () => projectNames[locale];
export function useLocale() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getLocale,
    () => "zh-CN" as Locale,
  );
}
export function tr(key: string, values: readonly unknown[] = []): string {
  const entry = messages[key];
  const text = locale === "zh-CN" ? key : (entry?.[locale] ?? key);
  return text.replace(/\{(\d+)\}/g, (token, index) =>
    Number(index) < values.length ? String(values[Number(index)]) : token,
  );
}
export function number(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(locale, options).format(value);
}
export function dateTime(value: string | number | Date) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
export function syncDocumentLocale() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.documentElement.dataset.locale = locale;
  document.title = `${projectName()} SSH`;
  document
    .querySelector('meta[name="application-name"]')
    ?.setAttribute("content", projectName());
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute(
      "content",
      `${projectName()} — ${tr("你的主机、文件与下一步操作，在此相连。")}`,
    );
}
export function setLocale(value: Locale) {
  if (!supported(value) || value === locale) return;
  locale = value;
  try {
    localStorage.setItem("hoshi-locale", value);
  } catch {
    /* In-memory switching remains available. */
  }
  syncDocumentLocale();
  listeners.forEach((listener) => listener());
}
const taskStatusKeys: Record<string, string> = {
  planned: "待确认",
  running: "执行中",
  complete: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
  reserved: "已预占",
  settled: "已结算",
  refunded: "已退回",
  subscription: "平台订阅",
  byok: "自带密钥 BYOK",
};
export const statusLabel = (status: string) =>
  tr(taskStatusKeys[status] ?? status);

/** Localize known application errors, preserving unknown remote diagnostics verbatim. */
export function errorText(value: string) {
  const known = errors[value];
  if (known) return known[locale];
  if (messages[value]) return tr(value);
  for (const [key, variants] of Object.entries(messages))
    if (Object.values(variants).includes(value)) return tr(key);
  for (const variants of Object.values(errors))
    if (Object.values(variants).includes(value)) return variants[locale];
  return value;
}
