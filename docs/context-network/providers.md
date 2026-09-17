# Workspace provider contract

Cadre connects one workspace to one tenant on each provider through OAuth 2.1 (authorization code, PKCE S256, RFC 8707 `resource`). Each member authorizes their own grant; the tenant binding belongs to the Cadre workspace and stays after a disconnect. A different tenant needs a different Cadre workspace.

| Provider | Origin | Registration | Scope | Resource | Tenant from userinfo |
| --- | --- | --- | --- | --- | --- |
| Operate | `https://operate.to` | dynamic, `/oauth/register` | `openid email operate:read operate:write` | `/api/mcp` (MCP `/api/mcp`) | `org_id`, `org_name` |
| Stored | `https://www.stored.to` | seeded client id (`STORED_OAUTH_CLIENT_ID`) | `openid profile org:read memory:read memory:write` | `/api` (MCP `/mcp/<org_id>`, private agent memory `/mcp/cadre/<workspace>/<bot>`) | `org_id`, `org_name` |
| Scalar | `https://www.tryscalar.xyz` | dynamic, `/oauth/register` | `openid profile crm:read crm:write mcp` | `/api/mcp/mcp` (MCP `/api/mcp/mcp`) | `workspace.id`, `workspace.name` (or `org_id`) |
| Company OS | configured | seeded confidential client | capabilities | `/api/mcp` | `company.id`, `company.name`, `company.slug` |

`packages/adapters/src/workspace-integrations.ts` holds the table; origins and the Stored client id can be overridden per deployment through the environment. Dynamically registered client ids are stored per provider and origin (`workspace_integration_clients`) and reused until the callback URL changes.

## What each provider still needs

Verified against the provider repositories on 2026-09-16.

- Operate: complete. Consent binds an agent, and workspace agents are only offered to the workspace owner; a member who is not the owner can only bind a personal agent, which Cadre refuses because it carries no workspace.
- Stored: seed the OAuth client once per deployment with `pnpm -C web exec tsx scripts/oauth-register-client.ts --client-id stored-cadre --name Cadre --client-uri https://<cadre-web> --redirect-uri https://<cadre-web>/api/v1/workspace-integrations/stored/callback --scope "openid profile org:read memory:read memory:write"`. The organization MCP endpoint, the Cadre memory endpoint (`POST /api/cadre/v1/memory` with `action: save | recall | purgeHistory`, `workspace`, `botId`), the per-agent endpoint `/mcp/cadre/<workspaceId>/<botId>` and the workspace link table are implemented in the agentwiki repository (branch `claude/cadre-workspace-memory`).
- Scalar: nothing blocking. `userinfo` returns the tenant as `workspace`, which Cadre normalizes. A workspace name column would improve the displayed name, and accepting OAuth tokens on the REST API would allow non-MCP access.
- Company OS: complete.
