import { Component, type ReactNode } from "react";

/** Keep a failed render recoverable, including failures before locale activation. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch() {
    document.getElementById("startup-status")?.remove();
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="grid h-full place-items-center p-6" role="alert">
        <div className="max-w-sm space-y-4">
          <h1 className="text-xl font-medium">Cadre couldn’t open this page</h1>
          <p className="text-sm text-muted-foreground">
            Your workspace is saved. Reload to try again.
          </p>
          <button
            type="button"
            className="min-h-11 rounded-lg border border-border px-4"
            onClick={() => window.location.reload()}
          >
            Reload Cadre
          </button>
        </div>
      </main>
    );
  }
}
