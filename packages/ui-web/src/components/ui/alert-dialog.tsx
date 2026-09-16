"use client";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";
import { Button } from "./button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

const AlertDialog = Dialog;
const AlertDialogTrigger = DialogTrigger;
const AlertDialogHeader = DialogHeader;
const AlertDialogFooter = DialogFooter;
const AlertDialogTitle = DialogTitle;
const AlertDialogDescription = DialogDescription;
function AlertDialogContent({
  size,
  className,
  ...props
}: ComponentProps<typeof DialogContent> & { size?: "default" | "sm" }) {
  return (
    <DialogContent
      role="alertdialog"
      showCloseButton={false}
      initialFocus={() =>
        document.querySelector<HTMLElement>(
          '[role="alertdialog"] [data-slot="alert-dialog-cancel"]',
        )
      }
      className={cn("max-w-sm", className)}
      {...props}
    />
  );
}
function AlertDialogAction(props: ComponentProps<typeof Button>) {
  return <Button data-slot="alert-dialog-action" {...props} />;
}
function AlertDialogCancel({
  variant = "outline",
  size = "default",
  ...props
}: ComponentProps<typeof DialogClose> & Pick<ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <DialogClose
      data-slot="alert-dialog-cancel"
      render={<Button variant={variant} size={size} />}
      {...props}
    />
  );
}
function AlertDialogMedia({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex size-11 items-center justify-center", className)} {...props} />;
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
};
