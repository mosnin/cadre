/**
 * Design harness.
 *
 * The app gates every route behind a session check, so the shell cannot be
 * rendered — or captured and diffed against its reference — without standing up
 * an API. This entry mounts it directly against a fixture instead. It is a
 * separate Vite entry, so it ships nothing into the app bundle.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SHELL_SANA_FIXTURE, ShellSana } from "./pages/shell-sana/ShellSana";
import "./styles.css";

// ?theme=light renders the light reference's counterpart; the app itself
// defaults to dark, which is what the harness shows without the flag.
const theme = new URLSearchParams(location.search).get("theme");
if (theme === "light") document.documentElement.dataset.theme = "light";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ShellSana {...SHELL_SANA_FIXTURE} />
  </StrictMode>,
);
