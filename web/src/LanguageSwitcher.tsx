import { useEffect, useId, useRef, useState } from "react";
import { Check, Languages } from "lucide-react";
import { useLocale, localeNames, setLocale, tr, type Locale } from "./i18n";
export default function LanguageSwitcher() {
  const locale = useLocale();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const close = () => panel.current?.hidePopover();
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, []);
  return (
    <div className="language-switcher">
      <button
        ref={trigger}
        type="button"
        className="language-trigger"
        aria-label={tr("界面语言")}
        aria-expanded={open}
        aria-controls={id}
        title={`${tr("界面语言")} · ${localeNames[locale]}`}
        onClick={() => {
          const element = panel.current!;
          if (element.matches(":popover-open")) return element.hidePopover();
          const rect = trigger.current!.getBoundingClientRect();
          element.style.left = `${Math.max(12, Math.min(rect.right - 208, innerWidth - 220))}px`;
          element.style.top = `${Math.max(12, Math.min(rect.bottom + 10, innerHeight - 212))}px`;
          element.showPopover();
          element
            .querySelector<HTMLButtonElement>('[aria-pressed="true"]')
            ?.focus();
        }}
      >
        <Languages size={20} aria-hidden="true" />
      </button>
      <div
        id={id}
        ref={panel}
        popover="auto"
        className="language-panel"
        onToggle={(e) => setOpen(e.newState === "open")}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            panel.current?.hidePopover();
            trigger.current?.focus();
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const buttons = [...panel.current!.querySelectorAll("button")];
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            buttons[
              (index + (e.key === "ArrowDown" ? 1 : 2)) % buttons.length
            ].focus();
          }
        }}
      >
        <p className="language-panel-title">{tr("界面语言")}</p>
        <div role="group" aria-label={tr("界面语言")}>
          {(Object.keys(localeNames) as Locale[]).map((value) => (
            <button
              type="button"
              key={value}
              lang={value}
              aria-pressed={locale === value}
              onClick={() => {
                setLocale(value);
                panel.current?.hidePopover();
                trigger.current?.focus();
              }}
            >
              <span>{localeNames[value]}</span>
              {locale === value && <Check size={16} aria-hidden="true" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
