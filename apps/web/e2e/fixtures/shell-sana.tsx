/**
 * Harness for the Sana-derived shell.
 *
 * Every app route sits behind a session check, so the shell cannot be rendered
 * — let alone captured and diffed against its reference — without standing up
 * an API. This mounts it against a fixture instead.
 *
 * It follows the existing fixture convention, so it is compiled only under
 * PLAYWRIGHT_PRODUCTION and never reaches a hosted build.
 *
 * `?theme=light` renders the light counterpart; without it the harness shows
 * dark, which is what the app defaults to.
 */
import { createRoot } from "react-dom/client";
import { SHELL_SANA_FIXTURE, ShellSana } from "../../src/pages/shell-sana/ShellSana";
import "../../src/styles.css";

if (new URLSearchParams(location.search).get("theme") === "light") {
  document.documentElement.dataset.theme = "light";
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <ShellSana {...SHELL_SANA_FIXTURE} />,
);
