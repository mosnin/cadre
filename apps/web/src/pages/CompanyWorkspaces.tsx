import { Trans, useLingui } from "@lingui/react/macro";
import type { Space } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@rakazo/ui-web";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { rpc, selectSpace, withSpaceHeaders } from "../lib/rpc";

type Connection = { spaceId: string; companyName: string; companySlug: string; connected: boolean };
async function request(path = "", method = "GET", spaceId?: string) {
  const response = await fetch(`/api/v1/company-workspaces${path}`, {
    method,
    credentials: "include",
    headers: spaceId ? withSpaceHeaders(undefined, spaceId) : withSpaceHeaders(),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Could not load Company OS connection");
  if (path === "/disconnect" && method === "POST")
    window.dispatchEvent(new Event("company-workspaces-changed"));
  return value;
}
export function CompanyWorkspaceSettings({ onConnect }: { onConnect: (spaceId: string) => void }) {
  const { t } = useLingui();
  const [error, setError] = useState("");
  const [available, setAvailable] = useState<boolean>();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [current, setCurrent] = useState("");
  useEffect(() => {
    let alive = true;
    void Promise.all([request(), rpc.me()])
      .then(([result, me]) => {
        if (!alive) return;
        setAvailable(result.available);
        setConnections(result.connections);
        setCurrent(me.spaceId);
      })
      .catch(() => {
        if (alive) setError(t`Could not load Company OS connection`);
      });
    return () => {
      alive = false;
    };
  }, []);
  const connection = connections.find((row) => row.spaceId === current);
  return (
    <section className="mt-5 rounded-xl border border-border px-4 py-4">
      <h3 className="text-[15px] font-medium">
        <Trans>Company OS</Trans>
      </h3>
      <p className="mt-2 text-sm">{connection?.companyName ?? t`No company connected`}</p>
      {connection ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {connection.connected ? t`Connected` : t`Disconnected`}
        </p>
      ) : null}
      {available === false ? (
        <p className="mt-2 text-sm text-muted-foreground">
          <Trans>Company OS connection is not configured on this deployment.</Trans>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" disabled={!available} onClick={() => onConnect(current)}>
          {connection?.connected ? t`Reconnect Company OS` : t`Connect Company OS`}
        </Button>
        {connection?.connected ? (
          <Button
            variant="ghost"
            onClick={async () => {
              try {
                await request("/disconnect", "POST");
                setConnections((rows) =>
                  rows.map((row) => (row.spaceId === current ? { ...row, connected: false } : row)),
                );
              } catch {
                setError(t`Could not disconnect Company OS`);
              }
            }}
          >
            <Trans>Disconnect</Trans>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
export function CompanyConnectionDialog({
  onClose,
  initialSpaceId = "",
  createCompany = false,
}: {
  onClose: () => void;
  initialSpaceId?: string;
  createCompany?: boolean;
}) {
  const { t } = useLingui();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [spaceId, setSpaceId] = useState(initialSpaceId);
  const [name, setName] = useState("");
  const [available, setAvailable] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void Promise.all([rpc.spaces.list(), request()])
      .then(([result, status]) => {
        if (alive) {
          setSpaces(result.spaces);
          setAvailable(status.available);
          if (!status.available)
            setError(t`Company OS connection is not configured on this deployment.`);
        }
      })
      .catch(() => {
        if (alive) setError(t`Could not load workspaces`);
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !pending) onClose();
      }}
    >
      <DialogContent
        className="max-w-md"
        aria-label={createCompany ? t`Create a company` : t`Connect a company`}
      >
        <DialogHeader>
          <DialogTitle>{createCompany ? t`Create a company` : t`Connect a company`}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError("");
            try {
              let target = spaceId;
              if (!target) {
                const created = await rpc.spaces.create({ name: name.trim() });
                target = created.id;
                setSpaces((rows) => [...rows, created]);
                setSpaceId(target);
              }
              const result = await request(
                createCompany ? "/connect?create=1" : "/connect",
                "POST",
                target,
              );
              window.location.assign(result.url);
            } catch (e) {
              setError(e instanceof Error ? e.message : t`Could not connect Company OS`);
              setPending(false);
            }
          }}
        >
          <div className="grid gap-2 text-sm">
            <label htmlFor="company-workspace-select">
              <Trans>Workspace</Trans>
            </label>
            <select
              id="company-workspace-select"
              className="rounded-md border border-border bg-background p-2"
              value={spaceId}
              disabled={!available || pending}
              onChange={(e) => setSpaceId(e.target.value)}
            >
              <option value="">{t`New workspace`}</option>
              {spaces.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </select>
          </div>
          {!spaceId ? (
            <label htmlFor="company-workspace-name" className="grid gap-2 text-sm">
              <Trans>Workspace name</Trans>
              <Input
                id="company-workspace-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={60}
                disabled={pending}
              />
            </label>
          ) : null}
          <p className="text-sm text-muted-foreground">
            <Trans>
              Create a company or choose an existing business in Company OS, then approve access.
              Its context stays in this workspace.
            </Trans>
          </p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={!available || pending || (!spaceId && !name.trim())}>
            {pending ? t`Connecting…` : t`Continue to Company OS`}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function WorkspaceSwitcher({
  spaces,
  currentSpaceId,
  onSwitch,
  onCreate,
  onManage,
}: {
  spaces: Space[];
  currentSpaceId?: string;
  onSwitch: (spaceId: string, path: string) => void;
  onCreate: () => void;
  onManage: () => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [createCompany, setCreateCompany] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [message, setMessage] = useState("");
  const [connectionState, setConnectionState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      setConnectionState("loading");
      void request()
        .then((result) => {
          if (alive) {
            setConnections(result.connections);
            setConnectionState("ready");
          }
        })
        .catch(() => {
          if (alive) setConnectionState("error");
        });
    };
    refresh();
    window.addEventListener("company-workspaces-changed", refresh);
    const params = new URLSearchParams(window.location.search);
    if (params.has("company-connected")) {
      const target = params.get("company-connected")!;
      if (target !== currentSpaceId && selectSpace(target)) {
        window.location.replace("/app?company-ready=1");
        return;
      }
      setMessage(t`Company connected. Agents can now read its authorized context.`);
    } else if (params.has("company-ready"))
      setMessage(t`Company connected. Agents can now read its authorized context.`);
    else if (params.has("company-error"))
      setMessage(t`Company connection was not completed. Try again from Settings.`);
    for (const key of ["company-connected", "company-ready", "company-error"]) params.delete(key);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`,
    );
    return () => {
      alive = false;
      window.removeEventListener("company-workspaces-changed", refresh);
    };
  }, [currentSpaceId]);
  const current = spaces.find((space) => space.id === currentSpaceId);
  const company = connections.find((row) => row.spaceId === currentSpaceId);
  return (
    <div className="mx-3 mb-3 app-no-drag">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
          aria-label={t`Switch workspace`}
        >
          <span className="truncate">{current?.name ?? t`Workspace`}</span>
          <ChevronDown aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] gap-1 p-2">
          <div className="max-h-64 overflow-y-auto">
            {spaces.map((space) => {
              const linked = connections.find((row) => row.spaceId === space.id);
              return (
                <Button
                  key={space.id}
                  variant="ghost"
                  className="w-full justify-start"
                  aria-current={space.id === currentSpaceId ? "true" : undefined}
                  onClick={() => {
                    setOpen(false);
                    onSwitch(space.id, "/app");
                  }}
                >
                  {linked ? `${linked.companyName} / ${space.name}` : space.name}
                </Button>
              );
            })}
          </div>
          <div className="my-1 border-t border-border" />
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              setOpen(false);
              onCreate();
            }}
          >
            <Trans>New workspace</Trans>
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              setOpen(false);
              setCreateCompany(false);
              setConnectOpen(true);
            }}
          >
            <Trans>Connect Company OS</Trans>
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              setOpen(false);
              setCreateCompany(true);
              setConnectOpen(true);
            }}
          >
            <Trans>Create company</Trans>
          </Button>
        </PopoverContent>
      </Popover>
      <div className="mt-2 border-t border-border pt-3" data-testid="workspace-company-status">
        <div className="px-2 text-xs text-muted-foreground">
          <Trans>Company OS</Trans>
        </div>
        <div className="mt-1 px-2 text-sm truncate">
          {connectionState === "loading"
            ? t`Loading connection…`
            : connectionState === "error"
              ? t`Could not load company connection`
              : (company?.companyName ?? t`No company connected`)}
        </div>
        {company && connectionState === "ready" ? (
          <div className="mt-1 px-2 text-xs text-muted-foreground">
            {company.connected ? t`Connected` : t`Disconnected`}
          </div>
        ) : null}
        <Button
          variant="ghost"
          className="mt-1 w-full justify-start"
          onClick={() => {
            if (company?.connected) {
              onManage();
              return;
            }
            setCreateCompany(false);
            setConnectOpen(true);
          }}
        >
          {company?.connected ? t`Manage connection` : t`Connect Company OS`}
        </Button>
      </div>
      {message ? (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
      {connectOpen ? (
        <CompanyConnectionDialog
          createCompany={createCompany}
          initialSpaceId={createCompany ? "" : currentSpaceId}
          onClose={() => setConnectOpen(false)}
        />
      ) : null}
    </div>
  );
}
