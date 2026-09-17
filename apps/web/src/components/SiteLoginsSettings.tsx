import { Trans, useLingui } from "@lingui/react/macro";
import type { SiteLogin } from "@rakazo/contracts";
import { Button, Input, Label } from "@rakazo/ui-web";
import { useEffect, useId, useState } from "react";
import { rpc } from "../lib/rpc";

/** Saved website logins bots type into password fields without seeing the value. */
export function SiteLoginsSettings() {
  const { t } = useLingui();
  const [logins, setLogins] = useState<SiteLogin[]>([]);
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hostId = useId();
  const usernameId = useId();
  const passwordId = useId();

  async function refresh() {
    try {
      setLogins(await rpc.siteLogins.list());
    } catch {
      setError(t`Could not load logins`);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await rpc.siteLogins.save({ host: host.trim().toLowerCase(), username, password });
      setHost("");
      setUsername("");
      setPassword("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : t`Could not save login`);
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await rpc.siteLogins.remove({ id });
      await refresh();
    } catch {
      setError(t`Could not remove login`);
    }
  }

  return (
    <section className="mt-8" data-testid="site-logins-settings">
      <h3 className="text-[15px] font-medium text-foreground">
        <Trans>Logins</Trans>
      </h3>
      {logins.length > 0 ? (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {logins.map((login) => (
            <li key={login.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <span className="min-w-0 flex-1 truncate">
                <span className="text-foreground">{login.host}</span>
                <span className="ml-2 text-muted-foreground">{login.username}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                onClick={() => void remove(login.id)}
              >
                <Trans>Remove</Trans>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={hostId}>
            <Trans>Site</Trans>
          </Label>
          <Input
            id={hostId}
            data-testid="site-login-host"
            placeholder="example.com"
            autoComplete="off"
            value={host}
            onChange={(event) => setHost(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={usernameId}>
            <Trans>Username</Trans>
          </Label>
          <Input
            id={usernameId}
            data-testid="site-login-username"
            autoComplete="off"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={passwordId}>
            <Trans>Password</Trans>
          </Label>
          <Input
            id={passwordId}
            data-testid="site-login-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        className="mt-4 rounded-full"
        data-testid="site-login-save"
        disabled={pending || !host.trim() || !username.trim() || !password}
        onClick={() => void save()}
      >
        {pending ? <Trans>Saving…</Trans> : <Trans>Save login</Trans>}
      </Button>
    </section>
  );
}
