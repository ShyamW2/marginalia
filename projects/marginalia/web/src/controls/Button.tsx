import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import styles from "./Button.module.css";

export type ButtonSize = "sm" | "md";
export type ButtonVariant = "solid" | "outline" | "ghost" | "danger";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  /** Label-only and icon+label both go through `children`; a leading icon
   * is optional. Icon-only buttons are `IconButton`, not `Button` with an
   * empty label — an icon-only control always needs an explicit
   * `aria-label`, which `IconButton` requires and this component doesn't. */
  children?: ReactNode;
  icon?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Persistent toggle state (theme picker, kind filter, mode switch) —
   * distinct from the momentary `:active` pseudo-class. Also sets
   * `aria-pressed`. */
  pressed?: boolean;
  type?: "button" | "submit" | "reset";
}

export interface ButtonClassNameOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pressed?: boolean;
  iconOnly?: boolean;
  className?: string;
}

/**
 * The button kit's visual classes, for the rare non-`<button>` element that
 * still needs to *look* like one — today, only `ReaderPage`'s "Digest" link
 * (an `<a>`/`<Link>`, since it navigates rather than acting). Everything
 * that can be a real `<button>` should be `Button`/`IconButton` instead;
 * this exists so that one exception doesn't need its own hand-rolled CSS.
 */
export function buttonClassName({
  variant = "outline",
  size = "md",
  pressed,
  iconOnly,
  className,
}: ButtonClassNameOptions): string {
  return [
    styles.button,
    styles[size],
    styles[variant],
    pressed ? styles.pressed : "",
    iconOnly ? styles.iconOnly : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The one button, built once (M19.7 — DESIGN.md "The control system").
 * Reads only `--control-*`/`--color-*` custom properties, so the same
 * markup renders skeuomorphic-paper or instrument-glass depending on which
 * `.register-*` class an ancestor carries (registers.css) — never a prop,
 * never a per-surface fork.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { children, icon, variant = "outline", size = "md", pressed, className, type = "button", ...rest },
  ref,
) {
  const classes = buttonClassName({ variant, size, pressed, className });

  return (
    <button ref={ref} type={type} className={classes} aria-pressed={pressed} {...rest}>
      {icon && <span className={styles.icon}>{icon}</span>}
      {children !== undefined && <span className={styles.label}>{children}</span>}
    </button>
  );
});
