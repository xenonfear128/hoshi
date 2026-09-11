import { useEffect, useState, useSyncExternalStore } from "react";
import { Modal } from "./Modal";
import { errorText, tr, useLocale } from "./i18n";
let sequence = 0;
type Request = {
  id: number;
  message: string;
  value?: string;
  input: boolean;
  action?: string;
  danger?: boolean;
  resolve: (value: string | null) => void;
};
let queue: Request[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const confirmAction = (
  message: string,
  action?: string,
  danger = false,
) =>
  new Promise<boolean>((resolve) => {
    queue = [
      ...queue,
      {
        id: ++sequence,
        message,
        action,
        danger,
        input: false,
        resolve: (value) => resolve(value !== null),
      },
    ];
    emit();
  });
export const promptValue = (message: string, value = "") =>
  new Promise<string | null>((resolve) => {
    queue = [
      ...queue,
      { id: ++sequence, message, value, input: true, resolve },
    ];
    emit();
  });
function cancelAll() {
  const pending = queue;
  queue = [];
  emit();
  pending.forEach((r) => r.resolve(null));
}
export function DialogHost() {
  useLocale();
  const request = useSyncExternalStore(subscribe, () => queue[0]);
  useEffect(() => {
    window.addEventListener("session-expired", cancelAll);
    return () => {
      window.removeEventListener("session-expired", cancelAll);
      cancelAll();
    };
  }, []);
  if (!request) return null;
  return (
    <ActionDialog
      key={request.id}
      request={request}
      finish={(value) => {
        queue = queue.filter((r) => r !== request);
        emit();
        request.resolve(value);
      }}
    />
  );
}
function ActionDialog({
  request,
  finish,
}: {
  request: Request;
  finish: (v: string | null) => void;
}) {
  useLocale();
  const [value, setValue] = useState(request.value || "");
  return (
    <Modal
      title={request.input ? tr("输入信息") : tr("确认操作")}
      className="action-dialog"
      language={false}
      close={() => finish(null)}
    >
      {(requestClose) => (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            requestClose(() => finish(request.input ? value : "confirmed"));
          }}
        >
          {request.input ? (
            <label>
              {errorText(request.message)}
              <input
                data-initial-focus
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
          ) : (
            <p className="dialog-message">{errorText(request.message)}</p>
          )}
          <footer>
            <button
              data-initial-focus={!request.input || undefined}
              type="button"
              onClick={() => requestClose(() => finish(null))}
            >
              {tr("取消")}
            </button>
            <button className={request.danger ? "danger" : "primary"}>
              {request.action || tr("确认")}
            </button>
          </footer>
        </form>
      )}
    </Modal>
  );
}
