import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { Check, ChevronDown } from "lucide-react";
import "./select.css";
type Props = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "onChange" | "multiple" | "size" | "value" | "defaultValue"
> & {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: { target: { value: string } }) => void;
};
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((n) =>
      isValidElement<{ children?: ReactNode }>(n)
        ? text(n.props.children)
        : String(n),
    )
    .join("");
}
export function Select({
  children,
  value,
  defaultValue,
  onChange,
  className = "",
  disabled,
  id,
  name,
  required,
  ...props
}: Props) {
  const options = Children.toArray(children)
    .filter(isValidElement)
    .map((n) => {
      const p = n.props as {
        value?: string | number;
        children?: ReactNode;
        disabled?: boolean;
      };
      return {
        value: String(p.value ?? text(p.children)),
        label: text(p.children),
        disabled: !!p.disabled,
      };
    });
  const [internal, setInternal] = useState(
    String(defaultValue ?? options[0]?.value ?? ""),
  );
  const current = String(value ?? internal);
  const selected = options.findIndex((o) => o.value === current);
  const button = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const menuID = useId();
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const typeahead = useRef({ value: "", time: 0 });
  const close = () => {
    menu.current?.hidePopover();
    setOpen(false);
  };
  const position = () => {
    if (!button.current || !menu.current) return;
    const r = button.current.getBoundingClientRect(),
      v = window.visualViewport;
    const left = v?.offsetLeft ?? 0,
      top = v?.offsetTop ?? 0;
    const width = v?.width ?? innerWidth,
      height = v?.height ?? innerHeight;
    const w = Math.min(Math.max(r.width, 180), width - 16);
    const below = top + height - r.bottom - 12,
      above = r.top - top - 12;
    const down =
      below >= Math.min(options.length * 40 + 12, 280) || below >= above;
    const h = Math.max(0, Math.min(280, down ? below : above));
    Object.assign(menu.current.style, {
      left: `${Math.max(left + 8, Math.min(r.left, left + width - w - 8))}px`,
      top: down ? `${r.bottom + 6}px` : "auto",
      bottom: down ? "auto" : `${innerHeight - r.top + 6}px`,
      width: `${w}px`,
      maxHeight: `${h}px`,
    });
  };
  const show = () => {
    if (disabled || !options.length) return;
    setActive(
      selected >= 0 && !options[selected].disabled
        ? selected
        : options.findIndex((o) => !o.disabled),
    );
    position();
    menu.current?.showPopover();
    setOpen(true);
  };
  const choose = (i: number) => {
    const option = options[i];
    if (!option || option.disabled) return;
    setInternal(option.value);
    onChange?.({ target: { value: option.value } });
    close();
    button.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!open) return;
    const reposition = () => position();
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
      window.visualViewport?.removeEventListener("resize", reposition);
    };
  });
  useEffect(() => {
    if (disabled) close();
  }, [disabled]);
  useEffect(() => {
    if (open)
      menu.current
        ?.querySelector(`[data-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  return (
    <>
      <button
        type="button"
        ref={button}
        id={id}
        name={name}
        disabled={disabled}
        className={`select-trigger ${className}`}
        role="combobox"
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        aria-describedby={props["aria-describedby"]}
        aria-required={required}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={menuID}
        aria-activedescendant={
          open && active >= 0 ? `${menuID}-${active}` : undefined
        }
        title={props.title || options[selected]?.label}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            close();
            return;
          }
          if (e.key === "Tab") {
            close();
            return;
          }
          if (
            ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(
              e.key,
            )
          ) {
            e.preventDefault();
            if (!open) {
              show();
              return;
            }
            if (e.key === "Enter" || e.key === " ") {
              choose(active);
              return;
            }
            const enabled = options
              .map((o, i) => (o.disabled ? -1 : i))
              .filter((i) => i >= 0);
            const at = enabled.indexOf(active);
            setActive(
              e.key === "Home"
                ? enabled[0]
                : e.key === "End"
                  ? enabled.at(-1)!
                  : enabled[
                      (at + (e.key === "ArrowUp" ? -1 : 1) + enabled.length) %
                        enabled.length
                    ],
            );
          } else if (
            e.key.length === 1 &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey
          ) {
            const now = Date.now();
            typeahead.current.value =
              (now - typeahead.current.time < 700
                ? typeahead.current.value
                : "") + e.key.toLowerCase();
            typeahead.current.time = now;
            const i = options.findIndex(
              (o) =>
                !o.disabled &&
                o.label.toLowerCase().startsWith(typeahead.current.value),
            );
            if (i >= 0) {
              if (!open) show();
              setActive(i);
            }
          }
        }}
      >
        <span>{options[selected]?.label || options[0]?.label || "—"}</span>
        <ChevronDown size={14} />
      </button>
      <div
        ref={menu}
        id={menuID}
        popover="auto"
        role="listbox"
        aria-label={
          props["aria-label"] ||
          button.current?.labels?.[0]?.textContent ||
          undefined
        }
        className="select-menu"
        onToggle={(e) =>
          setOpen((e.nativeEvent as ToggleEvent).newState === "open")
        }
        onPointerDown={(e) => e.preventDefault()}
      >
        {options.map((o, i) => (
          <div
            key={o.value}
            id={`${menuID}-${i}`}
            role="option"
            aria-selected={o.value === current}
            aria-disabled={o.disabled}
            data-index={i}
            className={`select-option ${i === active ? "is-active" : ""}`}
            onPointerMove={(e) =>
              e.pointerType === "mouse" && !o.disabled && setActive(i)
            }
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              choose(i);
            }}
          >
            <span>{o.label}</span>
            {o.value === current && <Check size={14} />}
          </div>
        ))}
      </div>
    </>
  );
}
