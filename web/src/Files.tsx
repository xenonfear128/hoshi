import { Select } from "./Select";
import { confirmAction, promptValue } from "./Dialogs";
import { errorText } from "./i18n";
import { dateTime } from "./i18n";
import { tr, useLocale } from "./i18n";
import { useEffect, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Download,
  MoreHorizontal,
  Copy,
  FileText,
  Folder,
  FolderPlus,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { api, body, bytes, shellQuote, type Connection, APIError } from "./api";
import { Modal } from "./Modal";
import { downloadStream } from "./download";
import { useTransfers } from "./transfers";
type Entry = {
  name: string;
  size: number;
  mode: string;
  permissions: string;
  directory: boolean;
  symlink: boolean;
  modified: string;
};
type Transfer = {
  id: string;
  name: string;
  progress: number;
  speed: number;
  status: "uploading" | "done" | "failed" | "cancelled";
  direction?: "upload" | "download";
  abort?: () => void;
  file?: File;
  path: string;
  error?: string;
  xhr?: XMLHttpRequest;
};
export default function Files({
  connection: c,
  theme,
  insert,
  open,
  toggle,
}: {
  connection: Connection;
  theme: string;
  insert: (s: string) => void;
  open: boolean;
  toggle: () => void;
}) {
  useLocale();
  const [path, setPath] = useState(""),
    [pathInput, setPathInput] = useState(""),
    [entries, setEntries] = useState<Entry[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("files"),
    [hidden, setHidden] = useState(false),
    [sort, setSort] = useState("name"),
    [selected, setSelected] = useState<string[]>([]),
    [transfers, setTransfers] = useState<Transfer[]>([]),
    [editor, setEditor] = useState<{
      path: string;
      content: string;
      version: string;
    } | null>(null);
  const input = useRef<HTMLInputElement>(null),
    running = useRef(new Map<string, XMLHttpRequest>());
  const downloads = useRef(new Map<string, AbortController>());
  const prefix = `/connections/${c.id}`;
  async function load(p = path) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        path: string;
        entries: Entry[];
      }>(prefix + "/files?path=" + encodeURIComponent(p));
      setEntries(result.entries);
      setPath(result.path);
      setPathInput(result.path);
      setSelected([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load("");
    return () => {
      for (const xhr of running.current.values()) xhr.abort();
      for (const abort of downloads.current.values()) abort.abort();
    };
  }, [c.id]);
  const full = (name: string) => (path === "/" ? "" : path) + "/" + name;
  async function op(
    operation: string,
    p: string,
    target?: string,
    permissions?: string,
  ) {
    setError("");
    try {
      await api(prefix + "/files", {
        method: "POST",
        body: body({
          operation,
          path: p,
          target: target || "",
          permissions: permissions || "",
        }),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function upload(
    file: File,
    p = full(file.name),
    existingID?: string,
    overwrite = false,
  ) {
    const id = existingID || crypto.randomUUID(),
      xhr = new XMLHttpRequest(),
      start = performance.now();
    const t: Transfer = {
      id,
      name: file.name,
      progress: 0,
      speed: 0,
      status: "uploading",
      file,
      path: p,
      xhr,
    };
    setTransfers((old) =>
      existingID ? old.map((x) => (x.id === id ? t : x)) : [...old, t],
    );
    running.current.set(id, xhr);
    const update = (v: Partial<Transfer>) =>
      setTransfers((old) => old.map((x) => (x.id === id ? { ...x, ...v } : x)));
    xhr.open(
      "POST",
      "/api" +
        prefix +
        "/upload?path=" +
        encodeURIComponent(p) +
        "&overwrite=" +
        overwrite,
    );
    xhr.setRequestHeader("X-Upload-Size", String(file.size));
    xhr.upload.onprogress = (e) => {
      update({
        progress: e.lengthComputable ? e.loaded / e.total : 0,
        speed: e.loaded / Math.max(0.1, (performance.now() - start) / 1000),
      });
    };
    xhr.onload = async () => {
      running.current.delete(id);
      if (xhr.status >= 200 && xhr.status < 300) {
        update({ status: "done", progress: 1 });
        void load();
      } else {
        let message = tr("上传失败");
        try {
          message = JSON.parse(xhr.responseText).error || message;
        } catch {}
        update({ status: "failed", error: message });
        if (
          xhr.status === 409 &&
          !overwrite &&
          (await confirmAction(
            tr("{0} 已存在或重命名失败。是否覆盖？", [file.name]),
            tr("覆盖"),
            true,
          ))
        )
          upload(file, p, id, true);
      }
    };
    xhr.onerror = () => {
      running.current.delete(id);
      update({ status: "failed", error: tr("网络错误") });
    };
    xhr.onabort = () => {
      running.current.delete(id);
      update({ status: "cancelled" });
    };
    xhr.send(file);
  }
  async function edit(e: Entry) {
    try {
      const result = await api<{
        content: string;
        version: string;
      }>(prefix + "/text?path=" + encodeURIComponent(full(e.name)));
      setEditor({ path: full(e.name), ...result });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const download = async (e: Entry, p = full(e.name), existingID?: string) => {
    const id = existingID || crypto.randomUUID(),
      controller = new AbortController(),
      start = performance.now();
    downloads.current.set(id, controller);
    const transfer: Transfer = {
      id,
      name: e.name,
      progress: 0,
      speed: 0,
      status: "uploading",
      direction: "download",
      path: p,
      abort: () => controller.abort(),
    };
    setTransfers((old) =>
      existingID
        ? old.map((t) => (t.id === id ? transfer : t))
        : [...old, transfer],
    );
    const update = (v: Partial<Transfer>) =>
      setTransfers((old) => old.map((t) => (t.id === id ? { ...t, ...v } : t)));
    try {
      await downloadStream(
        "/api" + prefix + "/download?path=" + encodeURIComponent(p),
        e.name,
        controller.signal,
        (loaded, total) =>
          update({
            progress: total ? loaded / total : 0,
            speed: loaded / Math.max(0.1, (performance.now() - start) / 1000),
          }),
      );
      update({ status: "done", progress: 1 });
    } catch (error) {
      const err = error as Error;
      update({
        status: err.name === "AbortError" ? "cancelled" : "failed",
        error: err.message,
      });
    } finally {
      downloads.current.delete(id);
    }
  };
  useEffect(() => {
    useTransfers.getState().update(
      c.id,
      transfers.map((t) => ({
        id: t.id,
        name: t.name,
        connectionID: c.id,
        hostName: c.host.name,
        direction: t.direction || "upload",
        status: t.status,
        progress: t.progress,
        speed: t.speed,
        error: t.error,
        cancel: () => {
          t.xhr?.abort();
          t.abort?.();
        },
        retry: () => {
          if (t.direction === "download")
            void download({ name: t.name } as Entry, t.path, t.id);
          else if (t.file) upload(t.file, t.path, t.id);
        },
      })),
    );
  }, [transfers, c.id, c.host.name]);
  useEffect(() => () => useTransfers.getState().remove(c.id), [c.id]);
  const visible = entries
    .filter((e) => hidden || !e.name.startsWith("."))
    .sort((a, b) =>
      a.directory !== b.directory
        ? a.directory
          ? -1
          : 1
        : sort === "size"
          ? b.size - a.size
          : sort === "modified"
            ? Date.parse(b.modified) - Date.parse(a.modified)
            : a.name.localeCompare(b.name),
    );
  return (
    <div
      className="files"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          for (const f of Array.from(e.dataTransfer.files)) upload(f);
        }
      }}
    >
      <header className="file-tabs">
        <button
          className={tab === "files" ? "selected" : ""}
          onClick={() => setTab("files")}
        >
          {tr("文件浏览")}
        </button>
        <button
          className={tab === "transfers" ? "selected" : ""}
          onClick={() => setTab("transfers")}
        >
          {tr("传输任务")}{" "}
          <span className="count">
            {transfers.filter((t) => t.status === "uploading").length}
          </span>
        </button>
        <span className="grow" />
        <span className="small muted">SFTP</span>
        <button
          className="icon"
          title={tr("收起/展开文件面板")}
          onClick={toggle}
        >
          {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
      </header>
      {open && (
        <>
          {error && (
            <div className="error small">
              {errorText(error)}
              <button className="icon" onClick={() => setError("")}>
                <X size={12} />
              </button>
            </div>
          )}
          {tab === "files" ? (
            <>
              <div className="path-toolbar">
                <button
                  className="icon"
                  title={tr("上级目录")}
                  onClick={() =>
                    load(path.slice(0, path.lastIndexOf("/")) || "/")
                  }
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  className="icon"
                  title={tr("刷新目录")}
                  disabled={busy}
                  onClick={() => load()}
                >
                  <RefreshCw size={14} />
                </button>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void load(pathInput);
                  }}
                >
                  <input
                    aria-label={tr("远端路径")}
                    value={pathInput}
                    onChange={(e) => setPathInput(e.target.value)}
                  />
                </form>
                <button
                  title={tr("终端进入此目录（填入后回车执行）")}
                  onClick={() => insert("cd -- " + shellQuote(path))}
                >
                  {tr("→ 终端")}
                </button>
                <input
                  hidden
                  type="file"
                  multiple
                  ref={input}
                  onChange={(e) => {
                    for (const f of Array.from(e.target.files || [])) upload(f);
                    e.target.value = "";
                  }}
                />
                <button onClick={() => input.current?.click()}>
                  <Upload size={13} />
                  {tr("上传")}
                </button>
                <button
                  title={tr("新建目录")}
                  onClick={async () => {
                    const name = await promptValue(tr("新建目录名称"));
                    if (name && !name.includes("/"))
                      void op("mkdir", full(name));
                  }}
                >
                  <FolderPlus size={14} />
                </button>
                <button
                  title={tr("新建文件")}
                  onClick={async () => {
                    const name = await promptValue(tr("新建文件名称"));
                    if (name && !name.includes("/"))
                      void op("create", full(name));
                  }}
                >
                  {tr("＋文件")}
                </button>
              </div>
              <div className="file-options">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={hidden}
                    onChange={(e) => setHidden(e.target.checked)}
                  />
                  {tr("隐藏文件")}
                </label>
                <Select
                  aria-label={tr("文件排序")}
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="name">{tr("名称")}</option>
                  <option value="size">{tr("大小")}</option>
                  <option value="modified">{tr("修改时间")}</option>
                </Select>
                {selected.length > 0 && (
                  <>
                    <span>
                      {selected.length}
                      {tr("项")}
                    </span>
                    <button
                      onClick={() => {
                        for (const name of selected) {
                          const e = entries.find((x) => x.name === name);
                          if (e && !e.directory) void download(e);
                        }
                      }}
                    >
                      {tr("下载所选")}
                    </button>
                    <button
                      className="danger"
                      onClick={async () => {
                        if (
                          await confirmAction(
                            tr("删除 {0} 项？目录必须为空，删除不可撤销。", [
                              selected.length,
                            ]),
                            tr("删除"),
                            true,
                          )
                        ) {
                          for (const name of selected)
                            await op("delete", full(name));
                        }
                      }}
                    >
                      {tr("删除所选")}
                    </button>
                  </>
                )}
              </div>
              <div className="file-table-wrap">
                <table className="file-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>{tr("名称")}</th>
                      <th>{tr("大小")}</th>
                      <th>{tr("权限")}</th>
                      <th>{tr("修改时间")}</th>
                      <th>{tr("操作")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((e) => (
                      <tr
                        key={e.name}
                        onDoubleClick={() =>
                          e.directory ? load(full(e.name)) : edit(e)
                        }
                      >
                        <td>
                          <input
                            type="checkbox"
                            aria-label={tr("选择 {0}", [e.name])}
                            checked={selected.includes(e.name)}
                            onChange={(ev) =>
                              setSelected((old) =>
                                ev.target.checked
                                  ? [...old, e.name]
                                  : old.filter((n) => n !== e.name),
                              )
                            }
                          />
                        </td>
                        <td>
                          <button
                            className="filename"
                            title={e.name}
                            draggable
                            onDragStart={(ev) =>
                              ev.dataTransfer.setData(
                                "text/plain",
                                shellQuote(full(e.name)),
                              )
                            }
                            onClick={() =>
                              e.directory ? load(full(e.name)) : edit(e)
                            }
                          >
                            {e.directory ? (
                              <Folder size={15} className="folder-color" />
                            ) : (
                              <FileText size={14} className="blue" />
                            )}
                            <span>
                              {e.name}
                              {e.symlink && " ↗"}
                            </span>
                          </button>
                        </td>
                        <td>{e.directory ? "—" : bytes(e.size)}</td>
                        <td>
                          <button
                            className="text-button mono"
                            title={tr("修改权限")}
                            onClick={async () => {
                              const p = await promptValue(
                                tr("权限（0000–0777）"),
                                e.permissions,
                              );
                              if (p)
                                void op("chmod", full(e.name), undefined, p);
                            }}
                          >
                            {e.mode}
                          </button>
                        </td>
                        <td>{dateTime(e.modified)}</td>
                        <td>
                          <details className="file-actions">
                            <summary
                              aria-label={tr("更多操作") + " · " + e.name}
                            >
                              <MoreHorizontal size={18} />
                            </summary>
                            <div className="row">
                              {!e.directory && (
                                <button
                                  className="icon"
                                  title={tr("下载")}
                                  onClick={() => download(e)}
                                >
                                  <Download size={13} />
                                </button>
                              )}
                              <button
                                className="text-button"
                                onClick={async () => {
                                  const p = await promptValue(
                                    tr("重命名或移动到绝对路径"),
                                    full(e.name),
                                  );
                                  if (p && p !== full(e.name))
                                    void op("rename", full(e.name), p);
                                }}
                              >
                                {tr("移动")}
                              </button>
                              <button
                                className="text-button"
                                onClick={() =>
                                  navigator.clipboard
                                    .writeText(full(e.name))
                                    .catch(() => setError(tr("剪贴板不可用")))
                                }
                              >
                                {tr("路径")}
                              </button>
                              <button
                                className="text-button danger"
                                onClick={async () => {
                                  if (
                                    await confirmAction(
                                      tr("删除 {0}？不可撤销，目录必须为空。", [
                                        e.name,
                                      ]),
                                      tr("删除"),
                                      true,
                                    )
                                  )
                                    void op("delete", full(e.name));
                                }}
                              >
                                {tr("删除")}
                              </button>
                            </div>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visible.length && (
                  <div className="small-empty">
                    {busy ? tr("正在读取…") : tr("此目录为空")}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="transfer-list">
              {transfers.map((t) => (
                <div className="transfer-row" key={t.id}>
                  {t.direction === "download" ? (
                    <Download size={15} />
                  ) : (
                    <Upload size={15} />
                  )}
                  <div>
                    <strong>{t.name}</strong>
                    <small>
                      {(t.error && errorText(t.error)) ||
                        {
                          uploading:
                            t.direction === "download"
                              ? tr("下载中")
                              : tr("上传中"),
                          done: tr("已完成"),
                          failed: tr("失败"),
                          cancelled: tr("已取消"),
                        }[t.status]}
                    </small>
                  </div>
                  <span className="grow" />
                  <progress max={1} value={t.progress} />
                  <span>{Math.round(t.progress * 100)}%</span>
                  <span className="muted">{bytes(t.speed)}/s</span>
                  {t.status === "uploading" ? (
                    <button
                      onClick={() => {
                        t.xhr?.abort();
                        t.abort?.();
                      }}
                    >
                      {tr("取消")}
                    </button>
                  ) : t.status !== "done" ? (
                    <button
                      onClick={() =>
                        t.direction === "download"
                          ? download({ name: t.name } as Entry, t.path, t.id)
                          : t.file && upload(t.file, t.path, t.id)
                      }
                    >
                      {tr("重试")}
                    </button>
                  ) : null}
                </div>
              ))}
              {!transfers.length && (
                <div className="small-empty">
                  {tr(
                    "拖入文件或选择上传、下载开始传输。文件以数据流传输，不整份载入内存。",
                  )}
                </div>
              )}
            </div>
          )}
          {transfers.some((t) => t.status === "uploading") && (
            <button
              className="transfer-strip"
              onClick={() => setTab("transfers")}
            >
              <Upload size={12} />
              {transfers.filter((t) => t.status === "uploading").length}{" "}
              {tr("个文件正在传输")}
              <span className="grow" />
              {tr("查看任务 →")}
            </button>
          )}
        </>
      )}
      {editor && (
        <TextEditor
          file={editor}
          prefix={prefix}
          theme={theme}
          close={() => setEditor(null)}
          saved={() => load()}
        />
      )}
    </div>
  );
}
function TextEditor({
  file,
  prefix,
  theme,
  close,
  saved,
}: {
  file: {
    path: string;
    content: string;
    version: string;
  };
  prefix: string;
  theme: string;
  close: () => void;
  saved: () => void;
}) {
  useLocale();
  const [content, setContent] = useState(file.content),
    [version, setVersion] = useState(file.version),
    [original, setOriginal] = useState(file.content),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const dirty = content !== original;
  const directory = file.path.slice(0, file.path.lastIndexOf("/")) || "/";
  const split = directory.lastIndexOf("/");
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [dirty]);
  return (
    <Modal
      title={
        (file.path.split("/").pop() || file.path) +
        (dirty ? tr(" · 未保存") : "")
      }
      className="file-editor-modal"
      language={false}
      subtitle={
        <div className="editor-path">
          <span title={file.path} className="path-parts">
            <span className="path-start">{directory.slice(0, split + 1)}</span>
            <span className="path-end">{directory.slice(split + 1)}</span>
          </span>
          <button
            className="icon"
            title={tr("复制完整路径")}
            onClick={() =>
              navigator.clipboard
                .writeText(file.path)
                .catch(() => setError(tr("剪贴板不可用")))
            }
          >
            <Copy size={16} />
          </button>
        </div>
      }
      close={close}
      beforeClose={async () =>
        !dirty ||
        (await confirmAction(tr("放弃未保存的修改？"), tr("放弃修改"), true))
      }
    >
      <div className="editor-content">
        <CodeMirror
          extensions={
            file.path.endsWith(".json")
              ? [json()]
              : /\.ya?ml$/.test(file.path)
                ? [yaml()]
                : []
          }
          value={content}
          height="100%"
          theme={theme === "dark" ? "dark" : "light"}
          onChange={setContent}
        />
      </div>
      {error && <p className="error">{errorText(error)}</p>}
      <footer>
        <button
          type="button"
          onClick={async () => {
            if (
              dirty &&
              !(await confirmAction(
                tr("重新加载会丢弃当前修改，继续？"),
                tr("重新加载"),
                true,
              ))
            )
              return;
            try {
              const r = await api<{
                content: string;
                version: string;
              }>(prefix + "/text?path=" + encodeURIComponent(file.path));
              setContent(r.content);
              setOriginal(r.content);
              setVersion(r.version);
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          {tr("重新加载")}
        </button>
        <span className="grow" />
        <button
          className="primary"
          disabled={!dirty || busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const r = await api<{
                version: string;
              }>(prefix + "/text", {
                method: "PUT",
                body: body({ path: file.path, content, version }),
              });
              setVersion(r.version);
              setOriginal(content);
              saved();
            } catch (e) {
              setError((e as APIError).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? tr("保存中…") : tr("保存文件")}
        </button>
      </footer>
    </Modal>
  );
}
