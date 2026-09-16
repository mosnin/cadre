"use client";
// beui.dev/components/blocks/signup-form

import { Eye, EyeOff } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "../components/ui/button";
import { Checkbox } from "./checkbox";
import { Input } from "./input";
import { EASE_OUT, SPRING_LAYOUT } from "./support/ease";
import { cn } from "./support/utils";

export type SignUpStatus = "idle" | "loading" | "success" | "error";

export type SignUpValues = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  terms: boolean;
};

export type SignUpErrors = Partial<Record<keyof SignUpValues, string>>;

export type SignUpFormClassNames = {
  root?: string;
  header?: string;
  title?: string;
  description?: string;
  fields?: string;
  strength?: string;
  terms?: string;
  submit?: string;
  footer?: string;
};

export interface SignUpFormProps {
  /** Controlled values. Omit for uncontrolled. */
  values?: SignUpValues;
  defaultValues?: Partial<SignUpValues>;
  onValuesChange?: (values: SignUpValues) => void;
  /** Called with valid values only. Return a promise to drive the button state. */
  onSubmit?: (values: SignUpValues) => void | Promise<void>;
  /** Replace the built-in rules — return a message per invalid field. */
  validate?: (values: SignUpValues) => SignUpErrors;
  /** Controlled submit state. Omit to let the form track it. */
  status?: SignUpStatus;
  /** Form-level failure message, shown above the submit button. */
  errorMessage?: string;
  title?: ReactNode;
  description?: ReactNode;
  submitLabel?: string;
  footer?: ReactNode;
  /** Show the password strength meter. */
  strengthMeter?: boolean;
  confirmPassword?: boolean;
  terms?: boolean;
  labels?: {
    name: string;
    email: string;
    password: string;
    showPassword: string;
    hidePassword: string;
    pending: string;
  };
  className?: string;
  classNames?: SignUpFormClassNames;
}

const EMPTY_VALUES: SignUpValues = {
  name: "",
  email: "",
  password: "",
  confirmPassword: "",
  terms: false,
};

// Deliberately permissive. Full RFC 5322 matching is impractical in a regex and
// rejects addresses that deliver fine; the only real check is sending mail.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MIN_PASSWORD_LENGTH = 8;

const STRENGTH_LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"] as const;

const STRENGTH_COLORS = [
  "bg-destructive",
  "bg-destructive",
  "bg-amber-500",
  "bg-amber-400",
  "bg-(--color-success)",
] as const;

/**
 * Length-weighted strength score, 0-4. NIST SP 800-63B advises against
 * composition requirements and treats length as the dominant factor, so extra
 * character classes only nudge the score — they can't rescue a short password.
 * This is a heuristic for feedback, not entropy estimation; pair it with a
 * breach-list check server-side for anything real.
 */
export function passwordStrength(password: string): number {
  if (password.length < MIN_PASSWORD_LENGTH) return 0;

  let score = 1;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) =>
    pattern.test(password),
  ).length;
  if (classes >= 3) score += 1;

  return Math.min(score, 4);
}

function defaultValidate(values: SignUpValues): SignUpErrors {
  const errors: SignUpErrors = {};

  if (!values.name.trim()) {
    errors.name = "Enter your name.";
  }

  if (!values.email.trim()) {
    errors.email = "Enter your email.";
  } else if (!EMAIL_PATTERN.test(values.email)) {
    errors.email = "That doesn't look like an email address.";
  }

  if (!values.password) {
    errors.password = "Choose a password.";
  } else if (values.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = "Confirm your password.";
  } else if (values.confirmPassword !== values.password) {
    errors.confirmPassword = "Passwords don't match.";
  }

  if (!values.terms) {
    errors.terms = "Accept the terms to continue.";
  }

  return errors;
}

export function SignUpForm({
  values: valuesProp,
  defaultValues,
  onValuesChange,
  onSubmit,
  validate,
  status: statusProp,
  errorMessage,
  title = "Create your account",
  description = "Start building in under a minute.",
  submitLabel = "Create account",
  footer,
  strengthMeter = true,
  confirmPassword = true,
  terms = true,
  labels,
  className,
  classNames,
}: SignUpFormProps) {
  const reduce = useReducedMotion();
  const submitting = useRef(false);
  const baseId = useId();

  const controlled = valuesProp !== undefined;
  const [internalValues, setInternalValues] = useState<SignUpValues>({
    ...EMPTY_VALUES,
    ...defaultValues,
  });
  const values = controlled ? valuesProp : internalValues;

  const [internalStatus, setInternalStatus] = useState<SignUpStatus>("idle");
  const status = statusProp ?? internalStatus;

  const [revealPassword, setRevealPassword] = useState(false);

  // "Reward early, punish late": errors are computed on every change, but a
  // field only *shows* its error once it has been blurred (or submit touched
  // everything). So a first entry is never flagged mid-typing, while a field
  // already in error clears the moment it becomes valid.
  const [touched, setTouched] = useState<Partial<Record<keyof SignUpValues, boolean>>>({});

  const errors = useMemo(() => (validate ?? defaultValidate)(values), [values, validate]);

  const setValue = useCallback(
    <K extends keyof SignUpValues>(key: K, next: SignUpValues[K]) => {
      const nextValues = { ...values, [key]: next };
      if (!controlled) {
        setInternalValues(nextValues);
        if (statusProp === undefined) {
          setInternalStatus((current) =>
            current === "success" || current === "error" ? "idle" : current,
          );
        }
      }
      onValuesChange?.(nextValues);
    },
    [controlled, onValuesChange, statusProp, values],
  );

  const touch = useCallback((key: keyof SignUpValues) => {
    setTouched((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  }, []);

  /** Error to render for a field — hidden until the field has been touched. */
  const shownError = (key: keyof SignUpValues) => (touched[key] ? errors[key] : undefined);

  /** Success check draws only once a touched field is non-empty and valid. */
  const isValid = (key: keyof SignUpValues) =>
    Boolean(touched[key]) && !errors[key] && Boolean(values[key]);

  const strength = passwordStrength(values.password);
  const showStrength = strengthMeter && values.password.length > 0;
  const isSubmitting = status === "loading";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setTouched({
      name: true,
      email: true,
      password: true,
      confirmPassword: true,
      terms: true,
    });

    if (Object.keys(errors).length > 0) return;
    if (!onSubmit || submitting.current || status === "loading") return;
    submitting.current = true;

    if (statusProp === undefined) setInternalStatus("loading");
    try {
      await onSubmit(values);
      if (statusProp === undefined) setInternalStatus("success");
    } catch {
      if (statusProp === undefined) setInternalStatus("error");
    } finally {
      submitting.current = false;
    }
  };

  const termsErrorId = `${baseId}-terms-error`;
  const formErrorId = `${baseId}-form-error`;

  return (
    <form
      data-slot="signup-form"
      noValidate
      onSubmit={handleSubmit}
      className={cn(
        "flex w-full max-w-sm flex-col gap-5 rounded-3xl border border-border p-6",
        className,
        classNames?.root,
      )}
    >
      {title || description ? (
        <div className={cn("flex flex-col gap-1", classNames?.header)}>
          {title ? (
            <h2
              className={cn(
                "text-xl font-semibold tracking-tight text-foreground",
                classNames?.title,
              )}
            >
              {title}
            </h2>
          ) : null}
          {description ? (
            <p className={cn("text-sm text-muted-foreground", classNames?.description)}>
              {description}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={cn("flex flex-col gap-1", classNames?.fields)}>
        <Input
          label={labels?.name ?? "Name"}
          autoComplete="name"
          placeholder=""
          disabled={isSubmitting}
          value={values.name}
          onChange={(event) => setValue("name", event.target.value)}
          onBlur={() => touch("name")}
          error={shownError("name")}
          reserveErrorLine
          success={isValid("name")}
        />

        <Input
          label={labels?.email ?? "Email"}
          type="email"
          inputMode="email"
          autoComplete="username"
          placeholder="you@example.com"
          disabled={isSubmitting}
          value={values.email}
          onChange={(event) => setValue("email", event.target.value)}
          onBlur={() => touch("email")}
          error={shownError("email")}
          reserveErrorLine
          success={isValid("email")}
        />

        <div className="flex flex-col gap-2">
          <Input
            label={labels?.password ?? "Password"}
            type={revealPassword ? "text" : "password"}
            autoComplete="new-password"
            placeholder=""
            rightIcon={
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setRevealPassword((prev) => !prev)}
                aria-label={
                  revealPassword
                    ? (labels?.hidePassword ?? "Hide password")
                    : (labels?.showPassword ?? "Show password")
                }
                aria-pressed={revealPassword}
                className="grid size-11 place-items-center rounded-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {revealPassword ? <EyeOff /> : <Eye />}
              </button>
            }
            disabled={isSubmitting}
            value={values.password}
            onChange={(event) => setValue("password", event.target.value)}
            onBlur={() => touch("password")}
            error={shownError("password")}
            reserveErrorLine
          />

          <AnimatePresence initial={false}>
            {showStrength ? (
              <motion.div
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: EASE_OUT }}
                className={cn("flex flex-col gap-1.5 px-1", classNames?.strength)}
              >
                <div className="flex gap-1.5" aria-hidden>
                  {[0, 1, 2, 3].map((index) => (
                    <span
                      key={index}
                      className="h-1 flex-1 overflow-hidden rounded-full bg-muted-foreground/20"
                    >
                      {/* scaleX rather than width — transforms only, per the
                          motion conventions, and it keeps the bar off layout. */}
                      <motion.span
                        initial={false}
                        animate={{ scaleX: index < strength ? 1 : 0 }}
                        transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                        className={cn(
                          "block h-full w-full origin-left rounded-full",
                          STRENGTH_COLORS[strength],
                        )}
                      />
                    </span>
                  ))}
                </div>
                <p aria-live="polite" className="text-xs text-muted-foreground">
                  Password strength: {STRENGTH_LABELS[strength]}
                </p>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {confirmPassword ? (
          <Input
            label="Confirm password"
            type={revealPassword ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Re-enter your password"
            disabled={isSubmitting}
            value={values.confirmPassword}
            onChange={(event) => setValue("confirmPassword", event.target.value)}
            onBlur={() => touch("confirmPassword")}
            error={shownError("confirmPassword")}
            reserveErrorLine
            success={isValid("confirmPassword")}
          />
        ) : null}
      </div>

      {terms ? (
        <div className={cn("flex flex-col gap-1.5", classNames?.terms)}>
          <Checkbox
            checked={values.terms}
            disabled={isSubmitting}
            onCheckedChange={(next) => {
              setValue("terms", next);
              touch("terms");
            }}
            label="I agree to the Terms and Privacy Policy"
            aria-describedby={shownError("terms") ? termsErrorId : undefined}
          />
          <AnimatePresence initial={false}>
            {shownError("terms") ? (
              <motion.p
                id={termsErrorId}
                role="alert"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4, filter: "blur(4px)" }}
                transition={{ duration: 0.2 }}
                className="px-1 text-xs text-destructive"
              >
                {shownError("terms")}
              </motion.p>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}

      <AnimatePresence initial={false}>
        {errorMessage ? (
          <motion.p
            id={formErrorId}
            role="alert"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {errorMessage}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <Button
        type="submit"
        size="lg"
        disabled={isSubmitting}
        aria-describedby={errorMessage ? formErrorId : undefined}
        className={cn("w-full", classNames?.submit)}
      >
        {isSubmitting ? (labels?.pending ?? "Creating account") : submitLabel}
      </Button>

      {footer ? (
        <div className={cn("text-center text-sm text-muted-foreground", classNames?.footer)}>
          {footer}
        </div>
      ) : null}
    </form>
  );
}
