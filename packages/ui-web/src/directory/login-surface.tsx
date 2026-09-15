import type { ReactNode } from "react";

export function LoginSurface({ children, context }: { children: ReactNode; context: ReactNode }) {
  return (
    // Directory two-column login composition, with product context instead of demo artwork.
    <div
      data-slot="login-surface"
      className="grid min-h-svh w-full bg-background text-foreground lg:grid-cols-10"
    >
      <div className="flex col-span-4 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </div>
      <div className="relative hidden bg-sidebar lg:flex items-center justify-center col-span-6 p-16">
        {context}
      </div>
    </div>
  );
}
