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
import { rpc, withSpaceHeaders } from "../lib/rpc";

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
/** Outcome of a Company OS return, consumed once by Settings. */
export type CompanyNotice = "connected" | "error";
export function CompanyWorkspaceSettings({
  notice,
  onOpenWorkforce,
}: {
  notice?: CompanyNotice | null;
  onOpenWorkforce?: () => void;
}) {
  const { t } = useLingui();
  const [error, setError] = useState("");
  const [available, setAvailable] = useState<boolean>();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [current, setCurrent] = useState("");
  const [dialog, setDialog] = useState<"connect" | "create" | null>(null);
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
    <section data-testid="company-settings">
      <p className="text-sm">
        {error
          ? t`Connection unavailable`
          : available === undefined
            ? t`Loading company…`
            : (connection?.companyName ?? t`No company connected`)}
      </p>
      {connection ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {connection.companySlug} · {connection.connected ? t`Connected` : t`Disconnected`}
        </p>
      ) : null}
      {notice ? (
        <p
          role={notice === "error" ? "alert" : "status"}
          className="mt-2 text-sm text-muted-foreground"
        >
          {notice === "error" ? t`Company connection was not completed` : t`Company connected`}
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
        <Button variant="outline" disabled={!available} onClick={() => setDialog("connect")}>
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
        ) : (
          <Button variant="ghost" disabled={!available} onClick={() => setDialog("create")}>
            <Trans>Create company</Trans>
          </Button>
        )}
        {onOpenWorkforce ? (
          <Button variant="ghost" onClick={onOpenWorkforce}>
            <Trans>Workforce</Trans>
          </Button>
        ) : null}
      </div>
      {dialog ? (
        <CompanyConnectionDialog
          createCompany={dialog === "create"}
          initialSpaceId={dialog === "create" ? "" : current}
          onClose={() => setDialog(null)}
        />
      ) : null}
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
}: {
  spaces: Space[];
  currentSpaceId?: string;
  onSwitch: (spaceId: string, path: string) => void;
  onCreate: () => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void companyWorkspaceRequest()
        .then((result) => {
          if (alive) setConnections(result.connections);
        })
        .catch(() => undefined);
    };
    refresh();
    window.addEventListener("company-workspaces-changed", refresh);
    return () => {
      alive = false;
      window.removeEventListener("company-workspaces-changed", refresh);
    };
  }, []);
  const current = spaces.find((space) => space.id === currentSpaceId);
  return (
    <div className="app-no-drag w-full">
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
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left text-xl font-medium tracking-tight hover:bg-muted"
            aria-label={t`Switch workspace`}
          >
            <span className="truncate">{current?.name ?? t`Workspace`}</span>
            <ChevronDown aria-hidden="true" />
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
        </PopoverContent>
      </Popover>
    </div>
  );
}
