import { Select } from "./Select";
import { confirmAction, promptValue } from "./Dialogs";
import { errorText } from "./i18n";
import { tr, useLocale } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  body,
  bytes,
  wsURL,
  streamChat,
  type Connection,
  type Message,
} from "./api";
import Files from "./Files";
type Metrics = {
  source?: string;
  bootID?: string;
  agentStatus?: string;
  hostname?: string;
  system?: string;
  cores?: number;
  time: number;
  cpu: number | null;
  memoryTotal: number;
  memoryAvailable: number;
  swapTotal: number;
  swapFree: number;
  load: number[];
  network: Record<
    string,
    {
      received: number;
      sent: number;
    }
  >;
  disks: {
    mount: string;
    total: number;
    used: number;
  }[];
  uptime: number;
  error?: string;
};
type Sample = {
  time: number;
  up: number | null;
  down: number | null;
};
export default function Workspace({
  connection: c,
  theme,
  visible,
  reconnect,
}: {
  connection: Connection;
  theme: string;
  visible: boolean;
  reconnect: () => void;
}) {
  useLocale();
  const el = useRef<HTMLDivElement>(null),
    term = useRef<Terminal | null>(null),
    fit = useRef<FitAddon | null>(null),
    search = useRef<SearchAddon | null>(null),
    socket = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false),
    [error, setError] = useState(""),
    [ai, setAI] = useState(false),
    [assistantPresent, setAssistantPresent] = useState(false),
    [mobilePanel, setMobilePanel] = useState("terminal"),
    [ctrl, setCtrl] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [fontSize, setFontSize] = useState(
      Number(localStorage.getItem("terminal-font") || 14),
    ),
    [terminalAppearance, setTerminalAppearance] = useState(
      localStorage.getItem("terminal-theme") || "system",
    ),
    [fileHeight, setFileHeight] = useState(290),
    [filesOpen, setFilesOpen] = useState(true),
    [metrics, setMetrics] = useState<Metrics | null>(null),
    [iface, setIface] = useState(""),
    [diskMount, setDiskMount] = useState("/"),
    [samples, setSamples] = useState<Sample[]>([]),
    [windowMinutes, setWindowMinutes] = useState(1);
  const ctrlRef = useRef(false);
  ctrlRef.current = ctrl;
  const resolvedTheme =
    terminalAppearance === "system" ? theme : terminalAppearance;
  const previous = useRef<Metrics | null>(null),
    ifaceRef = useRef(iface);
  ifaceRef.current = iface;
  useEffect(() => {
    // Defer network side effects until StrictMode has completed its setup/cleanup probe.
    let dispose = () => {};
    const start = window.setTimeout(() => {
      const t = new Terminal({
        fontFamily:
          '"JetBrains Mono Variable", "Noto Sans SC Variable", monospace',
        fontSize,
        lineHeight: 1.35,
        cursorBlink: true,
        scrollback: 5000,
        allowProposedApi: false,
        theme: terminalTheme(resolvedTheme),
      });
      const f = new FitAddon(),
        s = new SearchAddon();
      t.loadAddon(f);
      t.loadAddon(s);
      t.open(el.current!);
      void document.fonts.load('14px "JetBrains Mono Variable"').then(() => {
        if (term.current !== t) return;
        t.clearTextureAtlas();
        f.fit();
        t.refresh(0, t.rows - 1);
      });
      term.current = t;
      fit.current = f;
      search.current = s;
      t.attachCustomKeyEventHandler((event) => {
        if (
          event.ctrlKey &&
          event.shiftKey &&
          event.key.toLowerCase() === "k"
        ) {
          if (event.type === "keydown") setAI((value) => !value);
          return false;
        }
        return true;
      });
      const ws = new WebSocket(wsURL(`/connections/${c.id}/terminal`));
      socket.current = ws;
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        setConnected(true);
        f.fit();
        ws.send(body({ type: "resize", cols: t.cols, rows: t.rows }));
        t.focus();
      };
      ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) t.write(new Uint8Array(e.data));
        else t.write(e.data);
      };
      ws.onclose = () => {
        setConnected(false);
        setError(tr("终端已断开。重连将建立新会话。"));
      };
      ws.onerror = () => setError(tr("终端连接失败"));
      const input = t.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          const value =
            ctrlRef.current && /^[a-z]$/i.test(data)
              ? String.fromCharCode(data.toUpperCase().charCodeAt(0) - 64)
              : data;
          ws.send(body({ type: "input", data: value }));
          if (ctrlRef.current) {
            ctrlRef.current = false;
            setCtrl(false);
          }
        }
      });
      const resize = t.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(body({ type: "resize", cols, rows }));
      });
      const paste = async (e: ClipboardEvent) => {
        const text = e.clipboardData?.getData("text/plain") || "";
        if (text.includes("\n") || text.includes("\r")) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (
            await confirmAction(
              tr("粘贴包含多行，可能执行多个命令。确认粘贴？\n\n{0}", [
                text.slice(0, 600),
              ]),
              tr("确认粘贴"),
              false,
            )
          )
            if (ws.readyState === WebSocket.OPEN) t.paste(text);
        }
      };
      const node = el.current!;
      node.addEventListener("paste", paste, true);
      const observer = new ResizeObserver(() => {
        if (node.offsetWidth > 0) f.fit();
      });
      observer.observe(node);
      dispose = () => {
        ws.onclose = null;
        ws.close();
        observer.disconnect();
        input.dispose();
        resize.dispose();
        node.removeEventListener("paste", paste, true);
        t.dispose();
        term.current = null;
        fit.current = null;
        search.current = null;
        socket.current = null;
      };
    }, 0);
    return () => {
      window.clearTimeout(start);
      dispose();
    };
  }, [c.id]);
  useEffect(() => {
    if (term.current) {
      term.current.options.theme = terminalTheme(resolvedTheme);
      term.current.options.fontSize = fontSize;
      fit.current?.fit();
    }
    localStorage.setItem("terminal-font", String(fontSize));
    localStorage.setItem("terminal-theme", terminalAppearance);
  }, [resolvedTheme, terminalAppearance, fontSize]);
  useEffect(() => {
    if (visible) setTimeout(() => fit.current?.fit(), 30);
  }, [visible, collapsed, filesOpen, mobilePanel]);
  useEffect(() => {
    if (ai) setAssistantPresent(true);
  }, [ai]);
  useEffect(() => {
    const ws = new WebSocket(wsURL(`/connections/${c.id}/metrics`));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data) as Metrics;
      setMetrics(m);
      if (
        previous.current?.time === m.time &&
        previous.current?.source === m.source
      )
        return;
      const names = Object.keys(m.network).filter((n) => n !== "lo");
      const n =
        ifaceRef.current ||
        names.find((name) => /^(eth|en|wl)/.test(name)) ||
        names.find((name) => !/^(docker|veth|br-|virbr)/.test(name)) ||
        names[0] ||
        "lo";
      if (!ifaceRef.current) {
        ifaceRef.current = n;
        setIface(n);
      }
      const p = previous.current,
        now = m.network[n],
        old = p?.network[n],
        dt = p ? (m.time - p.time) / 1000 : 0;
      const valid =
        now &&
        old &&
        dt > 0 &&
        dt < 10 &&
        p?.source === m.source &&
        p?.bootID === m.bootID &&
        !m.error &&
        now.sent >= old.sent &&
        now.received >= old.received;
      setSamples((s) =>
        [
          ...s,
          {
            time: m.time,
            up: valid ? (now.sent - old.sent) / dt : null,
            down: valid ? (now.received - old.received) / dt : null,
          },
        ].slice(-900),
      );
      previous.current = m;
    };
    ws.onclose = () =>
      setMetrics((m) => (m ? { ...m, error: tr("监控连接已断开") } : m));
    return () => ws.close();
  }, [c.id]);
  function insert(text: string) {
    if (/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(text)) {
      setError(tr("指令或路径包含控制字符，不能安全填入终端"));
      return;
    }
    if (socket.current?.readyState !== WebSocket.OPEN) {
      setError(tr("终端未连接"));
      return;
    }
    socket.current.send(body({ type: "input", data: text }));
    term.current?.focus();
  }
  function resizeFiles(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const y = e.clientY,
      h = fileHeight;
    const move = (ev: PointerEvent) =>
      setFileHeight(
        Math.min(window.innerHeight - 260, Math.max(150, h + y - ev.clientY)),
      );
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }
  const selectedDisk =
    metrics?.disks.find((d) => d.mount === diskMount) ?? metrics?.disks[0];
  const latest = samples.at(-1),
    mem =
      metrics && metrics.memoryTotal
        ? ((metrics.memoryTotal - metrics.memoryAvailable) /
            metrics.memoryTotal) *
          100
        : null;
  return (
    <div className="work-layout" data-mobile-panel={mobilePanel}>
      <div className="mobile-work-tabs" aria-label={tr("连接视图")}>
        {[
          ["terminal", tr("终端")],
          ["monitor", tr("监控")],
          ["files", tr("文件")],
        ].map(([value, label]) => (
          <button
            key={value}
            className={mobilePanel === value ? "selected" : ""}
            aria-pressed={mobilePanel === value}
            onClick={() => {
              setMobilePanel(value);
              if (value === "files") setFilesOpen(true);
              if (value === "monitor") setCollapsed(false);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {!collapsed && (
        <aside className="monitor">
          <div className="section-label">
            <span title={tr("主机概况")}>{c.host.name}</span>
            <button
              className="icon"
              title={tr("折叠监控")}
              onClick={() => setCollapsed(true)}
            >
              <ChevronLeft size={14} />
            </button>
          </div>
          <p
            className="small muted monitor-host-meta"
            title={`${c.host.address} · ${metrics?.system || ""}`}
          >
            {c.host.address}
            {" · "}
            {metrics?.system && (
              <>
                {metrics.system}
                {" · "}
              </>
            )}
            {metrics
              ? tr("运行 {0} 天", [Math.floor(metrics.uptime / 86400)])
              : tr("等待采集")}
          </p>
          <hr />
          <div className="section-label monitor-source">
            {tr("资源监控")}
            <span className="green small">
              {tr(metrics?.source === "agent" ? "探针数据" : "SSH 临时采集")}
            </span>
          </div>
          {metrics?.error && (
            <p className="small error" title={metrics.error}>
              {metrics.error}
            </p>
          )}
          {c.host.agentEnabled && metrics?.source !== "agent" && (
            <p className="small muted">
              {tr("探针暂无新数据，当前使用 SSH 临时采集。")}
            </p>
          )}
          <div className="monitor-resources">
            <Meter
              label={
                metrics?.cores ? tr("CPU / {0} 核", [metrics.cores]) : "CPU"
              }
              value={metrics?.error ? null : (metrics?.cpu ?? null)}
            />
            <Meter
              label={tr("内存")}
              value={metrics?.error ? null : mem}
              detail={
                metrics
                  ? `${bytes(metrics.memoryTotal - metrics.memoryAvailable)} / ${bytes(metrics.memoryTotal)}`
                  : "—"
              }
            />
          </div>
          <div className="metric-line">
            <span>Swap</span>
            <span>
              {metrics
                ? `${bytes(metrics.swapTotal - metrics.swapFree)} / ${bytes(metrics.swapTotal)}`
                : "—"}
            </span>
          </div>
          <div className="metric-line">
            <span>{tr("系统负载")}</span>
            <span>
              {metrics?.load.map((n) => n.toFixed(2)).join(" / ") || "—"}
            </span>
          </div>
          <hr />
          <div className="section-label">
            {tr("磁盘")}
            <Select
              aria-label={tr("磁盘挂载点")}
              value={selectedDisk?.mount ?? ""}
              onChange={(e) => setDiskMount(e.target.value)}
            >
              {metrics?.disks.map((d) => (
                <option key={d.mount} value={d.mount}>
                  {d.mount}
                </option>
              ))}
            </Select>
          </div>
          {selectedDisk && (
            <Meter
              label={tr("磁盘 {0}", [selectedDisk.mount])}
              value={
                selectedDisk.total
                  ? (selectedDisk.used / selectedDisk.total) * 100
                  : null
              }
              detail={`${bytes(selectedDisk.used)} / ${bytes(selectedDisk.total)}`}
            />
          )}
          <hr />
          <div className="section-label">
            {tr("网络")}
            <Select
              aria-label={tr("网卡")}
              value={iface}
              onChange={(e) => {
                ifaceRef.current = e.target.value;
                setIface(e.target.value);
                setSamples([]);
                previous.current = null;
              }}
            >
              {Object.keys(metrics?.network || {}).map((n) => (
                <option key={n}>{n}</option>
              ))}
            </Select>
          </div>
          <div className="network-value-row">
            <div className="network-value">
              <span>
                <ArrowUp size={13} />
                {tr("上传")}
              </span>
              <strong className="green">
                {bytes(latest?.up ?? NaN)}
                <small>/s</small>
              </strong>
            </div>
            <div className="network-value">
              <span>
                <ArrowDown size={13} />
                {tr("下载")}
              </span>
              <strong className="blue">
                {bytes(latest?.down ?? NaN)}
                <small>/s</small>
              </strong>
            </div>
          </div>
          <NetworkChart
            samples={samples}
            minutes={windowMinutes}
            theme={theme}
          />
          <div className="chart-range">
            {[1, 5, 15].map((n) => (
              <button
                key={n}
                className={windowMinutes === n ? "active" : ""}
                onClick={() => setWindowMinutes(n)}
              >
                {n}
                {tr("分钟")}
              </button>
            ))}
          </div>
          <p className="small muted monitor-totals">
            <span>
              {tr("网卡累计 ↑")}
              {bytes(metrics?.network[iface]?.sent ?? NaN)}
            </span>
            <span>
              {tr("网卡累计 ↓")}
              {bytes(metrics?.network[iface]?.received ?? NaN)}
            </span>
          </p>
        </aside>
      )}
      <section className="work-main">
        <div className="terminal-toolbar">
          {collapsed && (
            <button
              className="icon"
              title={tr("展开监控")}
              onClick={() => setCollapsed(false)}
            >
              <ChevronRight size={15} />
            </button>
          )}
          <span className={connected ? "dot" : "dot offline"} />
          <span>{connected ? tr("SSH 已连接") : tr("SSH 未连接")}</span>
          <span className="muted">
            {c.host.username}@{c.host.address}:{c.host.port}
          </span>
          <span className="grow" />
          <Select
            className="terminal-theme-picker"
            aria-label={tr("终端主题")}
            value={terminalAppearance}
            onChange={(e) => setTerminalAppearance(e.target.value)}
          >
            <option value="system">{tr("跟随主题")}</option>
            <option value="dark">{tr("深色终端")}</option>
            <option value="light">{tr("亮色终端")}</option>
          </Select>
          <Select
            aria-label={tr("终端字号")}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
          >
            {[12, 13, 14, 16, 18, 20].map((n) => (
              <option key={n} value={n}>
                {n}px
              </option>
            ))}
          </Select>
          <button
            className="subtle"
            onClick={async () => {
              const q = await promptValue(tr("搜索终端内容"));
              if (q) search.current?.findNext(q);
            }}
          >
            <Search size={14} />
            {tr("搜索")}
          </button>
          <button className="subtle" onClick={() => term.current?.clear()}>
            {tr("清屏")}
          </button>
          <button
            className={ai ? "subtle green" : "subtle"}
            onClick={() => setAI(!ai)}
          >
            <Sparkles size={15} />
            {tr("命令助手")}
          </button>
        </div>
        {error && (
          <div className="connection-error">
            {errorText(error)}
            <button onClick={reconnect}>{tr("重连")}</button>
            <button className="icon" onClick={() => setError("")}>
              <X size={13} />
            </button>
          </div>
        )}
        <div
          className="terminal-area"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("text/plain")) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const value = e.dataTransfer.getData("text/plain");
            if (value) insert(value);
          }}
        >
          <div
            className="terminal-mount"
            ref={el}
            style={{
              background: resolvedTheme === "dark" ? "#0d0e12" : "#ffffff",
            }}
          />
          {assistantPresent && (
            <CommandAssistant
              insert={insert}
              open={ai}
              close={() => setAI(false)}
              onClosed={() => setAssistantPresent(false)}
            />
          )}
        </div>
        <div className="terminal-keys" aria-label={tr("终端快捷键")}>
          <button
            className={ctrl ? "selected" : ""}
            aria-pressed={ctrl}
            onClick={() => {
              setCtrl(!ctrl);
              term.current?.focus();
            }}
          >
            Ctrl
          </button>
          {[
            ["Esc", "\x1b"],
            ["Tab", "\t"],
            ["↑", "\x1b[A"],
            ["↓", "\x1b[B"],
            ["←", "\x1b[D"],
            ["→", "\x1b[C"],
            ["Ctrl+C", "\x03"],
          ].map(([label, data]) => (
            <button
              key={label}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                if (socket.current?.readyState === WebSocket.OPEN)
                  socket.current.send(body({ type: "input", data }));
                term.current?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          className="resize-handle"
          onPointerDown={resizeFiles}
          role="separator"
          aria-label={tr("调整文件面板高度")}
        />
        <div
          className="files-region"
          style={{ height: filesOpen ? fileHeight : 43 }}
        >
          <Files
            connection={c}
            theme={theme}
            insert={insert}
            open={filesOpen}
            toggle={() => setFilesOpen(!filesOpen)}
          />
        </div>
        <div className="statusbar">
          <ShieldCheck size={12} />
          <span>{tr("主机指纹已验证")}</span>
          <span className="grow" />
          <span>UTF-8</span>
          <span>xterm-256color</span>
          <button className="subtle" onClick={() => setFilesOpen(!filesOpen)}>
            {filesOpen ? <ChevronDown size={12} /> : <Maximize2 size={12} />}
            {tr("文件面板")}
          </button>
        </div>
      </section>
    </div>
  );
}
function terminalTheme(theme: string) {
  return theme === "dark"
    ? {
        background: "#0d0e12",
        foreground: "#e5e7ec",
        cursor: "#c7d2fe",
        selectionBackground: "#7d859650",
      }
    : {
        background: "#ffffff",
        foreground: "#242630",
        cursor: "#535e95",
        selectionBackground: "#c9cee580",
      };
}
function Meter({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | null;
  detail?: string;
}) {
  useLocale();
  return (
    <div className="meter">
      <div>
        <span title={label}>{label}</span>
        <strong>
          {value === null ? "—" : value.toFixed(1)}
          <small>{value !== null ? "%" : ""}</small>
        </strong>
      </div>
      <div className="meter-track">
        <i style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} />
      </div>
      {detail && <p>{detail}</p>}
    </div>
  );
}
function NetworkChart({
  samples,
  minutes,
  theme,
}: {
  samples: Sample[];
  minutes: number;
  theme: string;
}) {
  useLocale();
  const el = useRef<HTMLDivElement>(null),
    chart = useRef<echarts.EChartsType | null>(null);
  useEffect(() => {
    chart.current = echarts.init(el.current!);
    const o = new ResizeObserver(() => chart.current?.resize());
    o.observe(el.current!);
    return () => {
      o.disconnect();
      chart.current?.dispose();
    };
  }, []);
  useEffect(() => {
    const start = Date.now() - minutes * 60000;
    const filtered = samples.filter((s) => s.time >= start);
    const colors =
      theme === "dark" ? ["#a4add8", "#9ebdc5"] : ["#536398", "#466f7b"];
    chart.current?.setOption(
      {
        animation: false,
        grid: { left: 2, right: 3, top: 7, bottom: 22 },
        tooltip: {
          trigger: "axis",
          renderMode: "richText",
          valueFormatter: (v: unknown) => bytes(Number(v)) + "/s",
        },
        xAxis: {
          type: "time",
          min: start,
          max: Date.now(),
          axisLine: { show: false },
          axisTick: { show: false },
          splitNumber: 2,
          axisLabel: {
            color: theme === "dark" ? "#9b9daa" : "#696d7c",
            fontSize: 11,
            formatter: "{HH}:{mm}:{ss}",
            hideOverlap: true,
          },
        },
        yAxis: {
          type: "value",
          min: 0,
          axisLabel: { show: false },
          splitNumber: 2,
          splitLine: {
            lineStyle: {
              color: theme === "dark" ? "#2b2d37" : "#e0e1e7",
              type: "dashed",
            },
          },
        },
        series: (["up", "down"] as const).map((direction, index) => ({
          type: "line",
          name: direction === "up" ? tr("上传") : tr("下载"),
          data: filtered.map((s) => [s.time, s[direction]]),
          smooth: 0.25,
          smoothMonotone: "x",
          connectNulls: false,
          showSymbol: false,
          lineStyle: { color: colors[index], width: 1.7 },
          areaStyle: { color: colors[index], opacity: 0.07 },
        })),
      },
      true,
    );
  }, [samples, minutes, theme]);
  const filtered = samples.filter((s) => s.time > Date.now() - minutes * 60000);
  const values = (direction: "up" | "down") =>
    filtered.map((s) => s[direction]).filter((n): n is number => n !== null);
  return (
    <>
      <div className="network-chart" ref={el} />
      <div className="network-stats">
        {(["up", "down"] as const).map((direction) => {
          const current = values(direction);
          return (
            <span key={direction}>
              {direction === "up" ? "↑" : "↓"} {tr("峰值")}{" "}
              {bytes(current.length ? Math.max(...current) : NaN)}/s
            </span>
          );
        })}
      </div>
    </>
  );
}
function CommandAssistant({
  insert,
  open,
  close,
  onClosed,
}: {
  insert: (s: string) => void;
  open: boolean;
  close: () => void;
  onClosed: () => void;
}) {
  useLocale();
  const [messages, setMessages] = useState<Message[]>([]),
    [input, setInput] = useState(""),
    [mode, setMode] = useState("natural"),
    [context, setContext] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const closedOnce = useRef(false);
  useEffect(() => {
    if (open) closedOnce.current = false;
  }, [open]);
  const latest =
    messages.filter((x) => x.role === "assistant").at(-1)?.content || "";
  const block = latest.match(/```(?:bash|sh|shell)?\s*\n([^]*?)```/);
  const command = block?.[1].trim() || "";
  return (
    <section
      className={`command-assistant${open ? "" : " is-closing"}`}
      onAnimationEnd={(event) => {
        if (
          !open &&
          event.animationName === "assistant-out" &&
          !closedOnce.current
        ) {
          closedOnce.current = true;
          onClosed();
        }
      }}
    >
      <header>
        <Sparkles size={16} />
        <strong>{tr("AI 命令助手")}</strong>
        <Select
          aria-label={tr("命令辅助模式")}
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="natural">{tr("自然语言 → 单行指令")}</option>
          <option value="prefix">{tr("补全命令前缀")}</option>
          <option value="explain">{tr("解释或修正命令")}</option>
        </Select>
        <span className="grow" />
        <button className="icon" onClick={close} title={tr("关闭助手")}>
          <X size={15} />
        </button>
      </header>
      {latest && <div className="assistant-answer">{latest}</div>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!input.trim() || busy) return;
          setBusy(true);
          setError("");
          const next: Message[] = [
            ...messages,
            {
              role: "user",
              content:
                (mode === "prefix"
                  ? tr("请补全下面的命令前缀，输出完整单行命令：\n")
                  : mode === "explain"
                    ? tr("请解释或修正下面的命令：\n")
                    : "") + input,
            },
          ];
          setMessages(next);
          setInput("");
          try {
            await streamChat(next.slice(-18), context, (text) =>
              setMessages([...next, { role: "assistant", content: text }]),
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="assistant-input">
          <input
            aria-label={tr("自然语言指令")}
            placeholder={
              mode === "natural"
                ? tr("例如：查找 /var/log 下超过 100 MB 的日志文件")
                : mode === "prefix"
                  ? tr("输入命令前缀，例如 docker logs --")
                  : tr("输入需要解释或修正的命令")
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button disabled={busy || !input.trim()} title={tr("生成指令")}>
            <Send size={16} />
          </button>
        </div>
        <details>
          <summary>{tr("选择发送的上下文（默认不读取终端历史）")}</summary>
          <textarea
            placeholder={tr("粘贴需要分析的输出，发送前请确认不含敏感数据")}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={2}
          />
        </details>
        {error && <p className="error small">{errorText(error)}</p>}
        <footer>
          <span className="small muted">
            {busy
              ? tr("正在生成…")
              : tr("使用 AI 设置中的来源，接受后填入，不自动执行。")}
          </span>
          <span className="grow" />
          {command && !/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(command) && (
            <button
              type="button"
              className="primary"
              onClick={() => insert(command)}
            >
              {tr("填入终端 ⇥")}
            </button>
          )}
        </footer>
      </form>
    </section>
  );
}
