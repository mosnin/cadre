"use client";
// beui.dev/components/motion/input

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type ChangeEvent,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  useId,
  useState,
} from "react";
import { cn } from "./support/utils";

export type InputClassNames = {
  root?: string;
  label?: string;
  field?: string;
  input?: string;
  leftIcon?: string;
  rightIcon?: string;
  successIcon?: string;
  errorMessage?: string;
};

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange"> {
  label?: string;
  value?: InputHTMLAttributes<HTMLInputElement>["value"];
  defaultValue?: InputHTMLAttributes<HTMLInputElement>["defaultValue"];
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Invalid state uses a stable border and an associated message. */
  error?: string | boolean;
  /** Reserve one message line so validation does not shift nearby content. */
  reserveErrorLine?: boolean;
  success?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  className?: string;
  classNames?: InputClassNames;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    value: valueProp,
    defaultValue,
    onChange,
    onFocus,
    onBlur,
    error,
    reserveErrorLine = false,
    success,
    leftIcon,
    rightIcon,
    className,
    classNames,
    disabled,
    id: idProp,
    type,
    ...rest
  },
  ref,
) {
  const reactId = useId();
  const id = idProp ?? reactId;
  const reduce = useReducedMotion();

  const controlled = valueProp !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? "");
  const value = controlled ? (valueProp ?? "") : internal;

  const [focused, setFocused] = useState(false);

  const hasError = Boolean(error);
  const errorMessage = typeof error === "string" ? error : null;

  // Right edge shows the success check, otherwise the caller's right icon.
  const rightSlot = success ? null : rightIcon;

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!controlled) setInternal(event.target.value);
    onChange?.(event);
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className, classNames?.root)}>
      {label ? (
        <label
          htmlFor={id}
          className={cn("px-1 text-sm font-medium text-foreground", classNames?.label)}
        >
          {label}
        </label>
      ) : null}

      <div
        data-input-surface=""
        data-state={hasError ? "error" : success ? "success" : focused ? "focused" : "idle"}
        className={cn(
          "relative h-11 overflow-hidden rounded-full border transition-colors duration-150",
          "border-border",
          focused && !hasError && "border-foreground/40 ring-2 ring-ring/40",
          hasError && "border-destructive ring-2 ring-destructive/25",
          disabled && "opacity-60",
          classNames?.field,
        )}
      >
        {leftIcon ? (
          <span
            className={cn(
              "pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 items-center text-muted-foreground [&_svg]:h-4 [&_svg]:w-4",
              classNames?.leftIcon,
            )}
          >
            {leftIcon}
          </span>
        ) : null}

        <input
          ref={ref}
          id={id}
          type={type}
          value={type === "file" ? undefined : value}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          aria-describedby={errorMessage ? `${id}-error` : undefined}
          {...rest}
          onChange={handleChange}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          className={cn(
            "peer h-full w-full bg-transparent text-base leading-6 text-foreground caret-foreground outline-none",
            "placeholder:text-muted-foreground/60",
            leftIcon ? "pl-10" : "pl-3.5",
            rightSlot || success ? "pr-10" : "pr-3.5",
            disabled && "cursor-not-allowed",
            classNames?.input,
          )}
        />

        {success ? (
          <motion.svg
            viewBox="0 0 24 24"
            fill="none"
            className={cn(
              "absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-success",
              classNames?.successIcon,
            )}
          >
            <motion.path
              d="M5 12.5l4.5 4.5L19 7.5"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={false}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0 }}
            />
          </motion.svg>
        ) : rightSlot ? (
          <span
            className={cn(
              "absolute right-0 top-0 flex h-full items-center text-muted-foreground [&_button]:grid [&_button]:size-11 [&_button]:place-items-center [&_svg]:h-4 [&_svg]:w-4",
              classNames?.rightIcon,
            )}
          >
            {rightSlot}
          </span>
        ) : null}
      </div>

      <div className={reserveErrorLine ? "min-h-4" : "contents"}>
        <AnimatePresence initial={false}>
          {errorMessage ? (
            <motion.p
              id={`${id}-error`}
              role="alert"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4, filter: "blur(4px)" }}
              transition={{ duration: 0.2 }}
              className={cn("px-1 text-xs text-destructive", classNames?.errorMessage)}
            >
              {errorMessage}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
});
