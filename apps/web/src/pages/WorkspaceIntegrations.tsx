import type { Bot } from "@cadre/contracts";
import { Button, NativeSelect, NativeSelectOption } from "@cadre/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { rpc, withSpaceHeaders } from "../lib/rpc";

type Provider = { id: string; name: string; workspaceNoun: string };
type Connection = {
  provider: string;
  externalId: string;
  externalName: string;
  connected: boolean;
};
type Listing = { available: boolean; providers: Provider[]; connections: Connection[] };

async function request(path = "", method = "GET"): Promise<Listing & { url?: string }> {
  const response = await fetch(`/api/v1/workspace-integrations${path}`, {
    method,
    credentials: "include",
    headers: withSpaceHeaders(),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Could not load connections");
  return value;
}

/** Outcome of an OAuth return, consumed once by Settings. */
export type WorkspaceIntegrationNotice = { provider: string; error: boolean };

export function WorkspaceIntegrationSettings({
  notice,
}: {
  notice?: WorkspaceIntegrationNotice | null;
}) {
  const { t } = useLingui();
  const [listing, setListing] = useState<Listing>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    request()
      .then((value) => {
        if (alive) setListing(value);
      })
      .catch(() => {
        if (alive) setError(t`Could not load connections`);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function change(provider: string, connected: boolean) {
    setBusy(provider);
    setError("");
    try {
      const result = await request(`/${provider}/${connected ? "disconnect" : "connect"}`, "POST");
      if (!connected && result.url) {
        window.location.assign(result.url);
        return;
      }
      setListing(await request());
    } catch (e) {
      setError(e instanceof Error ? e.message : t`Connection failed`);
    }
    setBusy(undefined);
  }
  return (
    <section className="space-y-6" aria-label={t`Connections`}>
      {listing === undefined && !error ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Loading…</Trans>
        </p>
      ) : null}
      {listing?.providers.map((provider) => {
        const connection = listing.connections.find((item) => item.provider === provider.id);
        const connected = connection?.connected ?? false;
        return (
          <div key={provider.id} className="space-y-2" data-testid={`connection-${provider.id}`}>
            <h3 className="text-[15px] font-medium">{provider.name}</h3>
            {connection ? (
              <p className="break-words text-sm text-muted-foreground">
                {connection.externalName} · {connected ? t`Connected` : t`Disconnected`}
              </p>
            ) : null}
            {notice?.provider === provider.id ? (
              <p role={notice.error ? "alert" : "status"} className="text-sm text-muted-foreground">
                {notice.error ? t`Connection was not completed` : t`Connected`}
              </p>
            ) : null}
            {provider.id === "operate" && connected ? <OperateTaskBot /> : null}
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              disabled={!listing.available || Boolean(busy)}
              onClick={() => void change(provider.id, connected)}
            >
              {busy === provider.id
                ? connected
                  ? t`Disconnecting…`
                  : t`Connecting…`
                : connected
                  ? t`Disconnect ${provider.name}`
                  : t`Connect ${provider.name}`}
            </Button>
          </div>
        );
      })}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

type OperateWorker = { botId: string; lastError: string | null } | null;

async function operateWork(body?: { botId: string | null }): Promise<OperateWorker> {
  const response = await fetch("/api/v1/operate-work", {
    method: body ? "PUT" : "GET",
    credentials: "include",
    headers: withSpaceHeaders(body ? { "content-type": "application/json" } : {}),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Could not save");
  return value.worker;
}

/** The bot that claims and runs the tasks assigned to this member's Operate agent. */
function OperateTaskBot() {
  const { t } = useLingui();
  const [bots, setBots] = useState<Bot[]>([]);
  const [worker, setWorker] = useState<OperateWorker>();
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    Promise.all([rpc.bots.list(), operateWork()])
      .then(([nextBots, nextWorker]) => {
        if (!alive) return;
        setBots(nextBots);
        setWorker(nextWorker);
      })
      .catch(() => {
        if (alive) setError(t`Could not load Operate tasks`);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function choose(botId: string) {
    setError("");
    try {
      setWorker(await operateWork({ botId: botId || null }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t`Could not save`);
    }
  }
  if (worker === undefined && !error) return null;
  const problem = error || worker?.lastError;
  return (
    <div className="space-y-1">
      <NativeSelect
        aria-label={t`Bot for Operate tasks`}
        value={worker?.botId ?? ""}
        onChange={(event) => void choose(event.target.value)}
      >
        <NativeSelectOption value="">{t`No bot takes Operate tasks`}</NativeSelectOption>
        {bots.map((bot) => (
          <NativeSelectOption key={bot.id} value={bot.id}>
            {bot.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
