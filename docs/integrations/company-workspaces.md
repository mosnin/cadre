# Company OS workspaces

Cadre accounts keep their normal login. Settings → Company OS opens a connection flow: create or choose a workspace, then choose a business and permissions on Company OS's consent screen. The sidebar workspace menu also offers New workspace and Connect Company OS.

A workspace has one permanent company binding. Connecting another business requires another workspace, including after disconnect. This preserves the meaning of existing chats, files and memory. Each member authorizes their own company grant; another member's credentials are never borrowed. Company OS verifies the current membership and grant permissions. The runtime attaches the workspace connector to new and existing bots automatically and checks authorization before discovery and calls.

The sidebar displays the selected workspace's conversations. Storage, memory, skills, computers and agent operations continue to use the existing workspace scope. Generic built-in skills contain instructions, never company data. Agents read `company-context` before retrieval and `company-deliverables` before saving work. Access includes the context allowed by the grant; restricted or missing records must be reported explicitly.

## Deployment

1. Apply the database migrations before starting the API and worker.
2. Register a confidential Company OS OAuth client with `identity_access: true`, `token_endpoint_auth_method: "client_secret_post"`, and authorization-code/refresh-token grants, using the exact redirect `https://<cadre-origin>/api/v1/company-workspaces/callback`. Use the canonical app origin, including any `www` prefix. Keep any existing login redirect registered separately if hosted Company OS login is also used.
3. Set `COMPANY_OS_OAUTH_CLIENT_ID`, `COMPANY_OS_OAUTH_CLIENT_SECRET`, and `COMPANY_OS_OAUTH_ORIGIN` on both the API and worker. Set `WEB_ORIGIN` to the canonical app origin. Keep the same database and encryption key on both processes.
4. Keep `AUTH_PROVIDER` unchanged. Workspace connections are independent of the optional Company OS login provider.
5. Test the live account → Settings → Company OS → consent → callback → agent context read journey. Confirm two company workspaces, reconnect, provider revocation, and disconnect. Local protocol tests do not establish hosted consent or deployment readiness.

The OAuth client requests context read, context write and branch creation. Company OS consent determines the actual grant. Tokens are encrypted server-side, refresh is serialized across processes, and callback state is single-use and bound to the initiating Cadre session and workspace. Cadre removes local access on disconnect and attempts upstream revocation; if the provider is unavailable, the user can revoke the remaining grant in Company OS. The immutable company binding remains.

Web and Electron use the same Settings flow. Native mobile can use the web app to connect a workspace; it retains the existing native workspace navigation rather than embedding the browser OAuth flow.

## Redis / Upstash assessment

The Redis agent-skills package provides coding instructions, not a runtime cache or agent speed improvement by itself. Upstash could host an optional cache of repeated context reads after retrieval timing and hit rates show a useful bottleneck. Keep Company OS authoritative and keep durable tasks in the existing database/queue.

A future cache must key by workspace, account/grant, company, source revision and query. Revalidate permissions before serving private cached content, invalidate on disconnect/revocation, set bounded TTLs, and continue through the source if Redis is unavailable. Measure p50/p95 retrieval and total task latency, hit rate, stale reads and cost before claiming an improvement. Do not cache side effects or substitute semantic similarity for current company facts.

References: https://github.com/redis/agent-skills and https://upstash.com/docs/redis/features/eviction . No Redis infrastructure is introduced by this change.
