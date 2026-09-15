import type { ReactNode } from "react";
import { BouncyAccordion } from "../../directory/bouncy-accordion";

/** Product disclosure composed from the directory accordion. */
export function Disclosure({
  summary,
  children,
  className,
  "data-testid": testId,
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <div className={className} data-testid={testId}>
      <BouncyAccordion
        items={[{ id: "content", title: summary, description: children }]}
        classNames={{
          item: "bg-transparent",
          trigger: "min-h-11 px-0",
          title: "whitespace-normal text-sm font-normal",
          body: "px-0 pb-2",
          description: "text-sm",
        }}
      />
    </div>
  );
}
