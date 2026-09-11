/* Streams downloads to the browser without buffering entire files in memory.
   Each transfer is initiated by a same-origin page and keyed by a random ID. */
const transfers = new Map();
self.addEventListener("install", (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("message", (event) => {
  const data = event.data,
    port = event.ports[0];
  if (
    !port ||
    !data ||
    data.type !== "download" ||
    !/^[-a-f0-9]{36}$/.test(data.id) ||
    !event.source?.url ||
    new URL(event.source.url).origin !== self.location.origin
  )
    return;
  let controller, pending, timeout;
  const cleanup = () => {
    clearTimeout(timeout);
    transfers.delete(data.id);
    pending?.();
    pending = null;
  };
  const arm = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      try {
        controller.error(new Error("Transfer timed out"));
      } catch {}
      port.postMessage({ type: "cancel" });
      cleanup();
      port.close();
    }, 30000);
  };
  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      arm();
      return new Promise((resolve) => {
        pending = resolve;
        port.postMessage({ type: "pull" });
      });
    },
    cancel() {
      port.postMessage({ type: "cancel" });
      cleanup();
      port.close();
    },
  });
  port.onmessage = (event) => {
    const msg = event.data;
    arm();
    try {
      if (msg.type === "chunk") {
        controller.enqueue(new Uint8Array(msg.data));
        pending?.();
        pending = null;
      } else if (msg.type === "done") {
        controller.close();
        port.postMessage({ type: "finished" });
        cleanup();
        port.close();
      } else if (msg.type === "error") {
        controller.error(new Error("Transfer interrupted"));
        cleanup();
        port.close();
      }
    } catch {
      cleanup();
      port.close();
    }
  };
  port.start();
  transfers.set(data.id, { stream, name: String(data.name).slice(0, 255) });
  arm();
  port.postMessage({ type: "ready" });
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    url.origin !== self.location.origin ||
    !url.pathname.startsWith("/__remoter_download/")
  )
    return;
  const id = url.pathname.slice("/__remoter_download/".length),
    transfer = transfers.get(id);
  if (!transfer) {
    event.respondWith(new Response("Transfer expired", { status: 404 }));
    return;
  }
  transfers.delete(id);
  const name = encodeURIComponent(transfer.name).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  event.respondWith(
    new Response(transfer.stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": "attachment; filename*=UTF-8''" + name,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    }),
  );
});
