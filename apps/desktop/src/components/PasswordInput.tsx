import { InputHTMLAttributes, useState } from "react";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export function PasswordInput({ className = "", ...props }: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="password-input-wrapper">
      <input {...props} type={showPassword ? "text" : "password"} className={className} />
      <button
        type="button"
        className="password-visibility-toggle"
        aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
        aria-pressed={showPassword}
        onClick={() => setShowPassword(value => !value)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {showPassword ? (
            <>
              <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
              <circle cx="12" cy="12" r="2.5" />
            </>
          ) : (
            <>
              <path d="m3 3 18 18" />
              <path d="M10.6 6.2A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a17.5 17.5 0 0 1-3.1 3.8M6.3 6.3C3.9 8 2.5 12 2.5 12S6 18 12 18c1.7 0 3.2-.5 4.5-1.1" />
              <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}
