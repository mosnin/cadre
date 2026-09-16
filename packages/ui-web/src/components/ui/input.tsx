import { cn } from "@rakazo/ui-web/lib/utils";
import type * as React from "react";
import { Input as DirectoryInput } from "../../directory/input";

/** beUI input adapted to the native event API used throughout Cadre. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <DirectoryInput
      type={type}
      data-slot="input"
      className="min-w-0 w-full"
      classNames={{
        field: cn("bg-transparent dark:bg-input/30", className),
        input:
          "min-w-0 file:border-0 file:bg-transparent file:text-sm file:text-foreground disabled:cursor-not-allowed",
      }}
      {...props}
    />
  );
}

export { Input };
