import { useLocale, projectNames } from "./i18n";
export function StarMark({ className = "" }: { className?: string }) {
  return <span className={`star-mark ${className}`} aria-hidden="true" />;
}
export default function Brand() {
  const locale = useLocale();
  return (
    <span className="hoshi-brand">
      <StarMark />
      <span className="hoshi-wordmark">{projectNames[locale]}</span>
    </span>
  );
}
