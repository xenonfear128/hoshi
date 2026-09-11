import { tr, errorText, getLocale } from "./i18n";
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const r = await fetch("/api" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": getLocale(),
      ...options.headers,
    },
    credentials: "same-origin",
  });
  const data = await r.json().catch(() => ({ error: tr("服务器响应无效") }));
  if (!r.ok) {
    if (r.status === 401) window.dispatchEvent(new Event("session-expired"));
    throw new APIError(errorText(data.error || tr("请求失败")), r.status);
  }
  return data;
}
export const body = (v: unknown) => JSON.stringify(v);
export function wsURL(path: string) {
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api${path}`;
}
export function bytes(n: number) {
  if (!Number.isFinite(n) || n < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < 4) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}
export const shellQuote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export type Host = {
  id: string;
  name: string;
  address: string;
  port: number;
  username: string;
  group: string;
  note: string;
  authType: "password" | "key";
  hasCredential: boolean;
  fingerprint: string;
  agentEnabled?: boolean;
  agentStatus?: string;
};
export type Connection = {
  id: string;
  host: Host;
};
export type AISettings = {
  source: "byok" | "subscription";
  baseUrl: string;
  model: string;
  completionModel: string;
  hasKey: boolean;
  apiKey?: string;
  clearKey?: boolean;
};
export type Message = {
  role: "user" | "assistant";
  content: string;
};
export async function streamChat(
  messages: Message[],
  context: string,
  onContent: (text: string) => void,
): Promise<string> {
  const response = await fetch("/api/ai/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: body({ messages, context }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new APIError(
      errorText(data.error || tr("AI 请求失败")),
      response.status,
    );
  }
  const reader = response.body!.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    result = "",
    finished = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const event = block.match(/event: (.+)/)?.[1],
        raw = block.match(/data: (.+)/)?.[1];
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (event === "error") throw new Error(errorText(data.error));
      if (event === "content" || event === "done") {
        result = data.content;
        onContent(result);
      }
      if (event === "done") finished = true;
    }
  }
  if (!finished) throw new Error(tr("AI 响应中断，请重试"));
  return result;
}
