import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

export function Button({ variant = "primary", className = "", children, ...rest }: ButtonProps) {
  const base = variant === "primary" ? "app-btn-primary" : "app-btn-secondary";
  return (
    <button className={`${base} ${className}`} {...rest}>
      {children}
    </button>
  );
}
