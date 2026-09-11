import { tr } from "./i18n";
export async function downloadStream(
  url: string,
  name: string,
  signal: AbortSignal,
  progress: (loaded: number, total: number) => void,
): Promise<void> {
  if (!("serviceWorker" in navigator))
    throw new Error(tr("此浏览器不支持流式下载，请使用浏览器直接下载"));
  await navigator.serviceWorker.register("/transfer-worker.js");
  const registration = await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          changed,
        );
        reject(new Error(tr("下载服务启动超时，请刷新页面")));
      }, 10000);
      const changed = () => {
        clearTimeout(timer);
        resolve();
      };
      navigator.serviceWorker.addEventListener("controllerchange", changed, {
        once: true,
      });
    });
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const result = await response
      .json()
      .catch(() => ({ error: tr("下载请求失败") }));
    throw new Error(result.error);
  }
  if (!response.body) throw new Error(tr("浏览器未提供下载流"));
  const reader = response.body.getReader(),
    total = Number(response.headers.get("Content-Length") || 0),
    id = crypto.randomUUID(),
    channel = new MessageChannel(),
    frame = document.createElement("iframe");
  frame.hidden = true;
  let loaded = 0;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      channel.port1.close();
      setTimeout(() => frame.remove(), 1000);
    };
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        void reader.cancel().catch(() => {});
        reject(error);
      } else resolve();
    };
    const abort = () => {
      channel.port1.postMessage({ type: "error" });
      finish(new DOMException(tr("下载已取消"), "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    channel.port1.onmessage = async (event) => {
      try {
        const message = event.data;
        if (message.type === "ready") {
          frame.src = "/__remoter_download/" + id;
          document.body.append(frame);
        } else if (message.type === "pull") {
          const { done, value } = await reader.read();
          if (done) {
            channel.port1.postMessage({ type: "done" });
          } else {
            loaded += value.byteLength;
            progress(loaded, total);
            const data = value.buffer.slice(
              value.byteOffset,
              value.byteOffset + value.byteLength,
            );
            channel.port1.postMessage({ type: "chunk", data }, [data]);
          }
        } else if (message.type === "finished") {
          finish();
        } else if (message.type === "cancel") {
          finish(new DOMException(tr("浏览器已取消下载"), "AbortError"));
        }
      } catch (e) {
        channel.port1.postMessage({ type: "error" });
        finish(e);
      }
    };
    registration.active!.postMessage({ type: "download", id, name }, [
      channel.port2,
    ]);
  });
}
