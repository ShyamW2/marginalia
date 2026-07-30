import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./Button.js";
import styles from "./Button.module.css";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  icon: ReactNode;
  /** Required, not optional: an icon-only control has no visible text, so
   * this is its only accessible name (M19.7 acceptance: "icon-only buttons
   * all carry accessible names"). */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  pressed?: boolean;
  type?: "button" | "submit" | "reset";
}

/** The icon-only member of the Button family — see Button.tsx. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = "ghost", size = "md", className, ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      icon={icon}
      variant={variant}
      size={size}
      aria-label={label}
      title={label}
      className={[styles.iconOnly, className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
});
