# Connected context network

## Requested outcome
A Cadre workspace binds to one Company OS company, one Operate workspace, and one Stored organization. Users can create multiple Stored organizations with teams and many agents. Operate records recurring task occurrences and shows actual completion on a calendar. Cadre agents plan projects and tasks in Operate, retain personal memories in Stored, and recall authorized organization context. Company OS changes synchronize into Stored.

## Ownership and boundaries
- Company OS owns business source records and revisions.
- Operate owns projects, tasks, schedules, completion and approval history.
- Stored owns memory retention, retrieval, provenance and organization membership. Agent memory is a protected scope, not merely a source label.
- Cadre owns agent execution and workspace bindings. OAuth credentials remain encrypted server-side; state and PKCE bind callbacks to the account and workspace.
- Preserve current organizations, memories and memberships. Additive migration only; no reassigning existing records based on display names.
- Sync typed source records with stable external IDs, revisions, provenance and deletion tombstones. Retry through durable jobs/outboxes; replay must be idempotent. Do not promote imported observations to human-approved permanent knowledge automatically. Never replicate credentials or authentication material.
- No circular writes: imports keep original source identity and do not emit a fresh source update back to their origin. Disconnect stops future sync and retrieval with that grant; retention/deletion is explicit.

## Linear journeys
1. Workspace connections: choose product, sign in, select or create authorized tenant, review scope, return to original Cadre workspace, verify identity and one read, show mapped tenant and sync status.
2. Stored: organization switcher includes New organization even for one-org accounts; name, create, invite team, add agents progressively. Existing onboarding remains resumable.
3. Operate: create recurring task, choose cadence, open calendar, inspect occurrence and complete its actual task. Reopened tasks stop displaying done. Agents use the same core and authorization checks.
4. Memory: recall before write, choose agent or shared scope, preserve provenance and revisions, retrieve to verify. Shared promotion is intentional.

## Work ledger
- [x] Locate current repos and inspect existing OAuth/membership/schedule foundations.
- [ ] Operate occurrence ledger, human/agent history API, calendar and daily workflow tests.
- [ ] Stored organization creation/switching/team journey and additive agent-private memory boundary.
- [x] Cadre native Operate/Stored/Scalar OAuth bindings, runtime context/tools and memory adapter (see providers.md for what each provider still needs).
- [x] Operate work: a member picks one bot for the tasks assigned to their Operate agent. The worker loop (`packages/adapters/src/operate-work.ts`) asks `next_task`, loads and acknowledges `get_task_context`, claims, opens an Operate run, and starts a Cadre run with the task as its prompt; when the run ends it finishes the Operate run and completes the task with the bot's summary, or releases it. The prompt points the bot at Company OS `agent_brief` and Stored `get_context_pack` when those are connected. One bot per member, because one Operate grant is one Operate agent.
- [ ] Company OS to Stored initial snapshot and durable incremental change sync.
- [ ] Cross-tenant, revocation, duplicate delivery, replay/deletion and migration tests.
- [ ] Design OS + Component OS + Details UI implementation and rendered review.
- [ ] Review, merge, deploy and verify each production boundary.

## Current implementation scope
Work is in progress. No new integration is shipped or accepted. Existing OAuth in Operate and Stored is reusable; Stored already has multi-membership schema but onboarding blocks creation for an existing member and the one-org switcher is static. Operate already schedules daily tasks but did not retain a schedule-to-occurrence link.

## Connection settings visual plan (revision 1, 2026-09-15)

Resolved for implementation by self-review. Within existing Settings, Company OS is followed by Operate and Stored. Each has one heading, selected external workspace/organization name, and Connect or Disconnect. Priority: target identity, connection state, action. 24px section spacing, inherited charcoal tokens/type, 44px round controls, no new cards or icons. Unmatched native button role; no directory component is replaced. Loading/error copy stays at the action and never shows success before the server confirms it. Consent occurs on the provider's own screen, then returns to Cadre. Workspace selection is fixed while signing in; a different target requires a different Cadre workspace to protect existing context. Reconnect uses the preserved binding. Narrow layouts stack actions and names, long names wrap, keyboard focus remains visible. No motion/artwork needed. Rendered Design OS and Details acceptance pending.

## Verification checkpoint
Local Postgres: five OAuth/outbox tests pass, including one-time PKCE callbacks, workspace isolation, serialized refresh, encrypted retry deduplication and revocation. The additive migrations applied to a fresh empty test database. Browser fixtures at 375px and 1440px pass and were visually inspected: connected target names wrap, the actions remain round, and the charcoal settings surface scrolls without horizontal clipping. These browser checks cover rendering, not live provider consent. API, worker, adapter and web typechecks passed. Production acceptance remains pending.
