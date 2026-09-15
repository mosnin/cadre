"use client";
// beui.dev/components/motion/switch

import { MotionConfig, motion, useReducedMotion } from "motion/react";
import { useId, useRef, useState } from "react";
import { cn } from "./support/utils";

// Heavy, deliberate thumb — high mass keeps the travel weighty without wobble.
const THUMB_SPRING = { type: "tween", duration: 0.16 } as const;

export interface SwitchProps {
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "data-testid"?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  ariaLabel?: string;
  className?: string;
}

export function Switch({
  id: idProp,
  "aria-label": accessibleLabel,
  "aria-describedby": describedBy,
  "data-testid": testId,
  checked,
  onCheckedChange,
  disabled,
  label,
  ariaLabel,
  className,
}: SwitchProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const thumbRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [isPressed, setIsPressed] = useState(false);
  const [isPointer, setIsPointer] = useState(false);

  const squish = !disabled && isPointer && isPressed && !reduce;

  return (
    <MotionConfig transition={reduce ? { duration: 0 } : THUMB_SPRING}>
      <span className={cn("inline-flex min-h-11 items-center gap-3", className)}>
        <motion.button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={accessibleLabel ?? ariaLabel}
          aria-describedby={describedBy}
          data-testid={testId}
          data-slot="switch"
          disabled={disabled}
          onClick={() => !disabled && onCheckedChange(!checked)}
          onPointerDown={(e) => {
            setIsPressed(true);
            setIsPointer(e.type.startsWith("pointer"));
          }}
          onPointerUp={() => setIsPressed(false)}
          onPointerLeave={() => setIsPressed(false)}
          initial={false}
          data-state={checked ? "checked" : "unchecked"}
          className={cn(
            "group peer inline-flex h-7 w-12 shrink-0 cursor-pointer items-center px-1 rounded-full outline-none transition-colors duration-200",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:cursor-not-allowed disabled:opacity-60",
            checked ? "justify-end bg-primary" : "justify-start bg-muted-foreground/60",
          )}
        >
          <motion.div
            ref={thumbRef}
            layout
            animate={{ scale: squish ? 0.9 : 1 }}
            className="pointer-events-none block h-5 w-5 rounded-full bg-primary-foreground shadow-sm"
          >
            {/* Stretch toward the destination while active. */}
            <div className={cn("size-5", squish && (checked ? "ml-1" : "mr-1"))} />
          </motion.div>
        </motion.button>
        {label ? (
          <label htmlFor={id} className="cursor-pointer text-sm text-foreground">
            {label}
          </label>
        ) : null}
      </span>
    </MotionConfig>
  );
}
