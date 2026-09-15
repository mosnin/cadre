"use client";
// beui.dev/components/motion/center-morph-modal

import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { EASE_OUT } from "./support/ease";
import { PresenceGate } from "./support/presence-gate";
import { cn } from "./support/utils";

type CenterMorphModalContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerId: string;
  contentId: string;
};

const CenterMorphModalContext = createContext<CenterMorphModalContextValue | null>(null);

function useCenterMorphModalContext(component: string) {
  const context = useContext(CenterMorphModalContext);
  if (!context) {
    throw new Error(`${component} must be used within <CenterMorphModal>`);
  }
  return context;
}

export interface CenterMorphModalProps {
  children: ReactNode;
  /** Controlled open state. */
  open?: boolean;
  /** Initial state when used uncontrolled. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * A modal whose full-size surface unfolds outward from its exact center.
 * Supports controlled and uncontrolled state through composable primitives.
 */
export function CenterMorphModal({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
}: CenterMorphModalProps) {
  const id = useId();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : internalOpen;

  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setInternalOpen(next);
      onOpenChangeRef.current?.(next);
    },
    [controlled],
  );

  const value = useMemo<CenterMorphModalContextValue>(
    () => ({
      open,
      setOpen,
      triggerId: `${id}-trigger`,
      contentId: `${id}-content`,
    }),
    [id, open, setOpen],
  );

  return (
    <CenterMorphModalContext.Provider value={value}>{children}</CenterMorphModalContext.Provider>
  );
}

export interface CenterMorphModalTriggerProps {
  children: ReactElement;
}

/** Wraps one interactive element and opens or closes the modal. */
export function CenterMorphModalTrigger({ children }: CenterMorphModalTriggerProps) {
  const context = useCenterMorphModalContext("CenterMorphModalTrigger");
  if (!isValidElement(children)) return children;

  const child = children as ReactElement<Record<string, unknown>>;
  const childOnClick = child.props.onClick as
    | ((event: React.MouseEvent<HTMLElement>) => void)
    | undefined;

  return cloneElement(child, {
    id: context.triggerId,
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      childOnClick?.(event);
      if (!event.defaultPrevented) context.setOpen(!context.open);
    },
    "aria-haspopup": "dialog",
    "aria-expanded": context.open,
    "aria-controls": context.open ? context.contentId : undefined,
  });
}

export interface CenterMorphModalCloseProps {
  children: ReactElement;
}

/** Wraps one interactive element and closes the modal. */
export function CenterMorphModalClose({ children }: CenterMorphModalCloseProps) {
  const context = useCenterMorphModalContext("CenterMorphModalClose");
  if (!isValidElement(children)) return children;

  const child = children as ReactElement<Record<string, unknown>>;
  const childOnClick = child.props.onClick as
    | ((event: React.MouseEvent<HTMLElement>) => void)
    | undefined;

  return cloneElement(child, {
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      childOnClick?.(event);
      if (!event.defaultPrevented) context.setOpen(false);
    },
  });
}

export interface CenterMorphModalContentProps {
  panelProps?: import("react").HTMLAttributes<HTMLDivElement>;
  role?: "dialog" | "alertdialog";
  children: ReactNode;
  /** Accessible name announced by screen readers. */
  ariaLabel?: string;
  ariaLabelledBy?: string;
  panelRef?: Ref<HTMLDivElement>;
  testId?: string;
  initialFocus?: RefObject<HTMLElement | null> | (() => HTMLElement | null) | boolean;
  finalFocus?: RefObject<HTMLElement | null> | (() => HTMLElement | null) | boolean;
  /** Optional id of descriptive content inside the modal. */
  ariaDescribedBy?: string;
  /** Close on Escape or backdrop press. Default true. */
  dismissible?: boolean;
  /** Render the close control inside the panel's top-right corner. Default true. */
  showCloseButton?: boolean;
  closeButtonLabel?: string;
  className?: string;
  backdropClassName?: string;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const modalStack: { token: symbol; panel: RefObject<HTMLDivElement | null> }[] = [];
let initialPageState: { overflow: string; inert: boolean } | null = null;

const CENTER_FOLDED_CLIP = "inset(8% 8% 8% 8% round 24px)";
const CENTER_OPEN_CLIP = "inset(0% 0% 0% 0% round 24px)";

// Complex clip-path strings can snap when a spring resolves its final distance.
// Keep the radius constant so the whole duration reads as surface unfolding,
// rather than finishing early and spending its last frames rounding corners.
const CENTER_UNFOLD_EASE = [0.2, 0, 0.2, 1] as const;
const CENTER_UNFOLD_TRANSITION = {
  duration: 0.22,
  ease: CENTER_UNFOLD_EASE,
} as const;

function getFocusableElements(root: HTMLElement | null) {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      element.getClientRects().length > 0 &&
      !element.closest("[inert],[hidden]"),
  );
}

export function CenterMorphModalContent({
  children,
  panelProps,
  role = "dialog",
  ariaLabel,
  ariaLabelledBy,
  panelRef: forwardedRef,
  testId,
  initialFocus,
  finalFocus,
  ariaDescribedBy,
  dismissible = true,
  showCloseButton = true,
  closeButtonLabel = "Close modal",
  className,
  backdropClassName,
}: CenterMorphModalContentProps) {
  const context = useCenterMorphModalContext("CenterMorphModalContent");
  const reduce = useReducedMotion() ?? false;
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusOptions = useRef({ initialFocus, finalFocus });
  focusOptions.current = { initialFocus, finalFocus };
  const assignPanel = useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!context.open) return;

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const app = document.getElementById("root");
    const token = Symbol("modal");
    if (modalStack.length === 0)
      initialPageState = { overflow: document.body.style.overflow, inert: app?.inert ?? false };
    const previousPanel = modalStack.at(-1)?.panel.current;
    if (previousPanel) previousPanel.inert = true;
    modalStack.push({ token, panel: panelRef });
    if (app) app.inert = true;
    document.body.style.overflow = "hidden";

    const focusFrame = requestAnimationFrame(() => {
      if (modalStack.at(-1)?.token !== token) return;
      const [firstFocusable] = getFocusableElements(panelRef.current);
      const preferred = focusOptions.current.initialFocus;
      const target =
        typeof preferred === "function"
          ? preferred()
          : typeof preferred === "object"
            ? preferred?.current
            : null;
      if (preferred !== false) (target ?? firstFocusable ?? panelRef.current)?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || modalStack.at(-1)?.token !== token) return;
      if (event.key === "Escape" && dismissible) {
        event.preventDefault();
        context.setOpen(false);
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = getFocusableElements(panelRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown);
      const wasTop = modalStack.at(-1)?.token === token;
      const index = modalStack.findIndex((entry) => entry.token === token);
      if (index >= 0) modalStack.splice(index, 1);
      const nextPanel = modalStack.at(-1)?.panel.current;
      if (nextPanel) nextPanel.inert = false;
      if (!modalStack.length && initialPageState) {
        document.body.style.overflow = initialPageState.overflow;
        if (app) app.inert = initialPageState.inert;
        initialPageState = null;
      }
      if (!wasTop) return;
      const preferred = focusOptions.current.finalFocus;
      const target =
        typeof preferred === "function"
          ? preferred()
          : typeof preferred === "object"
            ? preferred?.current
            : null;
      if (preferred !== false)
        (target ?? document.getElementById(context.triggerId) ?? previousFocus)?.focus();
    };
  }, [context, dismissible]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {context.open ? (
        <PresenceGate>
          {({ isPresent, gate }) => (
            <>
              <motion.button
                type="button"
                aria-label="Dismiss modal"
                tabIndex={-1}
                disabled={!dismissible}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                {...gate}
                transition={{
                  duration: reduce ? 0.1 : 0.28,
                  ease: EASE_OUT,
                }}
                onClick={() => context.setOpen(false)}
                className={cn(
                  "pointer-events-auto fixed inset-0 z-[100] h-full w-full cursor-default bg-overlay backdrop-blur-sm",
                  backdropClassName,
                )}
              />

              {/* `inset-4` rather than `inset-0 p-4`: same content box, but the
                  layer stays off the viewport edges. It never takes pointer
                  events, so it carries `inert` alone. See
                  tests/fixed-overlay-edge-sampling.test.tsx. */}
              <div
                inert={!isPresent}
                className="pointer-events-none fixed inset-4 z-[100] flex items-center justify-center overflow-y-auto drop-shadow-2xl"
              >
                {/* Drop-shadow reads the clipped child's alpha, so depth follows the
                    unfolding silhouette without introducing another panel layer. */}
                <div className="flex max-h-full w-full flex-col items-center">
                  <motion.div
                    ref={assignPanel}
                    data-testid={testId}
                    data-slot="dialog-content"
                    id={context.contentId}
                    {...(panelProps as import("motion/react").HTMLMotionProps<"div">)}
                    role={role}
                    aria-modal="true"
                    aria-label={ariaLabel}
                    aria-labelledby={ariaLabelledBy}
                    aria-describedby={ariaDescribedBy}
                    tabIndex={-1}
                    initial={
                      reduce
                        ? { opacity: 0, clipPath: CENTER_OPEN_CLIP }
                        : { opacity: 1, clipPath: CENTER_FOLDED_CLIP }
                    }
                    animate={{
                      opacity: 1,
                      clipPath: CENTER_OPEN_CLIP,
                    }}
                    exit={
                      reduce
                        ? {
                            opacity: 0,
                            clipPath: CENTER_OPEN_CLIP,
                          }
                        : {
                            opacity: 1,
                            clipPath: CENTER_FOLDED_CLIP,
                          }
                    }
                    {...gate}
                    transition={
                      reduce ? { duration: 0.14, ease: EASE_OUT } : CENTER_UNFOLD_TRANSITION
                    }
                    className={cn(
                      "pointer-events-auto relative max-h-[calc(100dvh-2rem)] w-full max-w-[26rem] origin-center overflow-y-auto rounded-3xl bg-background will-change-[clip-path]",
                      className,
                    )}
                  >
                    {children}

                    {showCloseButton ? (
                      <motion.button
                        type="button"
                        aria-label={closeButtonLabel}
                        onClick={() => context.setOpen(false)}
                        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{
                          opacity: 0,
                          scale: reduce ? 1 : 0.88,
                          transition: { duration: 0.1, ease: EASE_OUT },
                        }}
                        transition={{
                          delay: 0,
                          duration: reduce ? 0.12 : 0.2,
                          ease: EASE_OUT,
                        }}
                        className="absolute right-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </motion.button>
                    ) : null}
                  </motion.div>
                </div>
              </div>
            </>
          )}
        </PresenceGate>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
