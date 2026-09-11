import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { tr } from "./i18n";

export default function PasswordInput(
  props: InputHTMLAttributes<HTMLInputElement>,
) {
  const [shown, setShown] = useState(false);
  return (
    <span className="credential-input">
      <input {...props} type={shown ? "text" : "password"} />
      <button
        type="button"
        className="credential-reveal"
        aria-label={shown ? tr("隐藏密码") : tr("显示密码")}
        aria-pressed={shown}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => setShown((value) => !value)}
      >
        {shown ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </span>
  );
}
