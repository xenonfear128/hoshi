import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import LanguageSwitcher from "./LanguageSwitcher";
import { tr, useLocale } from "./i18n";
const stack: HTMLElement[] = [];
export type ModalClose = (after?: () => void) => void;
type ModalChildren = ReactNode | ((close: ModalClose) => ReactNode);
let savedOverflow = "";
let savedRootOverflow = "";
export function Modal({
  title,
  children,
  close,
  className = "",
  subtitle,
  language = true,
  beforeClose,
}: {
  title: string;
  children: ModalChildren;
  close: () => void;
  className?: string;
  subtitle?: ReactNode;
  language?: boolean;
  beforeClose?: () => boolean | Promise<boolean>;
}) {
  useLocale();
  const ref = useRef<HTMLElement>(null),
    closeRef = useRef(close),
    beforeCloseRef = useRef(beforeClose),
    id = useId(),
    closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const pendingCloseRef = useRef(false);
  const afterCloseRef = useRef<(() => void) | undefined>(undefined);
  closeRef.current = close;
  beforeCloseRef.current = beforeClose;
  const requestClose = useCallback(async (after?: () => void) => {
    if (closingRef.current || pendingCloseRef.current) return;
    pendingCloseRef.current = true;
    let allowed = true;
    try {
      allowed = (await beforeCloseRef.current?.()) ?? true;
    } catch {
      allowed = false;
    }
    pendingCloseRef.current = false;
    if (!allowed) return;
    afterCloseRef.current = after;
    closingRef.current = true;
    setClosing(true);
  }, []);
  const finishClose = useCallback(() => {
    if (!closingRef.current) return;
    const after = afterCloseRef.current;
    afterCloseRef.current = undefined;
    after?.();
    if (!after) closeRef.current();
  }, []);
  const content =
    typeof children === "function" ? children(requestClose) : children;
  useEffect(() => {
    const node = ref.current!,
      before = document.activeElement as HTMLElement | null;
    const root = document.getElementById("root");
    if (!stack.length) {
      savedOverflow = document.body.style.overflow;
      savedRootOverflow = root?.style.overflow || "";
    }
    stack.push(node);
    document.documentElement.setAttribute("data-modal-open", "");
    document.body.style.overflow = "hidden";
    if (root) root.style.overflow = "hidden";
    const focusables = () =>
      [
        ...node.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex="0"]',
        ),
      ].filter((e) => e.getClientRects().length);
    if (!node.contains(document.activeElement))
      (
        node.querySelector<HTMLElement>("[data-initial-focus]") ||
        focusables()[0] ||
        node
      ).focus();
    const key = (e: KeyboardEvent) => {
      if (stack.at(-1) !== node) return;
      if (e.key === "Escape") {
        if (node.querySelector(":popover-open")) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        requestClose();
      }
      if (e.key === "Tab") {
        const list = focusables(),
          first = list[0],
          last = list.at(-1);
        if (!first) {
          e.preventDefault();
          node.focus();
        } else if (
          e.shiftKey &&
          (document.activeElement === first ||
            !node.contains(document.activeElement))
        ) {
          e.preventDefault();
          last?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            !node.contains(document.activeElement))
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    const focus = (e: FocusEvent) => {
      if (stack.at(-1) === node && !node.contains(e.target as Node))
        (focusables()[0] || node).focus();
    };
    // Scroll only the dialog's content, never the document behind it.
    let frame = 0;
    const revealInput = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (stack.at(-1) !== node) return;
        const input = document.activeElement;
        if (
          !(input instanceof HTMLElement) ||
          !node.contains(input) ||
          !input.matches("input,textarea,select,[contenteditable=true]")
        )
          return;
        const keyboardOpen =
          document.documentElement.hasAttribute("data-keyboard-open");
        const scroller = keyboardOpen
          ? node.closest<HTMLElement>(".modal-viewport")!
          : node.querySelector<HTMLElement>(".modal-scroll")!;
        const bounds = scroller.getBoundingClientRect();
        const rect = input.getBoundingClientRect();
        const top = bounds.top + 12;
        const bottom = bounds.bottom - 12;
        // Large textareas/editors can exceed the available height. Do not
        // alternate between their top and bottom on every viewport event.
        if (rect.height > bottom - top) {
          if (rect.top >= bottom || rect.bottom <= top)
            scroller.scrollTop += rect.top - top;
          return;
        }
        const label = input.closest("label")?.getBoundingClientRect();
        const targetTop =
          label && rect.bottom - label.top <= bottom - top
            ? label.top
            : rect.top;
        // Give the active field a clear reading position instead of leaving
        // it squeezed against the keyboard with a half-visible heading above.
        if (keyboardOpen) scroller.scrollTop += targetTop - top;
        else if (rect.bottom > bottom)
          scroller.scrollTop += rect.bottom - bottom;
        else if (targetTop < top) scroller.scrollTop += targetTop - top;
      });
    };
    const rememberSize = new ResizeObserver(() => {
      if (!document.documentElement.hasAttribute("data-keyboard-open"))
        node.style.setProperty(
          "--modal-resting-height",
          `${node.offsetHeight}px`,
        );
    });
    rememberSize.observe(node);
    node.style.setProperty("--modal-resting-height", `${node.offsetHeight}px`);
    const animated = (event: AnimationEvent) => {
      if (event.target === node) revealInput();
    };
    node.addEventListener("animationend", animated);
    window.addEventListener("resize", revealInput);
    window.visualViewport?.addEventListener("resize", revealInput);
    window.visualViewport?.addEventListener("scroll", revealInput);
    node.addEventListener("focusin", revealInput);
    window.addEventListener("keydown", key, true);
    document.addEventListener("focusin", focus);
    return () => {
      cancelAnimationFrame(frame);
      rememberSize.disconnect();
      node.removeEventListener("animationend", animated);
      window.removeEventListener("resize", revealInput);
      window.visualViewport?.removeEventListener("resize", revealInput);
      window.visualViewport?.removeEventListener("scroll", revealInput);
      node.removeEventListener("focusin", revealInput);
      stack.splice(stack.indexOf(node), 1);
      window.removeEventListener("keydown", key, true);
      document.removeEventListener("focusin", focus);
      if (!stack.length) {
        document.documentElement.removeAttribute("data-modal-open");
        document.body.style.overflow = savedOverflow;
        if (root) root.style.overflow = savedRootOverflow;
      }
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [requestClose]);
  return createPortal(
    <div className={`overlay${closing ? " is-closing" : ""}`}>
      <div className="overlay-backdrop" aria-hidden="true" />
      <div
        className="modal-viewport"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && stack.at(-1) === ref.current)
            requestClose();
        }}
      >
        <section
          ref={ref}
          className={`modal${closing ? " is-closing" : ""} ${className}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={id}
          tabIndex={-1}
          onAnimationEnd={(e) => {
            if (
              e.target === e.currentTarget &&
              (e.animationName === "modal-out" ||
                e.animationName === "modal-sheet-out")
            )
              finishClose();
          }}
        >
          <header>
            <div className="modal-heading">
              <h2 id={id} title={title}>
                {title}
              </h2>
              {subtitle}
            </div>
            {language && <LanguageSwitcher />}
            <button
              className="icon"
              onClick={() => requestClose()}
              aria-label={tr("关闭")}
              disabled={closing}
            >
              <X size={18} />
            </button>
          </header>
          <div className="modal-scroll">{content}</div>
        </section>
      </div>
    </div>,
    document.body,
  );
}
