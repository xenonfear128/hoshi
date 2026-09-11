import { Select } from "./Select";
import {
  agentStatusLabel,
  defaultAgentSettings,
  type AgentSettings,
  type Summary,
} from "./monitoring";
import PasswordInput from "./PasswordInput";
import { confirmAction } from "./Dialogs";
import { errorText } from "./i18n";
import LanguageSwitcher from "./LanguageSwitcher";
import { number, projectName, statusLabel } from "./i18n";
import { tr, useLocale } from "./i18n";
import { useEffect, useState, useRef, lazy, Suspense } from "react";
import {
  ArrowUpRight,
  ArrowDownUp,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Monitor,
  MoreHorizontal,
  Plus,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Moon,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from "lucide-react";
import {
  api,
  body,
  bytes,
  type Host,
  type Connection,
  type AISettings,
  APIError,
} from "./api";
import Brand, { StarMark } from "./Brand";
import { useTransfers } from "./transfers";
const Workspace = lazy(() => import("./Workspace"));
const MonitorPage = lazy(() => import("./MonitorPage"));
const AIPage = lazy(() => import("./AIPage"));
export { Modal } from "./Modal";
import { Modal } from "./Modal";
export default function App() {
  useLocale();
  const [user, setUser] = useState<{
      id: string;
      email: string;
    } | null>(null),
    [loading, setLoading] = useState(true),
    [hosts, setHosts] = useState<Host[]>([]),
    [connections, setConnections] = useState<Connection[]>([]),
    [active, setActive] = useState(""),
    [page, setPageState] = useState("hosts"),
    [displayPage, setDisplayPage] = useState("hosts"),
    [pagePhase, setPagePhase] = useState<"idle" | "leaving" | "entering">(
      "idle",
    ),
    [split, setSplit] = useState(""),
    [theme, setTheme] = useState(localStorage.getItem("theme") || "dark"),
    [edit, setEdit] = useState<Host | "new" | null>(null),
    [settings, setSettings] = useState(false),
    [transferOpen, setTransferOpen] = useState(false),
    [menuOpen, setMenuOpen] = useState(false),
    [compact, setCompact] = useState(
      localStorage.getItem("host-layout") === "compact",
    ),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [temporary, setTemporary] = useState<{
      host: Host;
      resolve: (
        v: {
          password: string;
          privateKey: string;
          passphrase: string;
        } | null,
      ) => void;
    } | null>(null);
  const [monitorHost, setMonitorHost] = useState<Host | null>(null);
  const [installOnOpen, setInstallOnOpen] = useState(false);
  const [monitorSummary, setMonitorSummary] = useState<Summary>({});
  useEffect(() => {
    if (!user) return;
    let active = true;
    const poll = () =>
      api<Summary>("/monitor/summary")
        .then((s) => {
          if (active) setMonitorSummary(s);
        })
        .catch(() => {});
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user]);
  const pageTimers = useRef<number[]>([]);
  const setPage = (next: string) => {
    if (next === page && next === displayPage) return;
    pageTimers.current.forEach((timer) => window.clearTimeout(timer));
    pageTimers.current = [];
    setPageState(next);
    setPagePhase("leaving");
    pageTimers.current.push(
      window.setTimeout(() => {
        setDisplayPage(next);
        setPagePhase("entering");
      }, 150),
      window.setTimeout(() => setPagePhase("idle"), 520),
    );
  };
  useEffect(
    () => () =>
      pageTimers.current.forEach((timer) => window.clearTimeout(timer)),
    [],
  );
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (e: PointerEvent) => {
      if (!(e.target as Element).closest(".global-actions,.global-menu-toggle"))
        setMenuOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        document
          .querySelector<HTMLButtonElement>(".global-menu-toggle")
          ?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [menuOpen]);
  const accountRef = useRef(user?.id);
  accountRef.current = user?.id;
  const epoch = useRef(0);
  const transferCount = useTransfers(
    (state) =>
      Object.values(state.byConnection)
        .flat()
        .filter((t) => t.status === "uploading").length,
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#0b0c10" : "#f5f5f7");
    localStorage.setItem("theme", theme);
  }, [theme]);
  useEffect(() => {
    api<{
      id: string;
      email: string;
    }>("/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoading(false));
    const expired = () => {
      epoch.current++;
      setUser(null);
      setMonitorHost(null);
      setMonitorSummary({});
      setHosts([]);
      setActive("");
      setPage("hosts");
      setSplit("");
      setEdit(null);
      setSettings(false);
      setTransferOpen(false);
      setQuery("");
      setError("");
      setTemporary((old) => {
        old?.resolve(null);
        return null;
      });
      setConnections([]);
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  async function load() {
    try {
      const owner = accountRef.current,
        currentEpoch = epoch.current;
      const result = await api<Host[]>("/hosts");
      if (accountRef.current === owner && epoch.current === currentEpoch)
        setHosts(result);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (user) void load();
  }, [user]);
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (connections.length) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [connections.length]);
  async function connect(h: Host): Promise<Connection | undefined> {
    const currentEpoch = epoch.current;
    setBusy(h.id);
    setError("");
    try {
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
            tr("信任并连接"),
            false,
          ))
        )
          return;
        if (epoch.current !== currentEpoch) return;
        await api(`/hosts/${h.id}/trust`, {
          method: "POST",
          body: body({ fingerprint: fp.fingerprint, previous: fp.previous }),
        });
        void load();
      }
      if (epoch.current !== currentEpoch) return;
      let credential;
      if (!h.hasCredential) {
        const value = await new Promise<{
          password: string;
          privateKey: string;
          passphrase: string;
        } | null>((resolve) => setTemporary({ host: h, resolve }));
        if (!value) return;
        credential = value;
      }
      if (epoch.current !== currentEpoch) return;
      const result = await api<{
        id: string;
      }>(`/hosts/${h.id}/connect`, {
        method: "POST",
        body: body({ credential }),
      });
      if (epoch.current !== currentEpoch) {
        return;
      }
      const c = { id: result.id, host: h };
      setConnections((old) => [...old, c]);
      setActive(c.id);
      setPage("workspace");
      return c;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function disconnect(c: Connection) {
    if (
      !(await confirmAction(
        tr("关闭连接？当前终端及该连接的传输任务将中止，已执行操作不会撤销。"),
        tr("关闭连接"),
        false,
      ))
    )
      return;
    try {
      await api(`/connections/${c.id}`, { method: "DELETE" });
      setConnections((old) => {
        const next = old.filter((x) => x.id !== c.id);
        if (active === c.id) setActive(next[0]?.id || "");
        return next;
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (loading) return <div className="loading">{tr("正在连接工作台…")}</div>;
  if (!user) return <Login onLogin={setUser} />;
  return (
    <div className="app">
      <nav className="nav">
        <a
          className="brand"
          href="#"
          aria-label={`${projectName()} · ${tr("主机管理")}`}
          onClick={() => setPage("hosts")}
        >
          <Brand />
        </a>
        <PageNavigation
          page={page}
          setPage={setPage}
          count={connections.length}
        />
        <span className="grow" />
        <LanguageSwitcher />
        <button
          className="icon global-menu-toggle"
          aria-label={tr("更多操作")}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <MoreHorizontal size={20} />
        </button>
        <div
          className={`global-actions ${menuOpen ? "open" : ""}`}
          onKeyDown={(e) => {
            if (e.key === "Escape") setMenuOpen(false);
          }}
        >
          <button
            className="subtle transfer-nav"
            onClick={() => {
              setMenuOpen(false);
              setTransferOpen(true);
            }}
          >
            <ArrowDownUp size={16} aria-hidden="true" />
            <span>{tr("传输中心")}</span>{" "}
            {transferCount > 0 && (
              <span className="count">{transferCount}</span>
            )}
          </button>
          <button
            className="subtle"
            aria-label={tr("AI 服务与订阅")}
            onClick={() => {
              setMenuOpen(false);
              setSettings(true);
            }}
          >
            <KeyRound size={14} />
            {tr("AI 服务与订阅")}
          </button>
          <button
            className="icon"
            aria-label={tr("切换主题")}
            onClick={() => {
              setMenuOpen(false);
              setTheme(theme === "dark" ? "light" : "dark");
            }}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            <span className="mobile-action-label">{tr("切换主题")}</span>
          </button>
          <button
            className="logout-button"
            title={tr("退出登录")}
            aria-label={tr("退出登录")}
            onClick={async () => {
              await api("/logout", { method: "POST", body: "{}" });
              epoch.current++;
              setUser(null);
              setHosts([]);
              setMonitorHost(null);
              setMonitorSummary({});
              setActive("");
              setPage("hosts");
              setSplit("");
              setEdit(null);
              setSettings(false);
              setTransferOpen(false);
              setQuery("");
              setError("");
              setTemporary((old) => {
                old?.resolve(null);
                return null;
              });
              setConnections([]);
            }}
          >
            <LogOut size={18} aria-hidden="true" />
            <span className="mobile-action-label">{tr("退出登录")}</span>
          </button>
        </div>
      </nav>
      <nav className="mobile-navigation" aria-label={tr("主导航")}>
        <PageNavigation
          page={page}
          setPage={setPage}
          count={connections.length}
        />
      </nav>
      {error && (
        <div className="error global-error">
          {errorText(error)}
          <button className="icon" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      <main
        className={`home page-view${displayPage === "hosts" ? " is-active" : ""} ${displayPage === "hosts" ? pagePhase : ""}`}
      >
        <div className="home-intro">
          <div className="eyebrow">{projectName()}</div>
          <StarMark className="hero-star" />
          <div className="page-heading">
            <div>
              <h1>{tr("连接每一颗星。")}</h1>
              <p>{tr("你的主机、文件与下一步操作，在此相连。")}</p>
            </div>
            <button className="primary" onClick={() => setEdit("new")}>
              <Plus size={16} />
              {tr("添加主机")}
            </button>
          </div>
        </div>
        <button className="ai-banner" onClick={() => setPage("ai")}>
          <span className="spark-mark">
            <StarMark />
          </span>
          <span>
            <strong>{tr("从一句话，到下一步。")}</strong>
            <small>{tr("AI 运维 · 选择主机，描述需求，确认后执行")}</small>
          </span>
          <span className="grow" />
          <span className="tag">{tr("BYOK / 订阅")}</span>
          <ArrowUpRight size={23} />
        </button>
        <div className="list-toolbar">
          <button
            className="layout-toggle"
            aria-pressed={compact}
            onClick={() => {
              setCompact(!compact);
              localStorage.setItem(
                "host-layout",
                !compact ? "compact" : "cards",
              );
            }}
          >
            {tr("紧凑列表")}
          </button>
          <h2>
            {tr("我的主机")}
            <span className="muted">{hosts.length}</span>
          </h2>
          <div className="search">
            <Search size={16} />
            <input
              placeholder={tr("搜索名称、地址或分组")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className={`host-grid ${compact ? "compact" : ""}`}>
          {hosts
            .filter((h) =>
              `${h.name} ${h.address} ${h.group}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((h) => (
              <article className="host-card" key={h.id}>
                <div className="row">
                  <div className="host-icon">
                    <Server size={22} />
                  </div>
                  <span className="grow" />
                  <span className="tag">{h.group || tr("未分组")}</span>
                  <button
                    className="icon"
                    title={tr("编辑主机")}
                    onClick={() => setEdit(h)}
                  >
                    <Settings size={15} />
                  </button>
                </div>
                <h3>{h.name}</h3>
                <p className="mono muted">
                  {h.username}@{h.address}:{h.port}
                </p>
                <p className="host-note">{h.note || tr("暂无备注")}</p>
                {h.agentEnabled && (
                  <button
                    className="host-monitor-summary"
                    onClick={() => {
                      setMonitorHost(h);
                      setInstallOnOpen(false);
                      setPage("monitor");
                    }}
                  >
                    <Monitor size={13} />
                    <span>{tr("探针监控")}</span>
                    <span
                      className={`agent-status status-${h.agentStatus || "pending"}`}
                    >
                      {agentStatusLabel(
                        monitorSummary[h.id]?.status ||
                          h.agentStatus ||
                          "pending",
                      )}
                    </span>
                  </button>
                )}
                {h.agentEnabled &&
                  monitorSummary[h.id]?.status === "online" && (
                    <p className="host-live-metrics">
                      CPU {monitorSummary[h.id].values.cpu?.toFixed(0) ?? "—"}%
                      · RAM{" "}
                      {monitorSummary[h.id].values.memory?.toFixed(0) ?? "—"}% ·
                      ↓ {bytes(monitorSummary[h.id].values.rx)}/s · ↑{" "}
                      {bytes(monitorSummary[h.id].values.tx)}/s
                    </p>
                  )}
                <div className="card-footer">
                  <span className="small muted">
                    <KeyRound size={12} />
                    {h.authType === "key" ? tr("私钥") : tr("密码")} ·{" "}
                    {h.hasCredential ? tr("已加密保存") : tr("临时输入")}
                  </span>
                  <button
                    className="connect-button"
                    disabled={!!busy}
                    onClick={() => connect(h)}
                  >
                    {busy === h.id ? tr("连接中…") : tr("连接")}
                    <ChevronRight size={15} />
                  </button>
                </div>
              </article>
            ))}
        </div>
        {hosts.length === 0 && (
          <div className="empty">
            <Server size={40} />
            <h3>{tr("添加第一台服务器")}</h3>
            <p>{tr("主机信息与安全凭据加密存储，仅当前账号可访问。")}</p>
            <button onClick={() => setEdit("new")}>{tr("添加主机")}</button>
          </div>
        )}
        <div className="home-foot">
          <ShieldCheck size={14} />
          {tr("账号隔离 · 凭据加密 · SSH 指纹校验")}
        </div>
      </main>
      <div
        className={`workspace-page page-view${displayPage === "workspace" ? " is-active" : ""} ${displayPage === "workspace" ? pagePhase : ""}`}
      >
        <div className="session-tabs">
          {connections.map((c) => (
            <div
              className={
                active === c.id ? "session-tab selected" : "session-tab"
              }
              key={c.id}
            >
              <button onClick={() => setActive(c.id)}>
                <span className="dot" />
                {c.host.name}
              </button>
              <button
                className="icon"
                title={tr("关闭连接")}
                onClick={() => disconnect(c)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <button
            className="icon"
            title={tr("连接其他主机")}
            onClick={() => setPage("hosts")}
          >
            <Plus size={17} />
          </button>
          <span className="grow" />
          <Select
            aria-label={tr("分屏会话")}
            value={split}
            onChange={(e) => setSplit(e.target.value)}
          >
            <option value="">{tr("单终端视图")}</option>
            {connections
              .filter((c) => c.id !== active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {tr("分屏 ·")}
                  {c.host.name}
                </option>
              ))}
          </Select>
        </div>
        <div className="workspace-deck">
          {connections.map((c) => (
            <div
              className={
                active === c.id || split === c.id
                  ? `workspace-container${active !== c.id ? " workspace-secondary" : ""}`
                  : "hidden"
              }
              key={c.id}
            >
              <Suspense
                fallback={<div className="empty">{tr("正在加载终端…")}</div>}
              >
                <Workspace
                  connection={c}
                  theme={theme}
                  visible={
                    displayPage === "workspace" &&
                    (active === c.id || split === c.id)
                  }
                  reconnect={() => connect(c.host)}
                />
              </Suspense>
            </div>
          ))}
          {connections.length === 0 && (
            <div className="empty">
              <TerminalIcon size={42} />
              <h3>{tr("尚未连接主机")}</h3>
              <button onClick={() => setPage("hosts")}>{tr("选择主机")}</button>
            </div>
          )}
        </div>
      </div>
      <div
        className={`ai-page-view page-view${displayPage === "ai" ? " is-active" : ""} ${displayPage === "ai" ? pagePhase : ""}`}
      >
        <Suspense
          fallback={<div className="empty">{tr("正在加载 AI 运维…")}</div>}
        >
          <AIPage
            hosts={hosts}
            connections={connections}
            connect={async (h) => {
              const c = await connect(h);
              setPage("ai");
              return c;
            }}
          />
        </Suspense>
      </div>
      {temporary && (
        <TemporaryCredential
          host={temporary.host}
          finish={(v) => {
            temporary.resolve(v);
            setTemporary(null);
          }}
        />
      )}
      {edit && (
        <HostEditor
          host={edit}
          close={() => setEdit(null)}
          saved={(h, openMonitor, autoInstall) => {
            setEdit(null);
            void load();
            if (openMonitor) {
              setMonitorHost(h);
              setInstallOnOpen(autoInstall);
              setPage("monitor");
            }
          }}
        />
      )}
      {settings && <SettingsPanel close={() => setSettings(false)} />}
      {transferOpen && (
        <TransferCenter
          close={() => setTransferOpen(false)}
          navigate={(id) => {
            setActive(id);
            setPage("workspace");
            setTransferOpen(false);
          }}
        />
      )}
      <div
        className={`monitor-page-view page-view${displayPage === "monitor" ? " is-active" : ""} ${displayPage === "monitor" ? pagePhase : ""}`}
      >
        {monitorHost && displayPage === "monitor" && (
          <Suspense fallback={<div className="empty">{tr("加载中…")}</div>}>
            <MonitorPage
              key={monitorHost.id}
              host={monitorHost}
              initialInstall={installOnOpen}
              close={() => setPage("hosts")}
              onChanged={() => void load()}
              credentials={(h) =>
                new Promise((resolve) => setTemporary({ host: h, resolve }))
              }
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
function Login({
  onLogin,
}: {
  onLogin: (u: { id: string; email: string }) => void;
}) {
  useLocale();
  const [register, setRegister] = useState(false),
    [allowed, setAllowed] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{
      registration: boolean;
    }>("/bootstrap")
      .then((v) => setAllowed(v.registration))
      .catch(() => {});
  }, []);
  return (
    <div className="login-page">
      <div className="login-intro">
        <LanguageSwitcher />
        <span className="brand">
          <Brand />
        </span>
        <h1>
          {tr("连接每一颗星。")}
          <br />
          {tr("专注每一步。")}
        </h1>
        <p>{tr("SSH · SFTP · 实时监控 · AI 运维")}</p>
        <div className="login-graphic">
          <StarMark />
        </div>
      </div>
      <form
        className="login-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api(register ? "/register" : "/login", {
              method: "POST",
              body: body({ email, password }),
            });
            onLogin(await api("/me"));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="eyebrow">
          {projectName()} / {tr("私有工作台")}
        </div>
        <h2>
          {register ? tr("创建 {0} 账号", [projectName()]) : tr("欢迎回来")}
        </h2>
        <p className="muted">
          {tr("登录 {0}，回到你的主机工作台。", [projectName()])}
        </p>
        <label>
          {tr("邮箱")}
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label htmlFor="login-password">{tr("密码")}</label>
        <div className="password-input">
          <input
            id="login-password"
            type={showPassword ? "text" : "password"}
            autoCapitalize="none"
            spellCheck={false}
            autoComplete={register ? "new-password" : "current-password"}
            minLength={register ? 12 : 1}
            maxLength={256}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            className="password-reveal"
            aria-label={showPassword ? tr("隐藏密码") : tr("显示密码")}
            title={showPassword ? tr("隐藏密码") : tr("显示密码")}
            aria-controls="login-password"
            onClick={() => setShowPassword((shown) => !shown)}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        {register && (
          <p className="small muted">
            {tr("至少 12 个字符，建议使用密码管理器生成。")}
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {errorText(error)}
          </p>
        )}
        <button className="primary full" disabled={busy}>
          {busy ? tr("处理中…") : register ? tr("创建账号") : tr("登录工作台")}
          <ArrowUpRight size={17} />
        </button>
        {allowed && (
          <button
            type="button"
            className="text-button full"
            onClick={() => {
              setRegister(!register);
              setShowPassword(false);
            }}
          >
            {register ? tr("已有账号？登录") : tr("还没有账号？注册")}
          </button>
        )}
        <p className="small muted">
          <ShieldCheck size={13} />
          {tr("主机与凭据在服务端加密保存")}
        </p>
      </form>
    </div>
  );
}
function HostEditor({
  host,
  close,
  saved,
}: {
  host: Host | "new";
  close: () => void;
  saved: (host: Host, monitoring: boolean, autoInstall: boolean) => void;
}) {
  useLocale();
  const [value, setValue] = useState<Host>(
      host === "new"
        ? {
            id: "",
            name: "",
            address: "",
            port: 22,
            username: "",
            group: "",
            note: "",
            authType: "password",
            hasCredential: false,
            fingerprint: "",
            agentEnabled: false,
          }
        : host,
    ),
    [password, setPassword] = useState(""),
    [privateKey, setPrivateKey] = useState(""),
    [passphrase, setPassphrase] = useState(""),
    [saveCred, setSaveCred] = useState(true),
    [monitoring, setMonitoring] = useState(
      host !== "new" && !!host.agentEnabled,
    ),
    [monitorSettings, setMonitorSettings] =
      useState<AgentSettings>(defaultAgentSettings),
    [installation, setInstallation] = useState("auto"),
    [monitorLoaded, setMonitorLoaded] = useState(
      host === "new" || !host.agentEnabled,
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (host === "new" || !host.agentEnabled) return;
    let active = true;
    api<{ settings: AgentSettings }>(`/hosts/${host.id}/agent`)
      .then((a) => {
        if (active) {
          setMonitorSettings(a.settings);
          setMonitorLoaded(true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [host]);
  const field = (key: keyof Host, v: string | number) =>
    setValue({ ...value, [key]: v });
  return (
    <Modal
      title={host === "new" ? tr("添加主机") : tr("编辑主机")}
      close={close}
      className="host-editor"
    >
      {(requestClose) => (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const savedHost = await api<Host>(
                !value.id ? "/hosts" : `/hosts/${value.id}`,
                {
                  method: !value.id ? "POST" : "PUT",
                  body: body({
                    ...value,
                    clearCredential: !saveCred,
                    ...(saveCred && (password || privateKey)
                      ? { credential: { password, privateKey, passphrase } }
                      : {}),
                  }),
                },
              );
              setValue(savedHost);
              try {
                if (monitoring) {
                  await api(`/hosts/${savedHost.id}/agent`, {
                    method: "POST",
                    body: body({ settings: monitorSettings }),
                  });
                } else if (host !== "new" && host.agentEnabled) {
                  await api(`/hosts/${savedHost.id}/agent`, {
                    method: "DELETE",
                  });
                }
              } catch (e) {
                setError(
                  tr("主机已保存，探针配置失败：{0}", [(e as Error).message]),
                );
                return;
              }
              const newlyEnabled =
                monitoring && (host === "new" || !host.agentEnabled);
              requestClose(() =>
                saved(
                  { ...savedHost, agentEnabled: monitoring },
                  newlyEnabled,
                  newlyEnabled && installation === "auto",
                ),
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset>
            <legend>{tr("连接信息")}</legend>
            <label>
              {tr("主机名称")}
              <input
                autoFocus
                required
                maxLength={128}
                value={value.name}
                onChange={(e) => field("name", e.target.value)}
              />
            </label>
            <div className="form-row">
              <label>
                {tr("地址")}
                <input
                  required
                  value={value.address}
                  placeholder="192.168.1.10"
                  onChange={(e) => field("address", e.target.value)}
                />
              </label>
              <label className="narrow">
                {tr("端口")}
                <input
                  type="number"
                  min={1}
                  max={65535}
                  required
                  value={value.port}
                  onChange={(e) => field("port", Number(e.target.value))}
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                {tr("用户名")}
                <input
                  required
                  value={value.username}
                  autoComplete="off"
                  onChange={(e) => field("username", e.target.value)}
                />
              </label>
              <label>
                {tr("分组")}
                <input
                  value={value.group}
                  onChange={(e) => field("group", e.target.value)}
                />
              </label>
            </div>
          </fieldset>
          <fieldset className="monitoring-option">
            <legend>{tr("探针监控")}</legend>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={monitoring}
                onChange={(e) => setMonitoring(e.target.checked)}
              />
              {tr("持续采集资源、网络用量与告警（关闭 SSH 后仍运行）")}
            </label>
            {monitoring && (
              <p className="muted small">
                {tr("保存主机后生成一次性安装凭证；探针不获取 SSH 凭据。")}
              </p>
            )}
            {monitoring && (host === "new" || !host.agentEnabled) && (
              <div className="segmented">
                <button
                  type="button"
                  className={installation === "auto" ? "selected" : ""}
                  onClick={() => setInstallation("auto")}
                >
                  {tr("自动安装")}
                </button>
                <button
                  type="button"
                  className={installation === "manual" ? "selected" : ""}
                  onClick={() => setInstallation("manual")}
                >
                  {tr("手动安装")}
                </button>
              </div>
            )}
            {monitoring && (
              <div className="form-row monitoring-settings">
                <label>
                  {tr("采样间隔")}
                  <Select
                    aria-label={tr("采样间隔")}
                    value={monitorSettings.intervalSeconds}
                    onChange={(e) =>
                      setMonitorSettings({
                        ...monitorSettings,
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
                    value={monitorSettings.billingDay}
                    onChange={(e) =>
                      setMonitorSettings({
                        ...monitorSettings,
                        billingDay: Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
            )}
          </fieldset>
          <fieldset>
            <legend>{tr("安全凭据")}</legend>
            <label>
              {tr("认证方式")}
              <Select
                aria-label={tr("认证方式")}
                value={value.authType}
                onChange={(e) => field("authType", e.target.value)}
              >
                <option value="password">{tr("密码")}</option>
                <option value="key">{tr("SSH 私钥")}</option>
              </Select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={saveCred}
                onChange={(e) => setSaveCred(e.target.checked)}
              />
              {tr("加密保存凭据（关闭后每次连接临时输入）")}
            </label>
            {saveCred &&
              (value.authType === "password" ? (
                <label>
                  {tr("密码")}
                  {value.hasCredential && tr("（已配置，留空保留）")}
                  <PasswordInput
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              ) : (
                <>
                  <label>
                    {tr("私钥")}
                    {value.hasCredential && tr("（已配置，留空保留）")}
                    <textarea
                      rows={4}
                      value={privateKey}
                      onChange={(e) => setPrivateKey(e.target.value)}
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    {tr("私钥口令")}
                    <PasswordInput
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                    />
                  </label>
                </>
              ))}
          </fieldset>
          <label>
            {tr("备注")}
            <textarea
              rows={2}
              maxLength={4096}
              value={value.note}
              onChange={(e) => field("note", e.target.value)}
            />
          </label>
          {error && <p className="error">{errorText(error)}</p>}
          <footer>
            {host !== "new" && (
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  if (
                    await confirmAction(
                      tr(
                        "删除此主机？所有关联连接将关闭，AI 任务记录也会删除。",
                      ),
                      tr("删除"),
                      true,
                    )
                  ) {
                    try {
                      await api(`/hosts/${value.id}`, { method: "DELETE" });
                      requestClose(() => saved(value, false, false));
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }
                }}
              >
                <Trash2 size={14} />
                {tr("删除")}
              </button>
            )}
            <span className="grow" />
            <button type="button" onClick={() => requestClose()}>
              {tr("取消")}
            </button>
            <button className="primary" disabled={busy || !monitorLoaded}>
              {busy
                ? tr("保存中…")
                : monitoring &&
                    (host === "new" || !host.agentEnabled) &&
                    installation === "auto"
                  ? tr("保存并安装探针")
                  : tr("保存主机")}
            </button>
          </footer>
        </form>
      )}
    </Modal>
  );
}
function SettingsPanel({ close }: { close: () => void }) {
  useLocale();
  const [a, setA] = useState<AISettings>({
      source: "byok",
      baseUrl: "",
      model: "",
      completionModel: "",
      hasKey: false,
    }),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [billing, setBilling] = useState<{
      enabled: boolean;
      creditsPerPeriod: number;
      hasCustomer: boolean;
    } | null>(null),
    [usage, setUsage] = useState<{
      balance: number;
      subscriptionAvailable: boolean;
      records: {
        id: string;
        source: string;
        model: string;
        inputTokens: number;
        outputTokens: number;
        status: string;
      }[];
    } | null>(null);
  useEffect(() => {
    api<AISettings>("/ai/settings")
      .then(setA)
      .catch((e) => setError(e.message));
    api<typeof usage>("/ai/usage")
      .then(setUsage)
      .catch((e) => setError(e.message));
    api<typeof billing>("/billing/config")
      .then(setBilling)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <Modal title={tr("AI 服务与订阅")} close={close} className="settings-modal">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            setA(await api("/ai/settings", { method: "PUT", body: body(a) }));
            setSaved(true);
          } catch (e) {
            setError((e as APIError).message);
          }
        }}
      >
        <div className="segmented">
          <button
            type="button"
            className={a.source === "byok" ? "selected" : ""}
            onClick={() => setA({ ...a, source: "byok" })}
          >
            {tr("自带密钥 BYOK")}
          </button>
          <button
            type="button"
            className={a.source === "subscription" ? "selected" : ""}
            onClick={() => setA({ ...a, source: "subscription" })}
          >
            {tr("平台订阅")}
          </button>
        </div>
        {a.source === "byok" ? (
          <>
            <label>
              {tr("兼容 API 地址")}
              <input
                type="url"
                required
                placeholder="https://provider.example/v1"
                value={a.baseUrl}
                onChange={(e) => setA({ ...a, baseUrl: e.target.value })}
              />
            </label>
            <label>
              API Key {a.hasKey && tr("· 已加密配置")}
              <PasswordInput
                type="password"
                autoComplete="new-password"
                value={a.apiKey || ""}
                placeholder={
                  a.hasKey ? tr("留空保留原密钥") : tr("输入 API Key")
                }
                onChange={(e) => setA({ ...a, apiKey: e.target.value })}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={a.clearKey || false}
                onChange={(e) => setA({ ...a, clearKey: e.target.checked })}
              />
              {tr("删除已保存密钥")}
            </label>
            <label>
              {tr("运维模型")}
              <input
                required
                value={a.model}
                onChange={(e) => setA({ ...a, model: e.target.value })}
              />
            </label>
            <label>
              {tr("命令助手模型")}
              <input
                placeholder={tr("留空使用运维模型")}
                value={a.completionModel}
                onChange={(e) =>
                  setA({ ...a, completionModel: e.target.value })
                }
              />
            </label>
          </>
        ) : (
          <div className="notice">
            <h3>
              {tr("可用额度：")}
              {usage ? number(usage.balance) : 0} Token
            </h3>
            <p>
              {usage?.subscriptionAvailable
                ? tr("由平台提供 AI 服务，按请求预占、实际用量结算。")
                : tr("此部署尚未配置平台 AI 服务，请联系管理员。")}
            </p>
            <p className="small">
              {tr("不会自动切换到 BYOK 或其他计费来源。")}
            </p>
            {billing?.enabled && (
              <>
                <p>
                  {tr("每个订阅周期增加")}
                  {number(billing.creditsPerPeriod)}{" "}
                  {tr("Token，价格与周期在支付页面确认。")}
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const result = await api<{
                        url: string;
                      }>(
                        billing.hasCustomer
                          ? "/billing/portal"
                          : "/billing/checkout",
                        { method: "POST", body: "{}" },
                      );
                      location.assign(result.url);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {billing.hasCustomer ? tr("管理订阅与账单") : tr("前往订阅")}
                </button>
                {billing.hasCustomer && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={async () => {
                      try {
                        const result = await api<{
                          url: string;
                        }>("/billing/checkout", {
                          method: "POST",
                          body: "{}",
                        });
                        location.assign(result.url);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    {tr("订阅已结束？重新订阅")}
                  </button>
                )}
              </>
            )}
          </div>
        )}
        <p className="small muted">
          {tr(
            "仅在你使用 AI 时发送必要上下文。自动脱敏不能识别所有秘密，请审阅输入，勿发送凭据。",
          )}
        </p>
        {error && <p className="error">{errorText(error)}</p>}
        {saved && (
          <p className="success">
            <Check size={14} />
            {tr("设置已保存")}
          </p>
        )}
        <footer>
          <button className="primary">{tr("保存设置")}</button>
        </footer>
      </form>
      <h3 className="usage-heading">{tr("最近用量")}</h3>
      <div className="usage-list">
        {usage?.records.slice(0, 8).map((x) => (
          <div className="row" key={x.id}>
            <span>
              {x.model}
              <small className="muted"> · {statusLabel(x.source)}</small>
            </span>
            <span className="grow" />
            <span>{number(x.inputTokens + x.outputTokens)} Token</span>
            <small className="muted">{statusLabel(x.status)}</small>
          </div>
        ))}
        {!usage?.records.length && (
          <p className="muted">{tr("暂无调用记录")}</p>
        )}
      </div>
    </Modal>
  );
}
function TemporaryCredential({
  host,
  finish,
}: {
  host: Host;
  finish: (
    v: {
      password: string;
      privateKey: string;
      passphrase: string;
    } | null,
  ) => void;
}) {
  useLocale();
  const [password, setPassword] = useState(""),
    [privateKey, setPrivateKey] = useState(""),
    [passphrase, setPassphrase] = useState("");
  return (
    <Modal title={tr("临时连接凭据 · ") + host.name} close={() => finish(null)}>
      {(requestClose) => (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            requestClose(() => finish({ password, privateKey, passphrase }));
          }}
        >
          <p className="muted small">
            {tr("仅用于当前连接，不保存到数据库或浏览器存储。")}
          </p>
          {host.authType === "password" ? (
            <label>
              {tr("SSH 密码")}
              <PasswordInput
                autoFocus
                type="password"
                required
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          ) : (
            <>
              <label>
                {tr("SSH 私钥")}
                <textarea
                  autoFocus
                  required
                  rows={6}
                  autoComplete="off"
                  spellCheck={false}
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                />
              </label>
              <label>
                {tr("私钥口令")}
                <PasswordInput
                  type="password"
                  autoComplete="off"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
              </label>
            </>
          )}
          <footer>
            <span className="grow" />
            <button
              type="button"
              onClick={() => requestClose(() => finish(null))}
            >
              {tr("取消")}
            </button>
            <button className="primary">{tr("连接")}</button>
          </footer>
        </form>
      )}
    </Modal>
  );
}
function TransferCenter({
  close,
  navigate,
}: {
  close: () => void;
  navigate: (id: string) => void;
}) {
  useLocale();
  const groups = useTransfers((state) => state.byConnection),
    items = Object.values(groups).flat();
  return (
    <Modal title={tr("传输中心")} close={close}>
      {(requestClose) =>
        items.length === 0 ? (
          <div className="empty compact-empty">
            <ArrowDownUp size={32} />
            <h3>{tr("暂无传输任务")}</h3>
            <p>{tr("在连接的文件面板中上传或下载，进度会显示在这里。")}</p>
            <button onClick={() => requestClose()}>{tr("返回工作台")}</button>
          </div>
        ) : (
          items.map((t) => (
            <div className="transfer-row" key={t.id}>
              <span className={t.direction === "upload" ? "green" : "blue"}>
                {t.direction === "upload" ? "↑" : "↓"}
              </span>
              <div>
                <strong>{t.name}</strong>
                <small>
                  <button
                    className="text-button"
                    onClick={() => requestClose(() => navigate(t.connectionID))}
                  >
                    {t.hostName}
                  </button>{" "}
                  ·{" "}
                  {(t.error && errorText(t.error)) ||
                    {
                      uploading: tr("传输中"),
                      done: tr("已完成"),
                      failed: tr("失败"),
                      cancelled: tr("已取消"),
                    }[t.status]}
                </small>
              </div>
              <span className="grow" />
              <progress max={1} value={t.progress} />
              <span>{Math.round(t.progress * 100)}%</span>
              <small>{bytes(t.speed)}/s</small>
              {t.status === "uploading" ? (
                <button onClick={t.cancel}>{tr("取消")}</button>
              ) : t.status !== "done" ? (
                <button onClick={t.retry}>{tr("重试")}</button>
              ) : null}
            </div>
          ))
        )
      }
    </Modal>
  );
}
function PageNavigation({
  page,
  setPage,
  count,
}: {
  page: string;
  setPage: (page: string) => void;
  count: number;
}) {
  useLocale();
  return (
    <>
      {" "}
      <button
        className={page === "hosts" ? "navlink active" : "navlink"}
        onClick={() => setPage("hosts")}
      >
        <Server size={16} />
        {tr("主机管理")}
      </button>
      <button
        className={page === "ai" ? "navlink active" : "navlink"}
        onClick={() => setPage("ai")}
      >
        <Sparkles size={16} />
        {tr("AI 运维")}
      </button>
      <button
        className={page === "workspace" ? "navlink active" : "navlink"}
        onClick={() => setPage("workspace")}
      >
        <Monitor size={16} />
        {tr("工作台")}
        {count > 0 && <span className="count">{count}</span>}
      </button>
    </>
  );
}
