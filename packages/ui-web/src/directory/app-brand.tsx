import type { ComponentProps } from "react";
import { cn } from "../lib/utils";
export function AppBrand({
  className,
  size = 28,
  ...props
}: ComponentProps<"img"> & { size?: number }) {
  return (
    <img
      src="/brand/cadre-icon.svg"
      alt="Cadre"
      width={size}
      height={size}
      className={cn("cadre-mark shrink-0", className)}
      {...props}
    />
  );
}
