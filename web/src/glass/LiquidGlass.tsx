import { useEffect } from "react";
import { GlassRenderer } from "./renderer";
const surfaces = [
  ".nav",
  ".modal",
  ".login-form",
  ".command-assistant",
  ".mobile-navigation",
  ".host-card",
  ".ai-banner",
  ".session-tabs",
  ".monitor",
  ".mobile-work-tabs",
  ".terminal-keys",
  ".files-region",
  ".ai-request",
  ".task-history",
  ".transfer-row",
].join(",");

const materialFor = (node: HTMLElement) => {
  if (node.matches(".nav,.mobile-navigation")) return 0.15;
  if (node.matches(".modal,.login-form")) return 0.82;
  if (node.matches(".command-assistant,.ai-request")) return 0.62;
  if (node.matches(".host-card,.ai-banner")) return 0.42;
  if (node.matches(".monitor,.files-region,.task-history")) return 0.3;
  if (node.matches(".session-tabs,.mobile-work-tabs")) return 0.24;
  if (node.matches(".terminal-keys,.transfer-row")) return 0.22;
  return 0.35;
};

export default function LiquidGlass() {
  useEffect(() => {
    const nodes = new Map<
      HTMLElement,
      { canvas: HTMLCanvasElement; key: string }
    >();
    let renderer: GlassRenderer | null = null;
    let frame = 0,
      timer = 0,
      stopped = false;
    let pressedButton: HTMLElement | null = null;
    const forced = matchMedia("(forced-colors: active)");
    const clean = () => {
      nodes.forEach(({ canvas }, node) => {
        canvas.remove();
        node.classList.remove("glass-ready");
      });
      nodes.clear();
      renderer?.dispose();
      renderer = null;
    };
    const draw = () => {
      frame = 0;
      if (stopped || document.hidden || forced.matches) return;
      try {
        renderer ||= new GlassRenderer();
        const light = document.documentElement.dataset.theme === "light";
        renderer.backdrop(innerWidth, innerHeight, light);
        nodes.forEach((entry, node) => {
          const rect = node.getBoundingClientRect();
          if (
            !rect.width ||
            !rect.height ||
            rect.bottom < 0 ||
            rect.top > innerHeight ||
            rect.right < 0 ||
            rect.left > innerWidth
          )
            return;
          const style = getComputedStyle(node);
          const radii = [
            style.borderTopLeftRadius,
            style.borderTopRightRadius,
            style.borderBottomRightRadius,
            style.borderBottomLeftRadius,
          ].map((value) => parseFloat(value) || 0) as [
            number,
            number,
            number,
            number,
          ];
          const radius = radii[0];
          const openBottom =
            node.matches(".modal") &&
            radius > 0 &&
            parseFloat(style.borderBottomLeftRadius) === 0 &&
            parseFloat(style.borderBottomRightRadius) === 0;
          const key = [
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            innerWidth,
            innerHeight,
            devicePixelRatio,
            light,
            ...radii,
            openBottom,
          ].join(":");
          const stateKey = `${key}:${node.dataset.glassState || "idle"}`;
          if (stateKey === entry.key) return;
          const pressed = node.dataset.glassState === "pressed";
          const material = Math.min(1, materialFor(node) + (pressed ? 0.1 : 0));
          renderer!.draw(
            entry.canvas,
            rect,
            radii,
            light,
            material,
            openBottom,
          );
          entry.key = stateKey;
          node.classList.add("glass-ready");
        });
        document.documentElement.dataset.glass = "webgl";
      } catch {
        stopped = true;
        clean();
        document.documentElement.dataset.glass = "fallback";
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const resize = new ResizeObserver(schedule);
    const scan = () => {
      if (stopped) return;
      nodes.forEach(({ canvas }, node) => {
        if (!node.isConnected) {
          resize.unobserve(node);
          canvas.remove();
          nodes.delete(node);
        }
      });
      document.querySelectorAll<HTMLElement>(surfaces).forEach((node) => {
        if (nodes.has(node)) return;
        const canvas = document.createElement("canvas");
        canvas.className = "glass-canvas";
        canvas.setAttribute("aria-hidden", "true");
        node.prepend(canvas);
        nodes.set(node, { canvas, key: "" });
        resize.observe(node);
        const redraw = () => schedule();
        node.addEventListener("pointerdown", () => {
          node.dataset.glassState = "pressed";
          redraw();
        });
        node.addEventListener("pointerup", () => {
          delete node.dataset.glassState;
          redraw();
        });
        node.addEventListener("pointercancel", () => {
          delete node.dataset.glassState;
          redraw();
        });
      });
      schedule();
    };
    // 事件 target 不一定是 Element：pointerleave 离开文档时 target 为
    // document，且监听挂在 document 的捕获阶段。缺少运行时检查会对
    // document 调用 closest 并抛 TypeError。
    const asElement = (target: EventTarget | null): Element | null =>
      target instanceof Element ? target : null;
    const press = (event: PointerEvent) => {
      const button = asElement(event.target)?.closest<HTMLElement>(
        "button:not(:disabled)",
      );
      if (button) {
        pressedButton = button;
        button.dataset.pressed = "true";
      }
    };
    const release = (event: PointerEvent) => {
      const button =
        pressedButton ||
        asElement(event.target)?.closest<HTMLElement>("button");
      if (!button) return;
      pressedButton = null;
      delete button.dataset.pressed;
      if (event.type === "pointerup") {
        button.dataset.release = "true";
        window.setTimeout(() => delete button.dataset.release, 700);
      }
    };
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          (r) =>
            r.type === "attributes" ||
            [...r.addedNodes, ...r.removedNodes].some(
              (n) =>
                n instanceof HTMLElement &&
                !n.matches(".glass-canvas") &&
                (n.matches(surfaces) || n.querySelector(surfaces)),
            ),
        )
      )
        scan();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const scroll = () => {
      clearTimeout(timer);
      timer = window.setTimeout(schedule, 80);
    };
    const visibility = () => {
      if (!document.hidden) {
        scan();
        schedule();
      }
    };
    const change = () => {
      clean();
      stopped = false;
      if (forced.matches) document.documentElement.dataset.glass = "fallback";
      else scan();
    };
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    document.addEventListener("pointerleave", release, true);
    document.addEventListener("scroll", scroll, true);
    document.addEventListener("visibilitychange", visibility);
    forced.addEventListener("change", change);
    scan();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
      document.removeEventListener("pointerleave", release, true);
      document.removeEventListener("scroll", scroll, true);
      document.removeEventListener("visibilitychange", visibility);
      forced.removeEventListener("change", change);
      clean();
      delete document.documentElement.dataset.glass;
    };
  }, []);
  return (
    <div className="ambient-scene" aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  );
}
