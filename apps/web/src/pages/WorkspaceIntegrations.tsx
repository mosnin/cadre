import { Button } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { withSpaceHeaders } from "../lib/rpc";

type Provider = "operate" | "stored";
type Connection = {
  provider: Provider;
  externalId: string;
  externalName: string;
  connected: boolean;
};
async function request(path = "", method = "GET") {
  const response = await fetch(`/api/v1/workspace-integrations${path}`, {
    method,
    credentials: "include",
    headers: withSpaceHeaders(),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Could not load workspace connections");
  return value;
}
export function WorkspaceIntegrationSettings() {
  const [connections, setConnections] = useState<Connection[]>();
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState<Provider>();
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    request()
      .then((value) => {
        if (alive) {
          setConnections(value.connections);
          setAvailable(value.available);
        }
      })
      .catch(() => {
        if (alive) setError("Could not load workspace connections. Reopen Settings to retry.");
      });
    return () => {
      alive = false;
    };
  }, []);
  async function change(provider: Provider, connected: boolean) {
    setBusy(provider);
    setError("");
    try {
      const result = await request(`/${provider}/${connected ? "disconnect" : "connect"}`, "POST");
      if (!connected) {
        window.location.assign(result.url);
        return;
      }
      const updated = await request();
      setConnections(updated.connections);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed. Try again.");
    }
    setBusy(undefined);
  }
  return (
    <section className="mt-8 space-y-6" aria-label="Workspace connections">
      {(["operate", "stored"] as const).map((provider) => {
        const name = provider === "operate" ? "Operate" : "Stored";
        const connection = connections?.find((item) => item.provider === provider);
        return (
          <div key={provider} className="space-y-2">
            <h3 className="text-[15px] font-medium">{name}</h3>
            <p className="break-words text-sm text-muted-foreground">
              {connections === undefined
                ? "Loading connection…"
                : connection
                  ? `${connection.externalName}${connection.connected ? " · Connected" : " · Disconnected"}`
                  : provider === "operate"
                    ? "Connect a workspace for projects and recurring tasks."
                    : "Connect an organization for shared and private agent memories."}
            </p>
            <Button
              type="button"
              disabled={!available || Boolean(busy)}
              onClick={() => void change(provider, Boolean(connection?.connected))}
              className="min-h-11 rounded-full bg-muted px-5 py-2 text-sm text-foreground hover:bg-muted/80 focus-visible:outline focus-visible:outline-2 disabled:opacity-50"
            >
              {busy === provider
                ? connection?.connected
                  ? "Disconnecting…"
                  : "Connecting…"
                : connection?.connected
                  ? `Disconnect ${name}`
                  : `Connect ${name}`}
            </Button>
          </div>
        );
      })}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {new URLSearchParams(window.location.search).has("connection-error") && (
        <p role="alert" className="text-sm text-destructive">
          The connection was not completed. Select the original account and organization, or use a
          new Cadre workspace for a different organization.
        </p>
      )}
    </section>
  );
}
