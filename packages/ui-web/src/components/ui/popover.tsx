"use client";

import {
  Children,
  type ComponentProps,
  cloneElement,
  isValidElement,
  type ReactElement,
} from "react";
import {
  PopoverContent as DirectoryContent,
  Popover as DirectoryPopover,
  type PopoverProps as DirectoryProps,
  PopoverTrigger as DirectoryTrigger,
} from "../../directory/popover";
import { cn } from "../../lib/utils";

type ContentProps = ComponentProps<"div"> & {
  align?: DirectoryProps["align"];
  side?: DirectoryProps["side"];
  sideOffset?: number;
  alignOffset?: number;
  "data-testid"?: string;
};
function Popover({ children, ...props }: Omit<DirectoryProps, "side" | "align" | "sideOffset">) {
  const content = Children.toArray(children).find(
    (child) => isValidElement(child) && child.type === PopoverContent,
  ) as ReactElement<ContentProps> | undefined;
  return (
    <DirectoryPopover
      gooStrength={0}
      side={content?.props.side ?? "bottom"}
      align={content?.props.align ?? "center"}
      sideOffset={content?.props.sideOffset ?? 8}
      {...props}
    >
      {children}
    </DirectoryPopover>
  );
}
function PopoverTrigger({
  render,
  children,
  ...props
}: ComponentProps<"button"> & { render?: ReactElement }) {
  const trigger = render ? (
    cloneElement(render as ReactElement<Record<string, unknown>>, { ...props, children })
  ) : (
    <button type="button" {...props}>
      {children}
    </button>
  );
  return <DirectoryTrigger>{trigger}</DirectoryTrigger>;
}
function PopoverContent({
  className,
  children,
  align,
  side,
  sideOffset,
  alignOffset,
  ref,
  ...props
}: ContentProps) {
  return (
    <DirectoryContent
      ariaLabel={props["aria-label"]}
      contentProps={props}
      className={cn("flex w-72 flex-col gap-2.5 p-2.5 text-sm", className)}
    >
      {children}
    </DirectoryContent>
  );
}
function PopoverHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 text-sm", className)}
      {...props}
    />
  );
}
function PopoverTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 data-slot="popover-title" className={cn("font-medium", className)} {...props} />;
}
function PopoverDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger };
