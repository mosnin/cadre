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
  return value;
}
export function CompanyWorkspaceSettings() {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
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
      {connection ? <p className="mt-2 text-sm">{connection.companyName}</p> : null}
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
      <div className="mt-3 flex gap-2">
        <Button variant="outline" disabled={!available} onClick={() => setOpen(true)}>
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
      {open ? (
        <CompanyConnectionDialog initialSpaceId={current} onClose={() => setOpen(false)} />
      ) : null}
    </section>
  );
}
export function CompanyConnectionDialog({
  onClose,
  initialSpaceId = "",
}: {
  onClose: () => void;
  initialSpaceId?: string;
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans>Connect a company</Trans>
          </DialogTitle>
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
                setSpaceId(target);
              }
              const result = await request("/connect", "POST", target);
              window.location.assign(result.url);
            } catch (e) {
              setError(e instanceof Error ? e.message : t`Could not connect Company OS`);
              setPending(false);
            }
          }}
        >
          <label className="grid gap-2 text-sm">
            <Trans>Workspace</Trans>
            <select
              className="rounded-md border border-border bg-background p-2"
              value={spaceId}
              disabled={pending}
              onChange={(e) => setSpaceId(e.target.value)}
            >
              <option value="">{t`New workspace`}</option>
              {spaces.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </select>
          </label>
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
              Choose your business and permissions in Company OS. Its context stays in this
              workspace. Use a new workspace for a different business.
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
}: {
  spaces: Space[];
  currentSpaceId?: string;
  onSwitch: (spaceId: string, path: string) => void;
  onCreate: () => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let alive = true;
    void request()
      .then((result) => {
        if (alive) setConnections(result.connections);
      })
      .catch(() => {});
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
          <span className="truncate">
            {company
              ? `${company.companyName} / ${current?.name ?? t`Workspace`}`
              : (current?.name ?? t`Workspace`)}
          </span>
          <span aria-hidden="true">⌄</span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1">
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
              setConnectOpen(true);
            }}
          >
            <Trans>Connect Company OS</Trans>
          </Button>
        </PopoverContent>
      </Popover>
      {message ? (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
      {connectOpen ? <CompanyConnectionDialog onClose={() => setConnectOpen(false)} /> : null}
    </div>
  );
}
