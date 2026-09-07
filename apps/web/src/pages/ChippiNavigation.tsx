import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { chippiHost } from "../lib/chippi-host";
export function ChippiNavigation() {
  const host = chippiHost();
  const location = useLocation();
  const [crmHref, setCrmHref] = useState(host?.crmHref);
  useEffect(() => {
    if (!host) return;
    try {
      const parts = host.basePath.split("/");
      const saved = sessionStorage.getItem(
        `chippi:crm:${parts[2]}:${decodeURIComponent(parts[3] ?? "")}`,
      );
      // Brokerage navigation must go through the server switch to bind authority.
      setCrmHref(
        parts[2] === "personal" && saved?.startsWith(host.crmHref + "/") ? saved : host.crmHref,
      );
      sessionStorage.setItem(
        `chippi:workforce:${host.basePath}`,
        host.basePath + location.pathname + location.search,
      );
    } catch {}
  }, [host?.basePath, location.pathname, location.search]);
  if (!host) return null;
  return (
    <div className="px-4 pt-16 pb-2 md:pt-4">
      {host.workspaces && host.workspaces.length > 1 ? (
        <select
          aria-label="Workspace"
          className="w-full truncate rounded-md border border-border bg-background px-2 py-2 text-sm"
          value={host.basePath + "/app"}
          onChange={(event) => {
            window.location.href = event.target.value;
          }}
        >
          {host.workspaces.map((workspace) => (
            <option key={workspace.href} value={workspace.href}>
              {workspace.name} · {workspace.role}
            </option>
          ))}
        </select>
      ) : (
        <div className="truncate text-sm font-medium">{host.name}</div>
      )}
      <div className="mt-1 text-xs text-muted-foreground">{host.role}</div>
      <nav
        aria-label="Dashboard view"
        className="mt-3 grid grid-cols-2 rounded-lg bg-muted p-1 text-sm"
      >
        <a
          className="rounded-md px-3 py-1.5 text-center hover:bg-background"
          href={crmHref ?? host.crmHref}
        >
          CRM
        </a>
        <span
          aria-current="page"
          className="rounded-md bg-background px-3 py-1.5 text-center font-medium"
        >
          Workforce
        </span>
      </nav>
    </div>
  );
}
