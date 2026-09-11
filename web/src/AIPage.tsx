import { Select } from "./Select";
import { confirmAction, promptValue } from "./Dialogs";
import { errorText } from "./i18n";
import { statusLabel, projectName } from "./i18n";
import { tr, useLocale } from "./i18n";
import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Play,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import { api, body, type Host, type Connection } from "./api";
type Step = {
  command: string;
  explanation: string;
  risk: string;
  output?: string;
  error?: string;
};
type Task = {
  id: string;
  hostId: string;
  request: string;
  summary: string;
  result?: string;
  resultError?: string;
  steps: Step[];
  planHash: string;
  status: string;
  createdAt: string;
};
export default function AIPage({
  hosts,
  connections,
  connect,
}: {
  hosts: Host[];
  connections: Connection[];
  connect: (h: Host) => Promise<Connection | undefined>;
}) {
  useLocale();
  const [hostID, setHostID] = useState(hosts[0]?.id || ""),
    [request, setRequest] = useState(""),
    [tasks, setTasks] = useState<Task[]>([]),
    [current, setCurrent] = useState<Task | null>(null),
    [busy, setBusy] = useState(false),
    [running, setRunning] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false),
    [error, setError] = useState("");
  async function load() {
    try {
      setTasks(await api<Task[]>("/ai/tasks"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function execute() {
    if (!current) return;
    const task = current,
      h = hosts.find((h) => h.id === task.hostId);
    if (!h) return;
    const text = task.steps
      .map((s, i) => `${i + 1}. [${s.risk}] ${s.command}`)
      .join("\n");
    if (
      !(await confirmAction(
        tr(
          "目标：{0} ({1})\n\n{2}\n\n确认执行以上全部命令？每条命令独立运行，脱敏后的输出将发送给当前 AI 服务生成结果分析并计入用量。停止不会撤销已完成变更。",
          [h.name, h.address, text],
        ),
        tr("确认方案并执行"),
        true,
      ))
    )
      return;
    if (
      task.steps.some((s) => s.risk !== "read") &&
      (await promptValue(tr("包含变更操作。请输入目标主机名称再次确认："))) !==
        h.name
    )
      return;
    setError("");
    setRunning(true);
    try {
      const c =
        connections.find((c) => c.host.id === h.id) || (await connect(h));
      if (!c) {
        setRunning(false);
        return;
      }
      const response = await fetch(`/api/ai/tasks/${task.id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body({
          connectionId: c.id,
          planHash: task.planHash,
          confirmHost: task.hostId,
          confirmName: h.name,
        }),
      });
      if (!response.ok) {
        const e = await response.json();
        throw new Error(e.error || tr("执行失败"));
      }
      setCurrent({ ...task, status: "running" });
      const reader = response.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const event = chunk.match(/event: (.+)/)?.[1],
            raw = chunk.match(/data: (.+)/)?.[1];
          if (!raw) continue;
          const data = JSON.parse(raw);
          if (event === "output")
            setCurrent((old) =>
              old
                ? {
                    ...old,
                    steps: old.steps.map((s, i) =>
                      i === data.index
                        ? { ...s, output: data.output, error: data.error }
                        : s,
                    ),
                  }
                : old,
            );
          if (event === "done") setCurrent(data);
          if (event === "summary")
            setCurrent((old) =>
              old
                ? { ...old, result: data.result, resultError: data.error }
                : old,
            );
          if (event === "error") setError(data.error);
        }
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }
  const composer = (
    <form
      className="ai-request"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!hostID || !request.trim()) return;
        setBusy(true);
        setError("");
        try {
          const t = await api<Task>("/ai/tasks", {
            method: "POST",
            body: body({
              hostId: hostID,
              request,
              parentId: current?.hostId === hostID ? current.id : undefined,
            }),
          });
          setCurrent(t);
          setRequest("");
          void load();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <textarea
        aria-label={tr("运维需求")}
        placeholder={tr("描述需求或补充条件，生成新的待确认方案…")}
        rows={2}
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        maxLength={8000}
      />
      <button
        className="primary"
        disabled={busy || running || !hostID || !request.trim()}
      >
        <Send size={16} />
        {busy ? tr("生成方案中…") : tr("生成方案")}
      </button>
      <p className="small muted">
        {tr("需求、关联任务上下文及确认执行后的脱敏输出会发送给所选 AI 服务。")}
      </p>
    </form>
  );
  return (
    <main className={`ai-page ${current ? "has-plan" : ""}`}>
      <button
        className="history-toggle"
        aria-expanded={historyOpen}
        aria-controls="task-history"
        onClick={() => setHistoryOpen(!historyOpen)}
      >
        {tr("运维记录")} · {tasks.length}
      </button>
      <aside
        id="task-history"
        className={`task-history ${historyOpen ? "open" : ""}`}
      >
        <div className="section-label">
          {tr("运维记录")}
          <button
            onClick={() => {
              setCurrent(null);
              setRequest("");
            }}
          >
            {tr("＋新任务")}
          </button>
        </div>
        {tasks.map((t) => (
          <button
            className={
              current?.id === t.id ? "history-item selected" : "history-item"
            }
            key={t.id}
            onClick={() => {
              setCurrent(t);
              setHostID(t.hostId);
              setHistoryOpen(false);
            }}
          >
            <span>{t.request}</span>
            <small>
              {hosts.find((h) => h.id === t.hostId)?.name || tr("主机")} ·{" "}
              {statusLabel(t.status)}
            </small>
          </button>
        ))}
        {!tasks.length && (
          <p className="small muted">
            {tr("任务方案与脱敏后的执行结果会保存在这里。")}
          </p>
        )}
      </aside>
      <section className="ai-work">
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              {projectName()} / {tr("AI 运维")}
            </div>
            <h1>{tr("让下一步，更清晰。")}</h1>
            <p>{tr("描述运维目标，审阅命令，再决定是否执行。")}</p>
          </div>
          <span className="spark-mark">
            <Sparkles size={30} />
          </span>
        </div>
        <div className="target-select">
          <ShieldCheck size={17} />
          <span>{tr("目标主机")}</span>
          <Select
            aria-label={tr("AI 目标主机")}
            value={hostID}
            disabled={running}
            onChange={(e) => {
              setHostID(e.target.value);
              setCurrent(null);
            }}
          >
            <option value="" disabled>
              {tr("选择主机")}
            </option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </Select>
        </div>
        <p className="target-address mono">
          {hosts.find((h) => h.id === hostID)?.address}
        </p>
        {error && <p className="error">{errorText(error)}</p>}
        {!current && composer}
        {!current ? (
          <div className="ai-welcome">
            <Sparkles size={42} />
            <h2>{tr("从一个问题开始。")}</h2>
            <p>{tr("先排查问题，再决定是否变更。")}</p>
            <div className="suggestions">
              {[
                tr("排查内存占用过高的原因"),
                tr("检查磁盘空间，找出最大的目录"),
                tr("检查 Nginx 配置与服务状态"),
              ].map((q) => (
                <button key={q} onClick={() => setRequest(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <article className="plan">
            <div className="request-bubble">{current.request}</div>
            <h2>{current.summary}</h2>
            <div className="row">
              <span className="tag">{statusLabel(current.status)}</span>
              <span className="small muted">
                {tr("命令由模型生成，请核对风险与目标。")}
              </span>
              <span className="grow" />
              {current.status !== "running" && (
                <button
                  className="icon danger"
                  title={tr("删除记录")}
                  onClick={async () => {
                    if (
                      await confirmAction(
                        tr("删除此任务记录？"),
                        tr("删除"),
                        true,
                      )
                    ) {
                      try {
                        await api(`/ai/tasks/${current.id}`, {
                          method: "DELETE",
                        });
                        setCurrent(null);
                        void load();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }
                  }}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
            {current.steps.map((s, i) => (
              <section className="plan-step" key={i}>
                <div className="row">
                  <span className="step-index">{i + 1}</span>
                  <strong>{s.explanation}</strong>
                  <span className="grow" />
                  <span className={s.risk === "read" ? "tag" : "tag risk"}>
                    {s.risk === "read"
                      ? tr("诊断")
                      : s.risk === "write"
                        ? tr("修改")
                        : tr("高风险")}
                  </span>
                </div>
                <pre>{s.command}</pre>
                {s.output && <pre className="command-output">{s.output}</pre>}
                {s.error && <p className="error">{errorText(s.error)}</p>}
              </section>
            ))}
            {current.result && (
              <section className="result-summary">
                <h3>{tr("结果分析")}</h3>
                <p style={{ whiteSpace: "pre-wrap" }}>{current.result}</p>
              </section>
            )}
            {current.resultError && (
              <p className="error">
                {tr("命令结果已保存，AI 分析未完成：")}
                {current.resultError}
              </p>
            )}
            <div className="plan-actions">
              {current.status === "planned" && !running && (
                <button className="primary" onClick={execute}>
                  <Play size={15} />
                  {tr("确认方案并执行")}
                </button>
              )}
              {(running || current.status === "running") && (
                <button
                  className="danger"
                  onClick={() =>
                    api(`/ai/tasks/${current.id}/cancel`, {
                      method: "POST",
                      body: "{}",
                    }).catch((e) => setError(e.message))
                  }
                >
                  <Square size={14} />
                  {tr("停止执行")}
                </button>
              )}
              {current.status === "complete" && (
                <span className="green">
                  <CheckCircle2 size={17} />
                  {tr("执行完成")}
                </span>
              )}
              <span className="small muted">
                {tr("停止不会自动撤销已完成的变更。")}
              </span>
            </div>
          </article>
        )}
        {current && composer}
      </section>
    </main>
  );
}
