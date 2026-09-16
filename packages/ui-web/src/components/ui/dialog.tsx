"use client";

import {
  type ComponentProps,
  cloneElement,
  createContext,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useContext,
  useId,
  useState,
} from "react";
import {
  CenterMorphModal,
  CenterMorphModalClose,
  CenterMorphModalContent,
  CenterMorphModalTrigger,
} from "../../directory/center-morph-modal";
import { cn } from "../../lib/utils";
import { Button } from "./button";

const DialogContext = createContext({ titleId: "", descriptionId: "" });
type FocusTarget = RefObject<HTMLElement | null> | (() => HTMLElement | null) | boolean;
function Dialog({
  children,
  open,
  defaultOpen = false,
  onOpenChange,
}: {
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean, details: { cancel: () => void }) => void;
}) {
  const id = useId();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  return (
    <DialogContext.Provider value={{ titleId: `${id}-title`, descriptionId: `${id}-description` }}>
      <CenterMorphModal
        open={open ?? internalOpen}
        onOpenChange={(next) => {
          let canceled = false;
          onOpenChange?.(next, {
            cancel: () => {
              canceled = true;
            },
          });
          if (!canceled && open === undefined) setInternalOpen(next);
        }}
      >
        {children}
      </CenterMorphModal>
    </DialogContext.Provider>
  );
}
type TriggerProps = ComponentProps<"button"> & { render?: ReactElement };
function triggerElement({ render, children, ...props }: TriggerProps) {
  return render ? (
    cloneElement(render as ReactElement<Record<string, unknown>>, { ...props, children })
  ) : (
    <button type="button" {...props}>
      {children}
    </button>
  );
}
function DialogTrigger(props: TriggerProps) {
  return <CenterMorphModalTrigger>{triggerElement(props)}</CenterMorphModalTrigger>;
}
function DialogClose(props: TriggerProps) {
  return <CenterMorphModalClose>{triggerElement(props)}</CenterMorphModalClose>;
}
function DialogContent({
  className,
  children,
  showCloseButton = true,
  initialFocus,
  finalFocus,
  ref,
  ...props
}: ComponentProps<"div"> & {
  showCloseButton?: boolean;
  initialFocus?: FocusTarget;
  finalFocus?: FocusTarget;
  "data-testid"?: string;
}) {
  const context = useContext(DialogContext);
  return (
    <CenterMorphModalContent
      panelProps={props}
      role={props.role === "alertdialog" ? "alertdialog" : "dialog"}
      ariaLabel={props["aria-label"]}
      ariaLabelledBy={props["aria-labelledby"] ?? context.titleId}
      ariaDescribedBy={props["aria-describedby"] ?? context.descriptionId}
      testId={props["data-testid"]}
      panelRef={ref}
      initialFocus={initialFocus}
      finalFocus={finalFocus}
      showCloseButton={showCloseButton}
      closeButtonLabel="Close"
      className={cn(
        "grid max-w-[min(32rem,100%)] gap-4 p-6 text-sm text-popover-foreground outline-none",
        className,
      )}
    >
      {children}
    </CenterMorphModalContent>
  );
}
function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="dialog-header" className={cn("flex flex-col gap-2", className)} {...props} />
  );
}
function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: ComponentProps<"div"> & { showCloseButton?: boolean }) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    >
      {children}
      {showCloseButton ? (
        <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
      ) : null}
    </div>
  );
}
function DialogTitle({ className, ...props }: ComponentProps<"h2">) {
  const context = useContext(DialogContext);
  return (
    <h2
      id={context.titleId}
      data-slot="dialog-title"
      className={cn("text-xl font-medium tracking-tight", className)}
      {...props}
    />
  );
}
function DialogDescription({ className, ...props }: ComponentProps<"p">) {
  const context = useContext(DialogContext);
  return (
    <p
      id={context.descriptionId}
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
};
