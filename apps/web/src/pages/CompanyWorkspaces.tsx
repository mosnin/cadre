import { Trans, useLingui } from "@lingui/react/macro";
import type { Space } from "@rakazo/contracts";
import { Button, Input } from "@rakazo/ui-web";
import {
  CenterMorphModal,
  CenterMorphModalContent,
} from "@rakazo/ui-web/directory/center-morph-modal";
import { Popover, PopoverContent, PopoverTrigger } from "@rakazo/ui-web/directory/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rakazo/ui-web/directory/select";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { rpc, selectSpace, withSpaceHeaders } from "../lib/rpc";

type Connection = { spaceId: string; companyName: string; companySlug: string; connected: boolean };
export async function companyWorkspaceRequest(path = "", method = "GET", spaceId?: string) {
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
let companyConnectionsInFlight: Promise<{ connections: Connection[] }> | null = null;
/**
 * The workspace name and the Company OS row sit in different parts of the
 * rail now, and both need the same answer. Sharing the in-flight request keeps
 * that one call rather than two.
 */
function useCompanyConnections(currentSpaceId?: string) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let alive = true;
    const refresh = (fresh = false) => {
      setState("loading");
      if (fresh) companyConnectionsInFlight = null;
      if (!companyConnectionsInFlight) companyConnectionsInFlight = companyWorkspaceRequest();
      const request = companyConnectionsInFlight;
      void request
        .then((result) => {
          if (!alive) return;
          setConnections(result.connections);
          setState("ready");
        })
        .catch(() => {
          if (!alive) return;
          companyConnectionsInFlight = null;
          setState("error");
        });
    };
    refresh();
    const onChanged = () => refresh(true);
    window.addEventListener("company-workspaces-changed", onChanged);
    return () => {
      alive = false;
      window.removeEventListener("company-workspaces-changed", onChanged);
    };
  }, [currentSpaceId]);
  return { connections, state };
}

export function CompanyWorkspaceSettings({ onConnect }: { onConnect: (spaceId: string) => void }) {
  const { t } = useLingui();
  const [error, setError] = useState("");
  const [available, setAvailable] = useState<boolean>();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [current, setCurrent] = useState("");
  useEffect(() => {
    let alive = true;
    void Promise.all([companyWorkspaceRequest(), rpc.me()])
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
    <section className="mt-8">
      <h3 className="text-[15px] font-medium">
        <Trans>Company OS</Trans>
      </h3>
      <p className="mt-2 text-sm">
        {error
          ? t`Connection unavailable`
          : available === undefined
            ? t`Loading company…`
            : (connection?.companyName ?? t`No company connected`)}
      </p>
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
                await companyWorkspaceRequest("/disconnect", "POST");
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
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);
  useEffect(() => {
    let alive = true;
    void Promise.all([rpc.spaces.list(), companyWorkspaceRequest()])
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
    <CenterMorphModal
      open
      onOpenChange={(value) => {
        if (!value && !pending) onClose();
      }}
    >
      <CenterMorphModalContent
        className="max-w-lg p-6 sm:p-8"
        dismissible={!pending}
        closeButtonLabel={t`Close company connection`}
        ariaLabel={createCompany ? t`Create a company` : t`Connect a company`}
      >
        <h2 className="pe-12 text-2xl font-medium tracking-tight">
          {createCompany ? t`Create a company` : t`Connect a company`}
        </h2>
        <form
          className="mt-8 space-y-6"
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
              const result = await companyWorkspaceRequest(
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
            <span>
              <Trans>Workspace</Trans>
            </span>
            <Select value={spaceId} disabled={!available || pending} onValueChange={setSpaceId}>
              <SelectTrigger ariaLabel={t`Workspace`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t`New workspace`}</SelectItem>
                {spaces.map((space) => (
                  <SelectItem key={space.id} value={space.id}>
                    {space.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}
export function WorkspaceSwitcher({
  spaces,
  currentSpaceId,
  onSwitch,
  onCreate,
  onManage,
  part = "both",
}: {
  spaces: Space[];
  currentSpaceId?: string;
  onSwitch: (spaceId: string, path: string) => void;
  onCreate: () => void;
  onManage: () => void;
  part?: "both" | "name" | "status";
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [createCompany, setCreateCompany] = useState(false);
  const { connections, state: connectionState } = useCompanyConnections(currentSpaceId);
  const current = spaces.find((space) => space.id === currentSpaceId);
  const company = connections.find((row) => row.spaceId === currentSpaceId);
  return (
    <div className="app-no-drag w-full">
      {part === "status" ? null : (
        <Popover
          open={open}
          onOpenChange={setOpen}
          align="start"
          sideOffset={8}
          gooStrength={0}
          className="w-full"
        >
          <PopoverTrigger>
            <button
              type="button"
              // 17px over a 48.5px row at 1920 in the reference, which is
              // 13.5 over 38 at the width this is built to.
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left text-xl font-medium tracking-tight hover:bg-muted md:min-h-[38px] md:rounded-lg md:px-1.5 md:py-0 md:text-[13.5px]"
              aria-label={t`Switch workspace`}
            >
              <span className="truncate">{current?.name ?? t`Workspace`}</span>
              <ChevronDown aria-hidden="true" className="size-5 shrink-0 md:size-[13px]" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            ariaLabel={t`Workspaces`}
            className="w-72 max-w-[calc(100vw-2rem)] gap-1 p-2"
          >
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
      )}
      {part === "name" ? null : (
        <button
          type="button"
          data-testid="workspace-company-status"
          className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground md:min-h-[38px] md:rounded-lg md:px-2.5 md:py-0 md:text-[13.5px]"
          onClick={() => {
            if (company?.connected) onManage();
            else {
              setCreateCompany(false);
              setConnectOpen(true);
            }
          }}
        >
          <span className="min-w-0 flex-1 truncate">
            {connectionState === "loading"
              ? t`Loading Company OS…`
              : connectionState === "error"
                ? t`Company OS unavailable`
                : company
                  ? company.companyName
                  : t`Connect Company OS`}
          </span>
          {company ? (
            <span className="text-xs">{company.connected ? t`Connected` : t`Disconnected`}</span>
          ) : null}
        </button>
      )}
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

/** Company context remains reachable while navigation is closed. */
export function WorkspaceIdentity({
  spaceId,
  workspaceName,
}: {
  spaceId?: string;
  workspaceName: string;
}) {
  const { t } = useLingui();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [returnError, setReturnError] = useState(false);
  const [connectedTarget, setConnectedTarget] = useState<string>();
  useEffect(() => {
    // The OAuth callback lands on /app and bootstrap immediately replaces the
    // route with /app/<bot>, so the outcome must be read on first mount.
    const params = new URLSearchParams(window.location.search);
    if (params.has("company-connected")) setConnectedTarget(params.get("company-connected")!);
    else if (params.has("company-error")) setReturnError(true);
    else if (!params.has("company-ready")) return;
    for (const key of ["company-connected", "company-ready", "company-error"]) params.delete(key);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`,
    );
  }, []);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      setLoaded(false);
      setLoadFailed(false);
      setConnection(null);
      void companyWorkspaceRequest()
        .then((result) => {
          if (!alive) return;
          setConnection(
            result.connections.find((row: Connection) => row.spaceId === spaceId) ?? null,
          );
          setLoaded(true);
        })
        .catch(() => {
          if (alive) {
            setLoaded(true);
            setLoadFailed(true);
          }
        });
    };
    refresh();
    window.addEventListener("company-workspaces-changed", refresh);
    return () => {
      alive = false;
      window.removeEventListener("company-workspaces-changed", refresh);
    };
  }, [spaceId]);
  useEffect(() => {
    // A connection made for another workspace switches to it once the current
    // space is known. Success needs no copy: the company name renders below.
    if (spaceId === undefined || !connectedTarget) return;
    if (connectedTarget !== spaceId && selectSpace(connectedTarget))
      window.location.replace("/app");
    else setConnectedTarget(undefined);
  }, [spaceId, connectedTarget]);
  return (
    <>
      <button
        type="button"
        aria-label={t`Company context`}
        onClick={() => setOpen(true)}
        className="app-no-drag flex min-h-11 min-w-0 w-full sm:w-40 flex-col justify-center rounded-xl px-2 text-left hover:bg-accent"
      >
        <span className="truncate text-sm font-medium w-full">{workspaceName}</span>
        <span
          role={returnError && loaded && !connection?.connected ? "status" : undefined}
          className={`truncate text-xs w-full ${
            returnError && loaded && !connection?.connected
              ? "text-destructive"
              : "text-muted-foreground"
          }`}
        >
          {!loaded
            ? t`Loading company…`
            : loadFailed
              ? t`Connection unavailable`
              : connection?.connected
                ? connection.companyName
                : returnError
                  ? t`Connection not completed. Try again.`
                  : t`Connect Company OS`}
        </span>
      </button>
      {open ? (
        <CenterMorphModal
          open
          onOpenChange={(next) => {
            if (!next) setOpen(false);
          }}
        >
          <CenterMorphModalContent
            ariaLabel={t`Company context`}
            closeButtonLabel={t`Close company context`}
            className="max-w-lg p-6 sm:p-8"
          >
            <h2 className="pe-12 text-2xl font-medium tracking-tight">{workspaceName}</h2>
            <CompanyWorkspaceSettings
              onConnect={() => {
                setOpen(false);
                setConnectOpen(true);
              }}
            />
          </CenterMorphModalContent>
        </CenterMorphModal>
      ) : null}
      {connectOpen ? (
        <CompanyConnectionDialog initialSpaceId={spaceId} onClose={() => setConnectOpen(false)} />
      ) : null}
    </>
  );
}
