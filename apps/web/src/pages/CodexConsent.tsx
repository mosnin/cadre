import { Trans } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
export function CodexConsentPage() {
  const location = useLocation();
  const [account, setAccount] = useState<{ userId: string; name: string; execute: boolean } | null>(
    null,
  );
  const [failed, setFailed] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setAccount(null);
    setFailed(false);
    void fetch("/api/oauth/codex/consent" + location.search, {
      credentials: "include",
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        setAccount(await response.json());
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    return () => abort.abort();
  }, [location.search]);
  async function decide(decision: "allow" | "deny") {
    if (!account || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const body = new URLSearchParams(location.search);
      body.set("decision", decision);
      body.set("expected_user_id", account.userId);
      const response = await fetch("/api/oauth/codex/consent", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!response.ok) throw new Error("unavailable");
      const result = await response.json();
      window.location.assign(result.redirect);
    } catch {
      setBusy(false);
      setFailed(true);
    }
  }
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6">
      <section className="w-full max-w-md space-y-6 rounded-xl border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">
          <Trans>Connect Cadre to Codex</Trans>
        </h1>
        {account ? (
          <>
            <p className="break-words">{account.name}</p>
            <p className="text-sm text-muted-foreground">
              {account.execute ? (
                <Trans>Read work and run tasks across all spaces you can access.</Trans>
              ) : (
                <Trans>Read work across all spaces you can access.</Trans>
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              <Trans>Access lasts up to 30 days. Disconnect from Codex to revoke it.</Trans>
            </p>
          </>
        ) : !failed ? (
          <p role="status">
            <Trans>Checking account access…</Trans>
          </p>
        ) : null}
        {failed ? (
          <p role="alert" className="text-sm text-destructive">
            <Trans>Access is unavailable. Return to Codex and start sign-in again.</Trans>
          </p>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button variant="outline" disabled={!account || busy} onClick={() => void decide("deny")}>
            <Trans>Cancel</Trans>
          </Button>
          <Button disabled={!account || busy} onClick={() => void decide("allow")}>
            {busy ? <Trans>Connecting…</Trans> : <Trans>Allow access</Trans>}
          </Button>
        </div>
      </section>
    </main>
  );
}
