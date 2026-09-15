import { createRoot } from "react-dom/client";
import { AppErrorBoundary } from "../../src/components/AppErrorBoundary";
import "../../src/styles.css";

function FailedPage(): never {
  throw new Error("Deterministic render failure");
}
createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <FailedPage />
  </AppErrorBoundary>,
);
