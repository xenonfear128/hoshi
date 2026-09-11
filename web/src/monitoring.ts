import { api, body, type Host } from "./api";
import { confirmAction } from "./Dialogs";
import { tr } from "./i18n";
export type Credential = {
  password: string;
  privateKey: string;
  passphrase: string;
};
export type CheckTarget = {
  id: string;
  name: string;
  kind: "icmp" | "tcp" | "http";
  host: string;
  port: number;
  url: string;
  timeoutMs: number;
  intervalSeconds: number;
};
export type AgentSettings = {
  intervalSeconds: number;
  interfaces: string[];
  excludeInterfaces: string[];
  mounts: string[];
  excludeMounts: string[];
  billingDay: number;
  timezone: string;
  quotaBytes: number;
  paused: boolean;
  gpu: boolean;
  checks: CheckTarget[];
};
export const defaultAgentSettings = (): AgentSettings => ({
  intervalSeconds: 3,
  interfaces: [],
  excludeInterfaces: [],
  mounts: [],
  excludeMounts: [],
  billingDay: 1,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  quotaBytes: 0,
  paused: false,
  gpu: true,
  checks: [],
});
export type AgentInfo = {
  enabled: boolean;
  status: string;
  agentID: string;
  version: string;
  lastSeen: string | null;
  lastCurrent: string | null;
  settings: AgentSettings;
  capabilities: Record<string, string>;
};
export type Stat = {
  count: number;
  sum: number;
  min: number;
  max: number;
  average: number;
};
export type Traffic = {
  rx: number;
  tx: number;
  rxPeak: number;
  txPeak: number;
};
export type CheckStats = {
  success: number;
  failure: number;
  unavailable: number;
  latency: Stat;
};
export type Rollup = {
  time: string;
  step: number;
  count: number;
  gap: boolean;
  metrics: Record<string, Stat>;
  traffic: Record<string, Traffic>;
  checks: Record<string, CheckStats>;
};
export type AgentSample = {
  sampledAt: string;
  hostname: string;
  os: string;
  kernel: string;
  arch: string;
  cores: number;
  uptime: number;
  version: string;
  cpu: number | null;
  perCoreCPU: number[];
  memoryTotal: number;
  memoryUsed: number;
  swapTotal: number;
  swapUsed: number;
  load: number[] | null;
  processes: number | null;
  tcp: number | null;
  udp: number | null;
  capabilities: Record<string, string>;
  network: {
    name: string;
    default: boolean;
    rxBytes: number;
    txBytes: number;
    rxErrors: number;
    txErrors: number;
    rxDrops: number;
    txDrops: number;
  }[];
  mounts: {
    mount: string;
    device: string;
    total: number;
    used: number;
    free: number;
  }[];
  disks: { name: string }[];
  gpus: {
    index: number;
    name: string;
    utilization: number | null;
    memoryUsed: number | null;
    memoryTotal: number | null;
    temperature: number | null;
  }[];
};
export type Latest = {
  status: string;
  sample: AgentSample | null;
  values: Record<string, number> | null;
  receivedAt: string;
  settings: AgentSettings;
  gap: boolean;
  periods: Record<
    string,
    { start: string; end: string; interfaces: Record<string, Traffic> }
  >;
};
export type AgentJob = {
  id: string;
  hostID: string;
  kind: string;
  status: string;
  message: string;
  createdAt: string;
  updatedAt: string;
};
export type MonitorEvent = {
  id: string;
  kind: string;
  severity: string;
  data: Record<string, unknown>;
  createdAt: string;
};
export type AlertSettings = {
  enabled: boolean;
  offlineGraceSeconds: number;
  durationSeconds: number;
  recoverySeconds: number;
  cooldownSeconds: number;
  hysteresisPercent: number;
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  muteUntil: string | null;
  hasWebhook: boolean;
  webhookURL?: string;
  clearWebhook?: boolean;
};
export type Summary = Record<
  string,
  {
    status: string;
    values: Record<string, number>;
    lastSeen: string | null;
    lastCurrent: string | null;
  }
>;
const statusKeys: Record<string, string> = {
  disabled: "未启用",
  pending: "待安装",
  installing: "安装中",
  running: "执行中",
  waiting: "等待上报",
  online: "在线",
  stale: "数据延迟",
  offline: "探针离线",
  failed: "失败",
  stopped: "已暂停",
  complete: "已完成",
  available: "可用",
  warming: "正在建立采样基线",
  unsupported: "不支持",
  permission: "无权限",
  unavailable: "暂无数据",
  delivered: "已投递",
  discarded: "已取消",
};
export const agentStatusLabel = (state: string) =>
  tr(statusKeys[state] || state);
export async function trustForAgent(h: Host) {
  const fp = await api<{
    fingerprint: string;
    previous: string;
    changed: boolean;
  }>(`/hosts/${h.id}/probe`, { method: "POST", body: "{}" });
  if (fp.fingerprint !== fp.previous) {
    if (
      !(await confirmAction(
        tr("{0}\n\n{1} ({2}:{3})\n{4}\n\n{5}确认信任此指纹？", [
          fp.changed
            ? tr("警告：服务器指纹已变化。请通过可信渠道核对！")
            : tr("首次连接，请通过可信渠道核对服务器指纹。"),
          h.name,
          h.address,
          h.port,
          fp.fingerprint,
          fp.previous ? tr("原指纹：") + fp.previous + "\n\n" : "",
        ]),
        tr("信任并继续"),
        false,
      ))
    )
      return false;
    await api(`/hosts/${h.id}/trust`, {
      method: "POST",
      body: body({ fingerprint: fp.fingerprint, previous: fp.previous }),
    });
  }
  return true;
}
