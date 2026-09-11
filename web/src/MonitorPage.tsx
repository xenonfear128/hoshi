import { Select } from "./Select";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  RefreshCw,
  Download,
  Plus,
  Trash2,
} from "lucide-react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { api, body, bytes, type Host } from "./api";
import { tr, useLocale, dateTime, errorText } from "./i18n";
import { confirmAction } from "./Dialogs";
import PasswordInput from "./PasswordInput";
import {
  agentStatusLabel,
  defaultAgentSettings,
  trustForAgent,
  type AgentInfo,
  type AgentJob,
  type AgentSettings,
  type AlertSettings,
  type CheckTarget,
  type Credential,
  type Latest,
  type MonitorEvent,
  type Rollup,
  type Traffic,
} from "./monitoring";
import "./monitoring.css";
echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);
const tabs = ["概览", "网络", "历史", "事件", "探针设置"];
const pct = (v: number | null | undefined) =>
  v == null ? "—" : `${v.toFixed(1)}%`;
const size = (v: number | null | undefined) => (v == null ? "—" : bytes(v));
const metric = (l: Latest | null, k: string) => l?.values?.[k];
const defaultAlerts: AlertSettings = {
  enabled: true,
  offlineGraceSeconds: 180,
  durationSeconds: 60,
  recoverySeconds: 30,
  cooldownSeconds: 300,
  hysteresisPercent: 5,
  cpuPercent: 0,
  memoryPercent: 0,
  diskPercent: 0,
  muteUntil: null,
  hasWebhook: false,
};
function Chart({
  points,
  series,
  unit = "%",
  bit = false,
}: {
  points: Rollup[];
  series: { name: string; keys: string[] }[];
  unit?: string;
  bit?: boolean;
}) {
  const locale = useLocale();
  const seriesKey = JSON.stringify(series);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const factor = bit ? 8 : 1;
    const styles = getComputedStyle(document.documentElement);
    const color = styles.getPropertyValue("--muted").trim() || "#858a9c";
    const format = (n: number) =>
      unit === "B/s"
        ? bit
          ? `${(n / 1e6).toFixed(2)} Mbit/s`
          : `${bytes(n)}/s`
        : `${Number(n.toFixed(2))}${unit}`;
    chart.setOption({
      animationDuration: 350,
      color: ["#74a5de", "#ac9add", "#88bda6"],
      grid: { left: 68, right: 16, top: 35, bottom: 35 },
      legend: { textStyle: { color }, top: 0 },
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: unknown) => (v == null ? "—" : format(Number(v))),
      },
      xAxis: {
        type: "time",
        axisLabel: { color, hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: unit === "%" ? 100 : undefined,
        axisLabel: { color, formatter: format },
        splitLine: {
          lineStyle: {
            color: styles.getPropertyValue("--line").trim() || "#7772",
          },
        },
      },
      series: series.map((s) => ({
        name: s.name,
        type: "line",
        showSymbol: false,
        smooth: 0.25,
        smoothMonotone: "x",
        connectNulls: false,
        lineStyle: { width: 2 },
        data: points.map((p) => {
          const stats = s.keys.map((k) => p.metrics?.[k]);
          const valid =
            p.count > 0 &&
            !p.gap &&
            stats.length > 0 &&
            stats.every((v) => v?.count > 0);
          return [
            Date.parse(p.time),
            valid
              ? stats.reduce((sum, v) => sum + v.average, 0) * factor
              : null,
          ];
        }),
      })),
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [points, seriesKey, unit, bit, locale]);
  return (
    <div
      ref={ref}
      className="monitor-chart"
      role="img"
      aria-label={series.map((s) => s.name).join(" / ")}
    />
  );
}
function Card({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="monitor-value">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}
function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <div className="monitor-table">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="muted">{tr("暂无数据")}</p>}
    </div>
  );
}
export default function MonitorPage({
  host,
  close,
  credentials,
  initialInstall = false,
  onChanged,
}: {
  host: Host;
  close: () => void;
  credentials: (h: Host) => Promise<Credential | null>;
  initialInstall?: boolean;
  onChanged: () => void;
}) {
  useLocale();
  const [tab, setTab] = useState(initialInstall ? "探针设置" : "概览");
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [latest, setLatest] = useState<Latest | null>(null);
  const [points, setPoints] = useState<Rollup[]>([]);
  const [jobs, setJobs] = useState<AgentJob[]>([]);
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [deliveries, setDeliveries] = useState<
    { id: string; status: string; attempts: number; message: string }[]
  >([]);
  const [settings, setSettings] = useState<AgentSettings>(defaultAgentSettings);
  const [alerts, setAlerts] = useState<AlertSettings>(defaultAlerts);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [hours, setHours] = useState(1);
  const [iface, setIface] = useState("");
  const [bit, setBit] = useState(false);
  const [historyMetric, setHistoryMetric] = useState("cpu");
  const [sudo, setSudo] = useState(false);
  const [manual, setManual] = useState(false);
  const mounted = useRef(true);
  const startOnce = useRef(false);
  const path = `/hosts/${host.id}`;
  const refresh = useCallback(
    async (initial = false) => {
      const [a, l, j, e, d] = await Promise.all([
        api<AgentInfo>(`${path}/agent`),
        api<Latest>(`${path}/monitor`),
        api<AgentJob[]>(`${path}/agent/jobs`),
        api<MonitorEvent[]>(`${path}/monitor/events`),
        api<typeof deliveries>(`${path}/alerts/deliveries`),
      ]);
      if (!mounted.current) return;
      setInfo(a);
      setLatest(l);
      setJobs(j);
      setEvents(e);
      setDeliveries(d);
      if (initial) {
        setSettings(a.settings);
        const cfg = await api<AlertSettings>(`${path}/alerts`);
        if (!mounted.current) return;
        setAlerts(cfg);
        setReady(true);
      }
    },
    [path],
  );
  useEffect(() => {
    mounted.current = true;
    let active = true;
    const run = async (initial = false) => {
      try {
        await refresh(initial);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void run(true);
    const timer = window.setInterval(() => void run(), 3000);
    return () => {
      active = false;
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        const from = new Date(
          Date.now() - hours * 3600000 + 1000,
        ).toISOString();
        const data = await api<{ points: Rollup[] }>(
          `${path}/monitor/history?from=${encodeURIComponent(from)}`,
        );
        if (active) setPoints(data.points);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void read();
    const timer = setInterval(() => void read(), 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [path, hours]);
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (mounted.current) {
        await refresh();
        onChanged();
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function install(kind: "install" | "upgrade" | "uninstall") {
    if (
      kind === "uninstall" &&
      !(await confirmAction(
        tr("撤销接入并卸载远端探针？卸载失败时仍会阻止上报。"),
        tr("卸载"),
        true,
      ))
    )
      return;
    await action(async () => {
      if (!(await trustForAgent(host))) return;
      let credential: Credential | undefined;
      if (!host.hasCredential) {
        const value = await credentials(host);
        if (!value) return;
        credential = value;
      }
      await api(`${path}/agent/jobs`, {
        method: "POST",
        body: body({ kind, sudo, credential }),
      });
      setNotice(tr("任务已提交，离开页面后会继续执行。"));
    });
  }
  useEffect(() => {
    if (ready && initialInstall && !startOnce.current) {
      startOnce.current = true;
      void install("install");
    }
  }, [ready, initialInstall]);
  const sample = latest?.sample;
  const selected =
    sample?.network
      .filter((n) =>
        iface
          ? n.name === iface
          : settings.interfaces.length
            ? settings.interfaces.includes(n.name)
            : n.default,
      )
      .map((n) => n.name) || [];
  const totals = (period: string) =>
    selected.reduce(
      (sum, name) => {
        const t = latest?.periods?.[period]?.interfaces[name];
        if (t) {
          sum.rx += t.rx;
          sum.tx += t.tx;
          sum.rxPeak = Math.max(sum.rxPeak, t.rxPeak);
          sum.txPeak = Math.max(sum.txPeak, t.txPeak);
        }
        return sum;
      },
      { rx: 0, tx: 0, rxPeak: 0, txPeak: 0 } as Traffic,
    );
  const day = totals("day"),
    month = totals("month");
  const rate = (direction: string) =>
    selected.reduce(
      (sum, name) => sum + (metric(latest, `net:${name}:${direction}`) || 0),
      0,
    );
  const checks = settings.checks.map((t) => {
    const combined = {
      success: 0,
      failure: 0,
      unavailable: 0,
      sum: 0,
      count: 0,
    };
    for (const p of points) {
      const c = p.checks?.[t.id];
      if (c) {
        combined.success += c.success;
        combined.failure += c.failure;
        combined.unavailable += c.unavailable;
        combined.sum += c.latency.sum;
        combined.count += c.latency.count;
      }
    }
    return { target: t, ...combined };
  });
  const saveConfig = () =>
    action(async () => {
      await api(`${path}/agent`, { method: "PUT", body: body({ settings }) });
      setNotice(tr("监控设置已保存。"));
    });
  const updateCheck = (id: string, change: Partial<CheckTarget>) =>
    setSettings((s) => ({
      ...s,
      checks: s.checks.map((t) => (t.id === id ? { ...t, ...change } : t)),
    }));
  return (
    <div className="monitor-screen">
      <header className="monitor-heading">
        <button className="icon" aria-label={tr("返回主机")} onClick={close}>
          <ArrowLeft size={19} />
        </button>
        <div>
          <span className="eyebrow">{tr("持续监控")}</span>
          <h1>{host.name}</h1>
          <p>
            {host.address}{" "}
            <span className={`monitor-state status-${info?.status}`}>
              {agentStatusLabel(info?.status || "pending")}
            </span>
          </p>
        </div>
        <span className="grow" />
        <button
          className="icon"
          aria-label={tr("刷新")}
          onClick={() => void action(async () => {})}
        >
          <RefreshCw size={17} />
        </button>
      </header>
      <nav className="monitor-tabs" aria-label={tr("监控导航")}>
        {tabs.map((t) => (
          <button
            key={t}
            className={tab === t ? "selected" : ""}
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {tr(t)}
          </button>
        ))}
      </nav>
      <div className="monitor-content">
        {error && (
          <p role="alert" className="error">
            {errorText(error)}
          </p>
        )}
        {notice && (
          <p role="status" className="monitor-notice">
            {notice}
          </p>
        )}
        {!ready && <p>{tr("加载中…")}</p>}
        {ready &&
          tab !== "探针设置" &&
          (!sample || info?.status !== "online") && (
            <div className="monitor-notice">
              {sample
                ? tr(
                    "当前显示最后一次数据；探针离线不代表主机宕机，SSH 可达性需单独确认。",
                  )
                : tr("尚未收到探针数据。主机已保存，可在探针设置中安装。")}
              <button onClick={() => setTab("探针设置")}>
                {tr("探针设置")}
              </button>
            </div>
          )}
        {tab === "概览" && (
          <>
            <div className="monitor-cards">
              <Card
                label="CPU"
                value={pct(metric(latest, "cpu"))}
                detail={tr("{0} 核", [sample?.cores || "—"])}
              />
              <Card
                label={tr("内存")}
                value={pct(metric(latest, "memory"))}
                detail={`${size(sample?.memoryUsed)} / ${size(sample?.memoryTotal)}`}
              />
              <Card
                label={tr("接收速率")}
                value={selected.length ? `${size(rate("rx"))}/s` : "—"}
              />
              <Card
                label={tr("发送速率")}
                value={selected.length ? `${size(rate("tx"))}/s` : "—"}
              />
            </div>
            <section className="monitor-surface">
              <h2>{tr("资源趋势")}</h2>
              <Chart
                points={points}
                series={[
                  { name: "CPU", keys: ["cpu"] },
                  { name: tr("内存"), keys: ["memory"] },
                ]}
              />
            </section>
            <div className="monitor-columns">
              <section className="monitor-surface">
                <h2>{tr("系统信息")}</h2>
                <dl className="monitor-facts">
                  {[
                    [tr("系统"), sample?.os],
                    [tr("内核"), sample?.kernel],
                    [tr("架构"), sample?.arch],
                    [
                      tr("运行时间"),
                      sample
                        ? tr("{0} 天", [Math.floor(sample.uptime / 86400)])
                        : "—",
                    ],
                    [tr("探针版本"), sample?.version],
                    [
                      "Load 1 / 5 / 15",
                      sample?.load?.map((n) => n.toFixed(2)).join(" / "),
                    ],
                    [
                      "Swap",
                      `${size(sample?.swapUsed)} / ${size(sample?.swapTotal)}`,
                    ],
                    [
                      tr("进程 / TCP / UDP"),
                      `${sample?.processes ?? "—"} / ${sample?.tcp ?? "—"} / ${sample?.udp ?? "—"}`,
                    ],
                    [
                      tr("最后上报"),
                      info?.lastSeen ? dateTime(info.lastSeen) : "—",
                    ],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section className="monitor-surface">
                <h2>{tr("逐核 CPU")}</h2>
                <div className="core-grid">
                  {sample?.perCoreCPU?.map((v, i) => (
                    <div key={i}>
                      <span>CPU {i}</span>
                      <strong>{pct(v)}</strong>
                      <meter min={0} max={100} value={v} />
                    </div>
                  ))}
                </div>
                {!sample?.perCoreCPU?.length && (
                  <p className="muted">
                    {agentStatusLabel(
                      sample?.capabilities?.perCoreCPU || "unavailable",
                    )}
                  </p>
                )}
              </section>
            </div>
            <section className="monitor-surface">
              <h2>{tr("磁盘容量")}</h2>
              <Table
                headers={[
                  tr("挂载点"),
                  tr("已用"),
                  tr("可用"),
                  tr("总量"),
                  tr("占用"),
                ]}
                rows={(sample?.mounts || []).map((d) => [
                  d.mount,
                  size(d.used),
                  size(d.free),
                  size(d.total),
                  pct(d.total ? (d.used / d.total) * 100 : null),
                ])}
              />
            </section>
            <section className="monitor-surface">
              <h2>{tr("磁盘 I/O")}</h2>
              <Table
                headers={[
                  tr("设备"),
                  tr("读取 / 秒"),
                  tr("写入 / 秒"),
                  "Read IOPS",
                  "Write IOPS",
                ]}
                rows={(sample?.disks || []).map((d) => [
                  d.name,
                  size(metric(latest, `disk:${d.name}:read`)),
                  size(metric(latest, `disk:${d.name}:write`)),
                  metric(latest, `disk:${d.name}:readIOPS`)?.toFixed(1) || "—",
                  metric(latest, `disk:${d.name}:writeIOPS`)?.toFixed(1) || "—",
                ])}
              />
            </section>
            <section className="monitor-surface">
              <h2>GPU</h2>
              {sample?.gpus?.length ? (
                <Table
                  headers={[tr("设备"), tr("使用率"), tr("显存"), tr("温度")]}
                  rows={sample.gpus.map((g) => [
                    g.name,
                    pct(g.utilization),
                    `${size(g.memoryUsed)} / ${size(g.memoryTotal)}`,
                    g.temperature == null
                      ? "—"
                      : `${g.temperature.toFixed(1)} °C`,
                  ])}
                />
              ) : (
                <p className="muted">
                  {agentStatusLabel(sample?.capabilities?.gpu || "unavailable")}
                </p>
              )}
            </section>
          </>
        )}
        {tab === "网络" && (
          <>
            <div className="monitor-toolbar">
              <div className="monitor-choices">
                <button
                  className={!iface ? "selected" : ""}
                  onClick={() => setIface("")}
                >
                  {tr("统计接口汇总")}
                </button>
                {sample?.network.map((n) => (
                  <button
                    key={n.name}
                    className={iface === n.name ? "selected" : ""}
                    onClick={() => setIface(n.name)}
                  >
                    {n.name}
                  </button>
                ))}
              </div>
              <button onClick={() => setBit(!bit)} aria-pressed={bit}>
                {bit ? "bit/s" : "B/s"}
              </button>
            </div>
            {!selected.length && (
              <p className="monitor-notice">
                {tr("请选择统计网卡；虚拟网桥与 veth 合计可能重复统计。")}
              </p>
            )}
            <div className="monitor-cards">
              <Card
                label={tr("今日接收 / 发送")}
                value={`${size(day.rx)} / ${size(day.tx)}`}
              />
              <Card
                label={tr("账期接收 / 发送")}
                value={`${size(month.rx)} / ${size(month.tx)}`}
              />
              <Card
                label={tr(iface ? "当前网卡账期峰值" : "所选网卡中的最高峰值")}
                value={`${size(month.rxPeak)} / ${size(month.txPeak)}`}
                detail="B/s"
              />
              <Card
                label={tr("账期配额")}
                value={
                  settings.quotaBytes
                    ? `${size(month.rx + month.tx)} / ${size(settings.quotaBytes)}`
                    : tr("未设置")
                }
              />
            </div>
            <section className="monitor-surface">
              <h2>{tr("网络速率")}</h2>
              <Chart
                points={points}
                unit="B/s"
                bit={bit}
                series={[
                  {
                    name: tr("接收"),
                    keys: selected.map((n) => `net:${n}:rx`),
                  },
                  {
                    name: tr("发送"),
                    keys: selected.map((n) => `net:${n}:tx`),
                  },
                ]}
              />
              <p className="muted small">
                {tr("曲线使用单调平滑，提示值来自原始聚合；缺报时段不连线。")}
              </p>
            </section>
            <section className="monitor-surface">
              <h2>{tr("接口错误与丢弃")}</h2>
              <Table
                headers={[
                  tr("接口"),
                  "Rx errors/s",
                  "Tx errors/s",
                  "Rx drops/s",
                  "Tx drops/s",
                ]}
                rows={(sample?.network || []).map((n) => [
                  n.name,
                  ...["rxErrors", "txErrors", "rxDrops", "txDrops"].map(
                    (k) =>
                      metric(latest, `net:${n.name}:${k}`)?.toFixed(2) || "—",
                  ),
                ])}
              />
            </section>
            <section className="monitor-surface">
              <h2>{tr("网络质量")}</h2>
              {checks.length === 0 && (
                <p className="muted">
                  {tr("在下方添加目标，从这台主机发起探测。")}
                </p>
              )}
              {checks.map((c) => {
                const count = c.success + c.failure;
                return (
                  <div className="check-result" key={c.target.id}>
                    <h3>{c.target.name || c.target.host || c.target.url}</h3>
                    <div className="monitor-cards">
                      <Card
                        label={tr("平均延迟")}
                        value={
                          c.count ? `${(c.sum / c.count).toFixed(2)} ms` : "—"
                        }
                      />
                      <Card
                        label={tr(
                          c.target.kind === "icmp" ? "丢包率" : "探测失败率",
                        )}
                        value={pct(count ? (c.failure / count) * 100 : null)}
                      />
                      <Card
                        label={tr("可用率")}
                        value={pct(count ? (c.success / count) * 100 : null)}
                      />
                      <Card
                        label={tr("探测次数 / 无法执行")}
                        value={`${count} / ${c.unavailable}`}
                      />
                    </div>
                  </div>
                );
              })}
            </section>
            <section className="monitor-surface">
              <h2>{tr("探测目标")}</h2>
              <p className="muted small">
                {tr("ICMP 需要系统权限；TCP/HTTP 的失败比例标为探测失败率。")}
              </p>
              {settings.checks.map((t) => (
                <div className="check-editor" key={t.id}>
                  <div className="monitor-toolbar">
                    <input
                      aria-label={tr("目标名称")}
                      placeholder={tr("目标名称")}
                      value={t.name}
                      onChange={(e) =>
                        updateCheck(t.id, { name: e.target.value })
                      }
                    />
                    <Select
                      aria-label={tr("探测方式")}
                      value={t.kind}
                      onChange={(e) =>
                        updateCheck(t.id, {
                          kind: e.target.value as CheckTarget["kind"],
                        })
                      }
                    >
                      <option value="icmp">ICMP</option>
                      <option value="tcp">TCP</option>
                      <option value="http">HTTP(S)</option>
                    </Select>
                    <button
                      className="icon"
                      aria-label={tr("删除目标")}
                      onClick={() =>
                        setSettings((s) => ({
                          ...s,
                          checks: s.checks.filter((c) => c.id !== t.id),
                        }))
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="form-row">
                    {t.kind === "http" ? (
                      <label>
                        URL
                        <input
                          value={t.url}
                          placeholder="https://example.com/health"
                          onChange={(e) =>
                            updateCheck(t.id, { url: e.target.value })
                          }
                        />
                      </label>
                    ) : (
                      <label>
                        {tr("目标地址")}
                        <input
                          value={t.host}
                          placeholder="1.1.1.1"
                          onChange={(e) =>
                            updateCheck(t.id, { host: e.target.value })
                          }
                        />
                      </label>
                    )}
                    {t.kind === "tcp" && (
                      <label>
                        {tr("端口")}
                        <input
                          type="number"
                          min={1}
                          max={65535}
                          value={t.port}
                          onChange={(e) =>
                            updateCheck(t.id, { port: Number(e.target.value) })
                          }
                        />
                      </label>
                    )}
                    <label>
                      {tr("间隔（秒）")}
                      <input
                        type="number"
                        min={10}
                        max={3600}
                        value={t.intervalSeconds}
                        onChange={(e) =>
                          updateCheck(t.id, {
                            intervalSeconds: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      {tr("超时（毫秒）")}
                      <input
                        type="number"
                        min={100}
                        max={10000}
                        value={t.timeoutMs}
                        onChange={(e) =>
                          updateCheck(t.id, {
                            timeoutMs: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                </div>
              ))}
              <div className="monitor-toolbar">
                <button
                  disabled={settings.checks.length >= 16}
                  onClick={() =>
                    setSettings((s) => ({
                      ...s,
                      checks: [
                        ...s.checks,
                        {
                          id: crypto.randomUUID(),
                          name: "",
                          kind: "icmp",
                          host: "",
                          url: "",
                          port: 443,
                          timeoutMs: 1000,
                          intervalSeconds: 30,
                        },
                      ],
                    }))
                  }
                >
                  <Plus size={15} />
                  {tr("添加目标")}
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void saveConfig()}
                >
                  {tr("保存探测设置")}
                </button>
              </div>
            </section>
          </>
        )}
        {tab === "历史" && (
          <>
            <div className="monitor-toolbar">
              <div className="monitor-choices">
                {[1, 6, 24, 168, 720, 4320].map((h) => (
                  <button
                    key={h}
                    className={hours === h ? "selected" : ""}
                    onClick={() => setHours(h)}
                  >
                    {h < 24 ? `${h} h` : `${h / 24} d`}
                  </button>
                ))}
              </div>
              <Select
                aria-label={tr("历史指标")}
                value={historyMetric}
                onChange={(e) => setHistoryMetric(e.target.value)}
              >
                <option value="cpu">CPU</option>
                <option value="memory">{tr("内存")}</option>
                <option value="rx">{tr("接收速率")}</option>
                <option value="tx">{tr("发送速率")}</option>
                <option value="load1">Load 1</option>
              </Select>
            </div>
            <section className="monitor-surface">
              <Chart
                points={points}
                unit={
                  ["rx", "tx"].includes(historyMetric)
                    ? "B/s"
                    : historyMetric === "load1"
                      ? ""
                      : "%"
                }
                series={[{ name: historyMetric, keys: [historyMetric] }]}
              />
              <Table
                headers={[tr("时间"), tr("平均值"), tr("峰值"), tr("样本数")]}
                rows={points
                  .filter((p) => p.metrics[historyMetric])
                  .slice(-20)
                  .map((p) => [
                    dateTime(p.time),
                    p.metrics[historyMetric].average.toFixed(2),
                    p.metrics[historyMetric].max.toFixed(2),
                    p.metrics[historyMetric].count,
                  ])}
              />
            </section>
          </>
        )}
        {tab === "事件" && (
          <>
            <section className="monitor-surface">
              <h2>{tr("监控事件")}</h2>
              {!events.length && <p className="muted">{tr("暂无事件")}</p>}
              {events.map((e) => (
                <article className={`monitor-event ${e.severity}`} key={e.id}>
                  <Activity size={16} />
                  <div>
                    <strong>{eventLabel(e.kind)}</strong>
                    <small>{dateTime(e.createdAt)}</small>
                    {typeof e.data.value === "number" && (
                      <span>
                        {tr("观测值")} · {e.data.value.toFixed(2)}
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </section>
            <section className="monitor-surface">
              <h2>{tr("Webhook 投递")}</h2>
              <Table
                headers={[tr("状态"), tr("尝试次数"), tr("说明")]}
                rows={deliveries.map((d) => [
                  agentStatusLabel(d.status),
                  d.attempts,
                  errorText(d.message) || "—",
                ])}
              />
            </section>
          </>
        )}
        {tab === "探针设置" && (
          <>
            <section className="monitor-surface">
              <h2>{tr("探针管理")}</h2>
              <p>
                {tr(
                  "首次收到有效上报后才会标记为安装成功。任务独立于当前页面。",
                )}
              </p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={sudo}
                  onChange={(e) => setSudo(e.target.checked)}
                />
                {tr("允许使用已配置的免密 sudo 安装系统服务")}
              </label>
              <div className="monitor-actions">
                <button
                  disabled={busy}
                  className="primary"
                  onClick={() => void install("install")}
                >
                  {tr("安装 / 重试")}
                </button>
                <button disabled={busy} onClick={() => void install("upgrade")}>
                  {tr("升级探针")}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const cfg = {
                        ...(info?.settings || settings),
                        paused: !info?.settings.paused,
                      };
                      await api(`${path}/agent`, {
                        method: "PUT",
                        body: body({ settings: cfg }),
                      });
                      setSettings(cfg);
                    })
                  }
                >
                  {info?.settings.paused ? tr("恢复采集") : tr("暂停采集")}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await api(`${path}/agent/rotate`, {
                        method: "POST",
                        body: "{}",
                      });
                      setNotice(tr("新凭证将在探针确认后替换旧凭证。"));
                    })
                  }
                >
                  {tr("轮换凭证")}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      if (
                        !(await confirmAction(
                          tr("撤销探针接入？远端程序会保留，但不能继续上报。"),
                          tr("撤销接入"),
                          true,
                        ))
                      )
                        return;
                      await api(`${path}/agent`, { method: "DELETE" });
                    })
                  }
                >
                  {tr("撤销接入")}
                </button>
                <button
                  disabled={busy}
                  className="danger"
                  onClick={() => void install("uninstall")}
                >
                  {tr("卸载探针")}
                </button>
              </div>
              <Table
                headers={[tr("操作"), tr("状态"), tr("进度")]}
                rows={jobs.map((j) => [
                  tr(
                    j.kind === "install"
                      ? "安装探针"
                      : j.kind === "upgrade"
                        ? "升级探针"
                        : "卸载探针",
                  ),
                  agentStatusLabel(j.status),
                  errorText(j.message),
                ])}
              />
            </section>
            <section className="monitor-surface">
              <h2>{tr("手动安装")}</h2>
              <p>
                {tr(
                  "下载十分钟有效的私有配置文件，与安装脚本放在同一目录。凭证不会出现在安装命令中。",
                )}
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    if (!info?.enabled) {
                      await api(`${path}/agent`, {
                        method: "POST",
                        body: body({ settings }),
                      });
                    }
                    const r = await api<{
                      serverURL: string;
                      registrationToken: string;
                    }>(`${path}/agent/registration`, {
                      method: "POST",
                      body: "{}",
                    });
                    const blob = new Blob(
                      [
                        JSON.stringify({
                          serverURL: r.serverURL,
                          registrationToken: r.registrationToken,
                        }),
                      ],
                      { type: "application/json" },
                    );
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "config.json";
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    setManual(true);
                  })
                }
              >
                <Download size={16} />
                {tr("下载私有配置")}
              </button>
              {manual && (
                <div className="manual-install">
                  <p>
                    {tr("在目标主机的私有目录中放入 config.json，然后执行：")}
                  </p>
                  <pre>{`chmod 600 config.json\ncurl --fail --proto '=https' --tlsv1.2 '${location.origin}/api/agent/releases/install.sh' -o install.sh\nsudo sh install.sh`}</pre>
                </div>
              )}
            </section>
            <section className="monitor-surface">
              <h2>{tr("采集与流量账期")}</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveConfig();
                }}
              >
                <div className="form-row">
                  <label>
                    {tr("采样间隔")}
                    <Select
                      aria-label={tr("采样间隔")}
                      value={settings.intervalSeconds}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          intervalSeconds: Number(e.target.value),
                        })
                      }
                    >
                      <option value={3}>3 s</option>
                      <option value={1}>1 s</option>
                    </Select>
                  </label>
                  <label>
                    {tr("账期起始日")}
                    <input
                      type="number"
                      min={1}
                      max={28}
                      value={settings.billingDay}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          billingDay: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    {tr("账期时区")}
                    <input
                      required
                      value={settings.timezone}
                      onChange={(e) =>
                        setSettings({ ...settings, timezone: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    {tr("账期配额（GiB，0 为不限）")}
                    <input
                      type="number"
                      min={0}
                      value={settings.quotaBytes / 1073741824}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          quotaBytes: Number(e.target.value) * 1073741824,
                        })
                      }
                    />
                  </label>
                </div>
                <label>
                  {tr("统计网卡（逗号分隔，留空使用默认路由接口）")}
                  <input
                    key={settings.interfaces.join(", ")}
                    defaultValue={settings.interfaces.join(", ")}
                    onBlur={(e) =>
                      setSettings({
                        ...settings,
                        interfaces: splitNames(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  {tr("排除网卡")}
                  <input
                    key={settings.excludeInterfaces.join(", ")}
                    defaultValue={settings.excludeInterfaces.join(", ")}
                    onBlur={(e) =>
                      setSettings({
                        ...settings,
                        excludeInterfaces: splitNames(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  {tr("挂载点（逗号分隔，留空自动去重）")}
                  <input
                    key={settings.mounts.join(", ")}
                    defaultValue={settings.mounts.join(", ")}
                    onBlur={(e) =>
                      setSettings({
                        ...settings,
                        mounts: splitNames(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  {tr("排除挂载点")}
                  <input
                    key={settings.excludeMounts.join(", ")}
                    defaultValue={settings.excludeMounts.join(", ")}
                    onBlur={(e) =>
                      setSettings({
                        ...settings,
                        excludeMounts: splitNames(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={settings.gpu}
                    onChange={(e) =>
                      setSettings({ ...settings, gpu: e.target.checked })
                    }
                  />
                  {tr("采集 GPU 指标")}
                </label>
                <button className="primary" disabled={busy}>
                  {tr("保存监控设置")}
                </button>
              </form>
            </section>
            <section className="monitor-surface">
              <h2>{tr("告警规则")}</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(async () => {
                    await api(`${path}/alerts`, {
                      method: "PUT",
                      body: body(alerts),
                    });
                    setAlerts(await api(`${path}/alerts`));
                    setNotice(tr("告警规则已保存。"));
                  });
                }}
              >
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={alerts.enabled}
                    onChange={(e) =>
                      setAlerts({ ...alerts, enabled: e.target.checked })
                    }
                  />
                  {tr("启用告警")}
                </label>
                <p className="muted small">
                  {tr("资源阈值设为 0 表示关闭；流量告警使用上方账期配额。")}
                </p>
                <div className="form-row">
                  {(
                    [
                      ["cpuPercent", "CPU 阈值"],
                      ["memoryPercent", "内存阈值"],
                      ["diskPercent", "磁盘阈值"],
                    ] as const
                  ).map(([k, label]) => (
                    <label key={k}>
                      {tr(label)} %
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={alerts[k]}
                        onChange={(e) =>
                          setAlerts({ ...alerts, [k]: Number(e.target.value) })
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="form-row">
                  {(
                    [
                      ["offlineGraceSeconds", "离线宽限秒数"],
                      ["durationSeconds", "持续时间（秒）"],
                      ["recoverySeconds", "恢复确认（秒）"],
                      ["cooldownSeconds", "冷却时间（秒）"],
                      ["hysteresisPercent", "恢复阈值差（百分点）"],
                    ] as const
                  ).map(([k, label]) => (
                    <label key={k}>
                      {tr(label)}
                      <input
                        type="number"
                        min={
                          k === "offlineGraceSeconds"
                            ? 60
                            : k === "cooldownSeconds" ||
                                k === "hysteresisPercent"
                              ? 0
                              : 5
                        }
                        max={k === "hysteresisPercent" ? 50 : 86400}
                        value={alerts[k]}
                        onChange={(e) =>
                          setAlerts({ ...alerts, [k]: Number(e.target.value) })
                        }
                      />
                    </label>
                  ))}
                </div>
                <label>
                  {tr("维护静默至")}
                  <input
                    type="datetime-local"
                    value={alerts.muteUntil ? localDate(alerts.muteUntil) : ""}
                    onChange={(e) =>
                      setAlerts({
                        ...alerts,
                        muteUntil: e.target.value
                          ? new Date(e.target.value).toISOString()
                          : null,
                      })
                    }
                  />
                </label>
                <label>
                  Webhook URL {alerts.hasWebhook && tr("（已配置，留空保留）")}
                  <PasswordInput
                    type="password"
                    value={alerts.webhookURL || ""}
                    autoComplete="off"
                    placeholder="https://…"
                    onChange={(e) =>
                      setAlerts({ ...alerts, webhookURL: e.target.value })
                    }
                  />
                </label>
                {alerts.hasWebhook && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={!!alerts.clearWebhook}
                      onChange={(e) =>
                        setAlerts({ ...alerts, clearWebhook: e.target.checked })
                      }
                    />
                    {tr("清除 Webhook")}
                  </label>
                )}
                <button className="primary" disabled={busy}>
                  {tr("保存告警规则")}
                </button>
              </form>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
function splitNames(v: string) {
  return v
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
}
function localDate(s: string) {
  const d = new Date(s);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function eventLabel(kind: string) {
  const keys: Record<string, string> = {
    host_restarted: "主机重启",
    agent_restarted: "探针重启",
    counter_reset: "计数器重置",
    collection_gap: "采集中断",
    agent_offline: "探针离线",
    agent_offline_recovered: "探针恢复",
    cpu_high: "CPU 超过阈值",
    cpu_high_recovered: "CPU 恢复",
    memory_high: "内存超过阈值",
    memory_high_recovered: "内存恢复",
    traffic_quota: "流量达到配额",
    traffic_quota_recovered: "流量配额恢复",
  };
  if (kind.startsWith("disk_high:"))
    return `${tr(kind.endsWith("_recovered") ? "磁盘恢复" : "磁盘超过阈值")} · ${kind.slice(10).replace(/_recovered$/, "")}`;
  return tr(keys[kind] || kind);
}
