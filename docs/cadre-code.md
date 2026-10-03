# Cadre Code

Cadre Code is the coding agent built into the Burst desktop app. The agent loop runs on the
user's machine, in the project folder. Its model calls go to the Cadre server, so it uses the
models the user already connected in Cadre and no provider credential reaches the device.

Bots in Cadre can hand coding work to it (section 3).

## 1. Model gateway

Requests carry the account's session (`Authorization: Bearer <token>`) and `Origin: cadre://`,
like every other Burst request. Untrusted origins get `403`. Optional `x-cadre-space-id` picks the
space that usage is attributed to (default: the user's default space).

### `GET /api/code/models`

`200 {models: CodeModel[]}` for the models the user can call: every model of each provider the
user connected (API key, subscription sign-in, or OpenAI-compatible endpoint), plus the
deployment default provider when the deployment has a key.

```json
{ "provider": "anthropic", "providerName": "Anthropic", "id": "claude-sonnet-5", "name": "Claude Sonnet 5",
  "contextWindow": 200000, "maxTokens": 64000, "reasoning": true, "input": ["text", "image"],
  "thinkingLevels": ["off", "low", "medium", "high"] }
```

For an OpenAI-compatible endpoint the listed ids are the ones saved with the connection. Any id
the server accepts can be requested.

### `POST /api/code/model-stream`

Body: `{provider, model, context, options?}`. `context` is the agent library's `Context`
(`{systemPrompt?, messages, tools?}`) as JSON. `options` is the stream options as JSON. Only
generation fields are honored: `temperature`, `maxTokens`, `reasoning`
(`minimal|low|medium|high|xhigh|max`), `toolChoice` (`auto|none`), `sessionId`, `cacheRetention`.
Credentials, headers, base URLs and hooks are ignored. Bodies up to 32 MB.

Response `200 text/event-stream`: one `data: <AssistantMessageEvent JSON>` frame per event
(`start`, `text_delta`, `thinking_delta`, `toolcall_end`, ..., ending with `done` or `error`),
then `data: [DONE]`. A provider failure after the stream started arrives as an `error` event, not
a status code. Closing the connection aborts the upstream model call.

Errors before the stream starts are JSON `{error}`: `401` not signed in, `400` bad body, `404`
provider not connected or unknown model, `409` the connection needs attention (for example a
subscription sign-in that must be repeated), `413` body too large, `429` rate limited
(240 requests per minute and 8 concurrent streams per user), `502` upstream failure.

The server resolves credentials the same way an agent run does: the user's newest connection for
the provider, OAuth tokens refreshed and persisted under the same lock, OpenAI-compatible base
URLs checked against the same network rules. Secret values are removed from every frame.

Usage is recorded in `usage_records` for the user and space, like agent runs. Rows have no bot or
run. The table has no source column yet.

### Desktop client

A provider that implements the agent library's stream function by `POST`ing
`${server}/api/code/model-stream` and parsing the SSE frames back into events, using the bearer
token Burst already holds, is enough. Models come from `GET /api/code/models`.

## 2. Device capability

Devices that can run Cadre Code register `capabilities.code: true`
(`DeviceCapabilities.code`). `permissions.code: false` turns it off.

## 3. Bot delegation (`op: "code"`)

When the user has an online device with `capabilities.code`, bots get these tools. The device
used is the bot's assigned device when it can code, else the user's most recently seen online
device that can.

| Tool | Args | Device request |
|---|---|---|
| `code_start` | `project` (path or repo name), `task`, `team?: {workers: 1..8}` | `{op:"code", action:"start", project, task, bot?: {id, name}, team?}` |
| `code_status` | `sessionId`, `waitSeconds?` (0..45) | `{op:"code", action:"status", sessionId, waitMs?}` |
| `code_message` | `sessionId`, `message` | `{op:"code", action:"message", sessionId, message}` |
| `code_diff` | `sessionId` | `{op:"code", action:"diff", sessionId}` |
| `code_abort` | `sessionId` | `{op:"code", action:"abort", sessionId}` |

Device results (all JSON objects; failures throw with a message, or return `{error}`):

* `start` -> `{sessionId, project, state}`. Returns as soon as the session exists. The work
  continues on the device.
* `status` -> `{sessionId, state: "running" | "idle" | "failed" | "aborted", lastAssistantText?, changedFiles?: [{path, status?, additions?, deletions?}], error?: {message}}`.
  With `waitMs`, the device holds the answer until the state changes or the time passes.
  `idle` means the agent finished its turn and accepts a follow-up.
* `message` -> `{sessionId, state}`. Steers a running session or starts a new turn on an idle one.
* `diff` -> `{sessionId, diff: string (unified), files?: [...]}`.
* `abort` -> `{sessionId, state: "aborted"}`.

`project` is resolved on the device. It must be a folder or a repository the user opened in Cadre
Code; anything else fails with `Unknown project`. The device may map several `start` calls on one
project to separate sessions (one worktree or one set of owned files each). Several bots can each
start a session on the same project, which makes a team. The tool descriptions tell bots to split
work and keep one session each.

`code_start` and `code_message` ask the user for approval like other consequential tools. The
user can always allow them for a bot. `code_status` and `code_diff` are read-only. There is no
device-initiated wakeup: for long tasks a bot polls `code_status` (with `waitSeconds`) or schedules
a follow-up with `schedule_create`.
