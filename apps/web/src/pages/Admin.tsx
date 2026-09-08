import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Textarea,
} from "@rakazo/ui-web";
import { ArrowLeft, ArrowUpRight, RefreshCw, ShieldCheck } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { authClient } from "../lib/auth";
import { rpc } from "../lib/rpc";

type Tab = "Overview" | "Users" | "Runs" | "Schedules" | "Audit" | "Settings";
type User = Awaited<ReturnType<typeof rpc.admin.users>>["items"][number];
type Confirmation = {
  title: string;
  detail: string;
  run: (reason: string, requestId: string) => Promise<unknown>;
};
const date = (value: string | null) => (value ? new Date(value).toLocaleString() : "—");
const count = (value: number) => new Intl.NumberFormat().format(value);
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "The request failed. Try again.";

export function AdminPage() {
  const [access, setAccess] = useState<Awaited<ReturnType<typeof rpc.admin.status>> | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [selected, setSelected] = useState<User | null>(null);
  const [code, setCode] = useState("");
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("claim");
    if (token) {
      setCode(token);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    rpc.admin
      .status()
      .then((value) => {
        if (alive) setAccess(value);
      })
      .catch((err) => {
        if (alive) setError(errorText(err));
      });
    return () => {
      alive = false;
    };
  }, [revision]);
  const refresh = () => {
    setError("");
    setRevision((value) => value + 1);
  };
  async function signIn() {
    await authClient.signOut();
    window.location.assign("/login?next=%2Fapp%2Fadmin");
  }

  return (
    <div className="h-full overflow-auto bg-background text-foreground">
      <header className="flex h-16 items-center justify-between border-b px-5 md:px-8">
        <div className="flex items-center gap-3">
          <Link to="/app" aria-label="Back to Cadre">
            <span className="flex items-center gap-2">
              <img src="/brand/cadre-mark.png" alt="" className="size-8" />
              <span className="text-xl font-semibold tracking-tight">Cadre</span>
            </span>
          </Link>
          <span className="border-l pl-3 text-sm text-muted-foreground">Administration</span>
        </div>
        <Link
          aria-label="Back to app"
          to="/app"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">Back to app</span>
        </Link>
      </header>
      {!access?.allowed ? (
        <main className="mx-auto max-w-md space-y-5 px-6 py-20">
          <ShieldCheck className="size-8" />
          <h1 className="text-2xl font-semibold">Admin access</h1>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {!access && !error ? (
            <p className="text-muted-foreground">Checking access…</p>
          ) : access?.canClaim ? (
            <>
              <p className="text-sm text-muted-foreground">
                Activate access for your signed-in account.
              </p>
              {!access.fresh ? (
                <Button onClick={() => void signIn()}>Sign in again</Button>
              ) : (
                <form
                  className="space-y-4"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    setBusy(true);
                    setError("");
                    try {
                      await rpc.admin.claim({
                        code: code || undefined,
                        requestId: crypto.randomUUID(),
                      });
                      setCode("");
                      refresh();
                    } catch (err) {
                      setError(errorText(err));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {access.needsClaimCode && (
                    <label htmlFor="admin-claim" className="block space-y-2 text-sm">
                      One-time claim code
                      <Input
                        id="admin-claim"
                        type="password"
                        autoComplete="off"
                        value={code}
                        onChange={(event) => setCode(event.target.value)}
                        required
                      />
                    </label>
                  )}
                  <Button type="submit" disabled={busy}>
                    {busy ? "Activating…" : "Activate admin access"}
                  </Button>
                </form>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                This account does not have administrator access.
              </p>
              <Button variant="outline" onClick={() => void signIn()}>
                Use another account
              </Button>
            </>
          )}
        </main>
      ) : (
        <div className="mx-auto flex max-w-screen-2xl flex-col md:flex-row">
          <nav
            aria-label="Admin sections"
            className="flex shrink-0 gap-1 overflow-x-auto border-b p-3 md:min-h-[calc(100vh-4rem)] md:w-48 md:flex-col md:border-r md:border-b-0 md:p-5"
          >
            {(["Overview", "Users", "Runs", "Schedules", "Audit", "Settings"] as Tab[]).map(
              (name) => (
                <button
                  key={name}
                  type="button"
                  aria-current={tab === name ? "page" : undefined}
                  onClick={() => {
                    setTab(name);
                    setSelected(null);
                    setError("");
                  }}
                  className={`rounded-lg px-3 py-2 text-left text-sm ${tab === name ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
                >
                  {name}
                </button>
              ),
            )}
          </nav>
          <main className="min-w-0 flex-1 space-y-7 p-5 md:p-9">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{tab}</h1>
              <Button variant="outline" size="sm" onClick={refresh}>
                <RefreshCw className="size-4" /> Refresh
              </Button>
            </div>
            {!access.fresh && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 text-sm">
                <span>Sign in again to make changes.</span>
                <Button size="sm" variant="outline" onClick={() => void signIn()}>
                  Sign in again
                </Button>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {tab === "Overview" && <Overview revision={revision} onError={setError} />}
            {tab === "Users" &&
              (selected ? (
                <UserDetail
                  user={selected}
                  revision={revision}
                  back={() => setSelected(null)}
                  confirm={setConfirmation}
                  onError={setError}
                />
              ) : (
                <Users revision={revision} select={setSelected} onError={setError} />
              ))}
            {tab === "Runs" && (
              <Runs revision={revision} confirm={setConfirmation} onError={setError} />
            )}
            {tab === "Schedules" && (
              <Schedules revision={revision} confirm={setConfirmation} onError={setError} />
            )}
            {tab === "Audit" && <Audit revision={revision} onError={setError} />}
            {tab === "Settings" && (
              <Settings revision={revision} confirm={setConfirmation} onError={setError} />
            )}
          </main>
        </div>
      )}
      <ConfirmAction
        action={confirmation}
        close={() => setConfirmation(null)}
        completed={refresh}
      />
    </div>
  );
}

function Overview({ revision, onError }: { revision: number; onError: (message: string) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof rpc.admin.overview>> | null>(null);
  useEffect(() => {
    let alive = true;
    rpc.admin
      .overview()
      .then((value) => {
        if (alive) setData(value);
      })
      .catch((err) => {
        if (alive) onError(errorText(err));
      });
    return () => {
      alive = false;
    };
  }, [revision, onError]);
  if (!data) return <Loading />;
  return (
    <>
      <div className="grid grid-cols-2 divide-x divide-y rounded-xl border lg:grid-cols-4">
        {[
          ["Users", data.users],
          ["Active runs", data.activeRuns],
          ["Active schedules", data.activeSchedules],
          ["Bots", data.bots],
        ].map(([label, value]) => (
          <div key={label} className="p-5">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-3 text-3xl font-medium tabular-nums">{count(Number(value))}</p>
          </div>
        ))}
      </div>
      <section className="space-y-4">
        <h2 className="font-medium">Last 7 days</h2>
        <dl className="divide-y rounded-xl border px-5">
          <Metric label="Input tokens" value={count(data.inputTokens7d)} />
          <Metric label="Output tokens" value={count(data.outputTokens7d)} />
          <Metric label="Failed runs" value={count(data.failedRuns7d)} />
        </dl>
      </section>
      <section className="space-y-4">
        <h2 className="font-medium">Account controls</h2>
        <dl className="divide-y rounded-xl border px-5">
          <Metric label="Suspended users" value={count(data.suspendedUsers)} />
          <Metric
            label="Billing provider"
            value={data.billingConfigured ? "Connected" : "Not connected"}
          />
        </dl>
      </section>
    </>
  );
}

function usePage<T>(
  revision: number,
  load: (query: string, cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>,
  onError: (message: string) => void,
) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [data, setData] = useState<{ items: T[]; nextCursor: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    const timer = setTimeout(() => {
      load(query, cursor)
        .then((value) => {
          if (alive) setData(value);
        })
        .catch((err) => {
          if (alive) onError(errorText(err));
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [revision, query, cursor, load, onError]);
  return {
    data,
    query,
    search: (value: string) => {
      setCursor(undefined);
      setQuery(value);
    },
    next: () => setCursor(data?.nextCursor ?? undefined),
    first: () => setCursor(undefined),
    cursor,
  };
}
const loadUsers = (query: string, cursor?: string) => rpc.admin.users({ query, cursor });
function Users({
  revision,
  select,
  onError,
}: {
  revision: number;
  select: (user: User) => void;
  onError: (message: string) => void;
}) {
  const page = usePage(revision, loadUsers, onError);
  return (
    <>
      <Search value={page.query} onChange={page.search} placeholder="Search users" />
      {!page.data ? (
        <Loading />
      ) : (
        <>
          <Table headers={["User", "Access", "Status", "Joined", ""]}>
            {page.data.items.map((user) => (
              <tr key={user.id}>
                <Cell>
                  <p className="font-medium">{user.name}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </Cell>
                <Cell>{user.role === "admin" ? "Admin" : "Member"}</Cell>
                <Cell>{user.suspendedAt ? "Suspended" : "Active"}</Cell>
                <Cell>{date(user.createdAt)}</Cell>
                <Cell>
                  <Button size="sm" variant="outline" onClick={() => select(user)}>
                    Manage<span className="sr-only"> {user.email}</span>
                  </Button>
                </Cell>
              </tr>
            ))}
          </Table>
          {!page.data.items.length && <Empty>No users found.</Empty>}
          <Pagination page={page} />
        </>
      )}
    </>
  );
}

function UserDetail({
  user,
  revision,
  back,
  confirm,
  onError,
}: {
  user: User;
  revision: number;
  back: () => void;
  confirm: (action: Confirmation) => void;
  onError: (message: string) => void;
}) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof rpc.admin.user>> | null>(null);
  const [billing, setBilling] = useState<Awaited<ReturnType<typeof rpc.admin.billing>> | null>(
    null,
  );
  const [customerId, setCustomerId] = useState("");
  useEffect(() => {
    let alive = true;
    setBilling(null);
    rpc.admin
      .user({ userId: user.id })
      .then((value) => {
        if (alive) setDetail(value);
      })
      .catch((err) => {
        if (alive) onError(errorText(err));
      });
    rpc.admin
      .billing({ userId: user.id })
      .then((value) => {
        if (alive) setBilling(value);
      })
      .catch((err) => {
        if (alive) onError(errorText(err));
      });
    return () => {
      alive = false;
    };
  }, [user.id, revision, onError]);
  if (!detail) return <Loading />;
  function action(
    label: string,
    action:
      | "suspend"
      | "reactivate"
      | "revoke_sessions"
      | "promote"
      | "demote"
      | "pause_schedules"
      | "stop_runs",
    explanation: string,
  ) {
    confirm({
      title: label,
      detail: `${user.email}. ${explanation}`,
      run: (reason, requestId) =>
        rpc.admin.userAction({ userId: user.id, action, reason, requestId }),
    });
  }
  return (
    <div className="space-y-7">
      <Button variant="ghost" size="sm" onClick={back}>
        <ArrowLeft className="size-4" /> All users
      </Button>
      <div>
        <h2 className="text-xl font-semibold">{detail.user.name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{detail.user.email}</p>
      </div>
      <dl className="divide-y rounded-xl border px-5">
        <Metric label="Access" value={detail.user.role === "admin" ? "Admin" : "Member"} />
        <Metric label="Status" value={detail.user.suspendedAt ? "Suspended" : "Active"} />
        <Metric label="Email verified" value={detail.user.emailVerified ? "Yes" : "No"} />
        <Metric label="Bots" value={count(detail.bots)} />
        <Metric label="Lifetime tokens" value={count(detail.inputTokens + detail.outputTokens)} />
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() =>
            action(
              detail.user.suspendedAt ? "Reactivate user" : "Suspend user",
              detail.user.suspendedAt ? "reactivate" : "suspend",
              detail.user.suspendedAt
                ? "Schedules remain paused until resumed."
                : "Revoke sessions, stop runs, and pause schedules.",
            )
          }
        >
          {detail.user.suspendedAt ? "Reactivate user" : "Suspend user"}
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            action(
              "Revoke sessions",
              "revoke_sessions",
              "The user must sign in again on every device.",
            )
          }
        >
          Revoke sessions
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            action(
              "Stop all runs",
              "stop_runs",
              "Stop active and queued work. External requests already sent may finish.",
            )
          }
        >
          Stop all runs
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            action(
              "Pause all schedules",
              "pause_schedules",
              "Recurring work will remain paused until resumed.",
            )
          }
        >
          Pause all schedules
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            action(
              detail.user.role === "admin" ? "Remove admin access" : "Grant admin access",
              detail.user.role === "admin" ? "demote" : "promote",
              "This changes access to platform administration.",
            )
          }
        >
          {detail.user.role === "admin" ? "Remove admin access" : "Grant admin access"}
        </Button>
      </div>
      <section className="space-y-3">
        <h3 className="font-medium">Active sessions</h3>
        <Table headers={["Signed in", "Expires"]}>
          {detail.sessions.map((session) => (
            <tr key={session.id}>
              <Cell>{date(session.createdAt)}</Cell>
              <Cell>{date(session.expiresAt)}</Cell>
            </tr>
          ))}
        </Table>
        {!detail.sessions.length && <Empty>No active sessions.</Empty>}
      </section>
      <section className="space-y-3">
        <h3 className="font-medium">Connections</h3>
        <Table headers={["App", "Status"]}>
          {detail.connections.map((connection) => (
            <tr key={connection.id}>
              <Cell>{connection.displayName}</Cell>
              <Cell>{connection.status}</Cell>
            </tr>
          ))}
        </Table>
        {!detail.connections.length && <Empty>No connections.</Empty>}
      </section>
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Billing</h3>
          {billing?.snapshot && (
            <a
              href={billing.snapshot.dashboardUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm underline underline-offset-4"
            >
              Open Stripe <ArrowUpRight className="size-4" />
            </a>
          )}
        </div>
        {!billing ? (
          <Loading />
        ) : !billing.configured ? (
          <Empty>Billing is not connected.</Empty>
        ) : (
          <>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                confirm({
                  title: "Link billing customer",
                  detail: `${user.email}. The customer email must match this user.`,
                  run: (reason, requestId) =>
                    rpc.admin.linkBilling({ userId: user.id, customerId, reason, requestId }),
                });
              }}
            >
              <Input
                aria-label="Stripe customer ID"
                placeholder={detail.billingCustomerId ?? "Stripe customer ID"}
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
                pattern="cus_[A-Za-z0-9]+"
                required
                className="max-w-xs"
              />
              <Button variant="outline" type="submit">
                Link customer
              </Button>
            </form>
            {billing.snapshot ? (
              <>
                <Table headers={["Subscription", "Status", "Renewal", ""]}>
                  {billing.snapshot.subscriptions.map((subscription) => (
                    <tr key={subscription.id}>
                      <Cell>{subscription.id}</Cell>
                      <Cell>{subscription.status}</Cell>
                      <Cell>
                        {subscription.cancelAtPeriodEnd ? "Ends this period" : "Automatic"}
                      </Cell>
                      <Cell>
                        {["active", "trialing", "past_due"].includes(subscription.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              confirm({
                                title: subscription.cancelAtPeriodEnd
                                  ? "Keep subscription renewing"
                                  : "Cancel at period end",
                                detail: `${user.email}. ${subscription.id}`,
                                run: (reason, requestId) =>
                                  rpc.admin.updateSubscription({
                                    userId: user.id,
                                    subscriptionId: subscription.id,
                                    cancelAtPeriodEnd: !subscription.cancelAtPeriodEnd,
                                    reason,
                                    requestId,
                                  }),
                              })
                            }
                          >
                            {subscription.cancelAtPeriodEnd ? "Keep renewing" : "Cancel renewal"}
                          </Button>
                        )}
                      </Cell>
                    </tr>
                  ))}
                </Table>
                <h4 className="text-sm font-medium">Recent invoices</h4>
                <Table headers={["Invoice", "Status", "Due", "Paid"]}>
                  {billing.snapshot.invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <Cell>{invoice.number ?? invoice.id}</Cell>
                      <Cell>{invoice.status ?? "—"}</Cell>
                      <Cell>
                        {money(invoice.amountDue, invoice.currency, invoice.minorUnitDigits)}
                      </Cell>
                      <Cell>
                        {money(invoice.amountPaid, invoice.currency, invoice.minorUnitDigits)}
                      </Cell>
                    </tr>
                  ))}
                </Table>
              </>
            ) : (
              <Empty>No billing customer linked.</Empty>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Runs({
  revision,
  confirm,
  onError,
}: {
  revision: number;
  confirm: (action: Confirmation) => void;
  onError: (message: string) => void;
}) {
  const [status, setStatus] = useState<"active" | "failed" | "all">("active");
  const loadRuns = useCallback(
    (query: string, cursor?: string) => rpc.admin.runs({ query, cursor, status }),
    [status],
  );
  const page = usePage(revision, loadRuns, onError);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Search value={page.query} onChange={page.search} placeholder="Search runs" />
        {(["active", "failed", "all"] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={status === value ? "default" : "outline"}
            onClick={() => {
              page.first();
              setStatus(value);
            }}
          >
            {value === "active" ? "Active" : value === "failed" ? "Failed" : "All runs"}
          </Button>
        ))}
      </div>
      {!page.data ? (
        <Loading />
      ) : (
        <>
          <Table headers={["Bot", "Status", "Started by", "Tool calls", ""]}>
            {page.data.items.map((run) => (
              <tr key={run.id}>
                <Cell>
                  <p className="font-medium">{run.botName}</p>
                  <p className="max-w-48 truncate text-xs text-muted-foreground" title={run.id}>
                    {run.id}
                  </p>
                </Cell>
                <Cell>{run.status}</Cell>
                <Cell>{run.trigger}</Cell>
                <Cell>{count(run.toolCalls)}</Cell>
                <Cell>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      ![
                        "queued",
                        "leased",
                        "running",
                        "waiting_input",
                        "waiting_takeover",
                      ].includes(run.status)
                    }
                    onClick={() =>
                      confirm({
                        title: "Stop run",
                        detail: `${run.botName}. External requests already sent may finish.`,
                        run: (reason, requestId) =>
                          rpc.admin.stopRun({ runId: run.id, reason, requestId }),
                      })
                    }
                  >
                    Stop<span className="sr-only"> {run.botName}</span>
                  </Button>
                </Cell>
              </tr>
            ))}
          </Table>
          {!page.data.items.length && <Empty>No matching runs.</Empty>}
          <Pagination page={page} />
        </>
      )}
    </>
  );
}
const loadSchedules = (query: string, cursor?: string) => rpc.admin.schedules({ query, cursor });
function Schedules({
  revision,
  confirm,
  onError,
}: {
  revision: number;
  confirm: (action: Confirmation) => void;
  onError: (message: string) => void;
}) {
  const page = usePage(revision, loadSchedules, onError);
  return (
    <>
      <Search value={page.query} onChange={page.search} placeholder="Search schedules" />
      {!page.data ? (
        <Loading />
      ) : (
        <>
          <Table headers={["Schedule", "Status", "Next run", ""]}>
            {page.data.items.map((routine) => (
              <tr key={routine.id}>
                <Cell>
                  <p className="font-medium">{routine.name}</p>
                  <p className="text-xs text-muted-foreground">{routine.timezone}</p>
                </Cell>
                <Cell>{routine.active ? "Active" : "Paused"}</Cell>
                <Cell>{date(routine.nextRunAt)}</Cell>
                <Cell>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      confirm({
                        title: routine.active ? "Pause schedule" : "Resume schedule",
                        detail: routine.name,
                        run: (reason, requestId) =>
                          rpc.admin.scheduleAction({
                            routineId: routine.id,
                            active: !routine.active,
                            reason,
                            requestId,
                          }),
                      })
                    }
                  >
                    {routine.active ? "Pause" : "Resume"}
                    <span className="sr-only"> {routine.name}</span>
                  </Button>
                </Cell>
              </tr>
            ))}
          </Table>
          {!page.data.items.length && <Empty>No schedules.</Empty>}
          <Pagination page={page} />
        </>
      )}
    </>
  );
}
const loadAudit = (query: string, cursor?: string) => rpc.admin.audit({ query, cursor });
function Audit({ revision, onError }: { revision: number; onError: (message: string) => void }) {
  const page = usePage(revision, loadAudit, onError);
  return (
    <>
      <Search value={page.query} onChange={page.search} placeholder="Search audit history" />
      {!page.data ? (
        <Loading />
      ) : (
        <>
          <Table headers={["Time", "Action", "Administrator", "Reason", "Result"]}>
            {page.data.items.map((entry) => (
              <tr key={entry.id}>
                <Cell>{date(entry.createdAt)}</Cell>
                <Cell>
                  {entry.action}
                  <p
                    className="max-w-40 truncate text-xs text-muted-foreground"
                    title={entry.targetId ?? undefined}
                  >
                    {entry.targetId}
                  </p>
                </Cell>
                <Cell>
                  <span className="block max-w-40 truncate" title={entry.actorId}>
                    {entry.actorId}
                  </span>
                </Cell>
                <Cell>
                  <span className="block max-w-sm whitespace-normal">{entry.reason}</span>
                </Cell>
                <Cell>{entry.status}</Cell>
              </tr>
            ))}
          </Table>
          {!page.data.items.length && <Empty>No administrative actions.</Empty>}
          <Pagination page={page} />
        </>
      )}
    </>
  );
}

function Settings({
  revision,
  confirm,
  onError,
}: {
  revision: number;
  confirm: (action: Confirmation) => void;
  onError: (message: string) => void;
}) {
  const [enabled, setEnabled] = useState(true);
  const [allowlist, setAllowlist] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    rpc.admin
      .settings()
      .then((value) => {
        if (alive) {
          setEnabled(value.signupsEnabled);
          setAllowlist(value.signupAllowlist.join("\n"));
          setLoaded(true);
        }
      })
      .catch((err) => {
        if (alive) onError(errorText(err));
      });
    return () => {
      alive = false;
    };
  }, [revision, onError]);
  if (!loaded) return <Loading />;
  return (
    <form
      className="max-w-xl space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        confirm({
          title: "Update signup policy",
          detail: enabled ? "Apply the signup allowlist." : "Close registration for new accounts.",
          run: (reason, requestId) =>
            rpc.admin.updateSettings({
              signupsEnabled: enabled,
              signupAllowlist: allowlist
                .split(/[\n,]/)
                .map((value) => value.trim())
                .filter(Boolean),
              reason,
              requestId,
            }),
        });
      }}
    >
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />{" "}
        Allow new registrations
      </label>
      <label htmlFor="admin-allowlist" className="block space-y-2 text-sm">
        <span>Allowed emails or @domains</span>
        <Textarea
          rows={6}
          id="admin-allowlist"
          value={allowlist}
          onChange={(event) => setAllowlist(event.target.value)}
        />
        <span className="block text-xs text-muted-foreground">
          One per line. Leave empty to allow any email.
        </span>
      </label>
      <Button type="submit">Save signup policy</Button>
    </form>
  );
}

function ConfirmAction({
  action,
  close,
  completed,
}: {
  action: Confirmation | null;
  close: () => void;
  completed: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState("");
  useEffect(() => {
    setReason("");
    setError("");
    setRequestId(crypto.randomUUID());
  }, [action]);
  return (
    <Dialog
      open={Boolean(action)}
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogTitle>{action?.title ?? "Confirm action"}</DialogTitle>
        <DialogDescription>{action?.detail}</DialogDescription>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!action) return;
            setBusy(true);
            setError("");
            try {
              await action.run(reason, requestId);
              close();
              completed();
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="admin-reason" className="block space-y-2 text-sm">
            Reason
            <Textarea
              id="admin-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              minLength={3}
              maxLength={500}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || reason.trim().length < 3}>
              {busy ? "Saving…" : "Confirm"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            {headers.map((header, index) => (
              <th
                key={`${header}-${index}`}
                scope="col"
                className="whitespace-nowrap px-4 py-3 font-medium"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}
function Cell({ children }: { children: ReactNode }) {
  return <td className="whitespace-nowrap px-4 py-3 align-middle">{children}</td>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
function Loading() {
  return (
    <p role="status" className="py-8 text-sm text-muted-foreground">
      Loading…
    </p>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="py-5 text-sm text-muted-foreground">{children}</p>;
}
function Search({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <Input
      type="search"
      aria-label={placeholder}
      placeholder={placeholder}
      value={value}
      maxLength={200}
      onChange={(event) => onChange(event.target.value)}
      className="max-w-sm"
    />
  );
}
function Pagination({
  page,
}: {
  page: {
    data: { nextCursor: string | null } | null;
    cursor?: string;
    first: () => void;
    next: () => void;
  };
}) {
  return page.cursor || page.data?.nextCursor ? (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="outline" disabled={!page.cursor} onClick={page.first}>
        First page
      </Button>
      <Button size="sm" variant="outline" disabled={!page.data?.nextCursor} onClick={page.next}>
        Next page
      </Button>
    </div>
  ) : null;
}
function money(amount: number, currency: string, minorUnitDigits: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    amount / 10 ** minorUnitDigits,
  );
}
