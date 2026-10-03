# Burst device computers

Cadre bots used to get their computer from Fly or Modal VMs. With device computers, a bot's
computer is a **Burst device**: the Burst Mac app, or the `burst-device` daemon on Linux,
running on a machine the user owns. The bot drives that machine's own browser and desktop.
Cadre's agent loop stays on the server. The device runs the actions locally and sends results
back.

* Fast: actions run on the local machine with no VM boot. They target accessibility elements
  (taken from open-codex-computer-use, MIT) instead of guessing pixels.
* Consistent: one protocol and one set of semantics on macOS and Linux. They are the **same ops**
  Cadre's Linux VM agent (`infra/modal/computer_rpc.py`) already serves, so every existing Cadre
  computer tool works unchanged.
* In-app browser: each device has a built-in agent browser (WKWebView in Burst on macOS, Chromium
  over CDP on Linux). It answers Cadre's structured `browser` requests (snapshot, click, fill, and
  so on) natively.

```
 Cadre worker / API (any process)                         User's machine
 ┌──────────────────────────────┐   SSE  requests   ┌──────────────────────────────┐
 │ DeviceSandboxProvider         │ ────────────────▶ │ Burst.app / burst-device     │
 │  (extends LinuxDesktopSandbox)│                   │  DeviceLink (relay client)   │
 │  rpc() → DeviceRelay.call()   │ ◀──────────────── │  DeviceComputer dispatcher   │
 └──────────────────────────────┘   POST responses   │   ├ exec / files (workspace) │
          ▲  Postgres table + NOTIFY (cross-process)  │   ├ screen + input (mac/linux)│
          └───────────────────────────────────────── │   ├ accessibility (ax tools) │
                                                      │   └ agent browser            │
                                                      └──────────────────────────────┘
```

## 1. Transport

All endpoints sit on the Cadre server origin. Requests carry the account's Better Auth session
(`Authorization: Bearer <token>`) and `Origin: cadre://` like every other Burst request. A device
belongs to exactly one user. Only that user's bots in that user's spaces may use it.

| Method | Path | Body / response |
|---|---|---|
| `POST` | `/api/devices/register` | `{deviceId, name, platform: "macos" \| "linux", version, capabilities: DeviceCapabilities}` → `{deviceId, name, createdAt}`. `deviceId` is a client-generated UUID that stays stable per machine and per account. Re-registering updates name, version and capabilities. |
| `GET` | `/api/devices/:deviceId/requests` | `text/event-stream`. Each request is `event: request` + `data: {"id": string, "request": DeviceRequest, "timeoutMs": number}`. A comment `: keepalive` is sent every 15 s. While the stream is open the device is **online**. A second stream for the same device replaces the first, and the server closes the old one with `event: replaced`. |
| `POST` | `/api/devices/:deviceId/responses` | `{id, ok: true, result: any}` or `{id, ok: false, error: {name?: string, message: string}}` → `204`. Bodies up to 32 MB (screenshots and file batches). |
| `POST` | `/api/devices/:deviceId/heartbeat` | `{}` → `{ok: true}`. Optional. Streams already count as heartbeats. |
| `DELETE` | `/api/devices/:deviceId` | Unregisters the device and fails pending requests. |

oRPC procedures for UI (`devices/*`):
* `list` → `Device[]` (`{id, name, platform, version, online, lastSeenAt, capabilities}`)
* `rename({deviceId, name})`
* `remove({deviceId})`
* `assign({botId, deviceId | null})`: assigning a device sets the bot's computer to that device.
  `null` returns the bot to the deployment's default provider.

Cross-process delivery: the process that holds the device's SSE stream is often not the process
running the bot (a Graphile worker). The server keeps a `DeviceRpc` row per request. The caller
inserts the row and sends `pg_notify('cadre_device', {deviceId, id})`. The process holding that
device's stream pushes the request. The device's response updates the row and sends
`pg_notify('cadre_device', {resultId})`, which wakes the caller. If a notification is lost, each
side polls every 1 s. Payloads never go through NOTIFY (8 KB limit), only ids do. Without
Postgres (single-process dev) an in-memory relay is used.

Timeouts: the caller's `timeoutMs` (default 30 s, `exec` uses its own timeout + 15 s). If the device
is offline when a request is made, the call fails fast with `SandboxNotFoundError("Device is
offline")` so Cadre's normal "computer stopped" handling applies.

## 2. DeviceCapabilities

```json
{ "exec": true, "files": true, "screen": true, "input": true,
  "accessibility": true, "browser": true, "multiscreen": false,
  "permissions": { "accessibility": true, "screenRecording": true } }
```

On macOS, `screen`, `input` and `accessibility` depend on TCC grants (Screen Recording,
Accessibility). The app prompts for them and reports the current state. On Linux they depend on
an X11 or Wayland session (`DISPLAY` / `WAYLAND_DISPLAY`) and the tools below.

## 3. Requests (`DeviceRequest`)

Every request has `op`. **The ops, field names and result shapes match
`infra/modal/computer_rpc.py` in Cadre exactly.** Error results use the same messages where
Cadre's code matches on them (`Control lease expired`, `Unsupported operation`, ...).

| op | Fields | Result |
|---|---|---|
| `exec` | `argv: string[]`, `cwd?`, `env?`, `stdin?`, `timeoutMs`, `operationId` | `{stdout, stderr, code}` (each stream capped at 1 MB, truncated with a marker) |
| `cancel` | `operationId` | `{ok: true}`. Kills the process group of a running `exec`. |
| `observe` | `screenKey?` | `{image: base64 PNG, mimeType: "image/png", width, height}` of the main display, scaled to ≤1440 px on the longest side. `width`/`height` are the **image** coordinates that actions use. |
| `actions` | `actions: ComputerAction[]`, `observe?`, `settleMs?` | `{completed, observation?}` |
| `input` | `actions`, `leaseId`, `screenKey?` | Same as `actions`. A human taking control from the Cadre viewer. Rejected unless the lease matches the active screen lease. |
| `sharedInput` | `actions`, `screenKey?` | Same as `actions` |
| `screen` | `screenKey?`, `leaseId?`, `controlToken?`, `interactive?` | `{ok: true}` (records the lease) |
| `resolveScreen` | `screenKey?`, `screenLease?`, `sharedInput?` | `{key, index: 0, sharedUntil?}` |
| `releaseScreen` | `screenKey?`, `screenLease?` | `{ok: true}` |
| `list` | `path` | `ComputerFileEntry[]` `{path, kind: "file"\|"dir", size, executable}` |
| `read` | `path`, `maxBytes?` | `{content: base64}` (≤ 32 MB) |
| `write` | `path`, `content` (base64), `executable?` | `{ok: true}` (atomic temp-file + rename) |
| `readBatch` | `paths` (≤ 8) | `[{content}]` |
| `writeBatch` | `files` (≤ 8) | `{ok: true}` |
| `manifest` | none | Every file in the workspace (same skips and limits as Cadre: 10,000 entries, 512 MB) |
| `restoreBegin` / `restoreEnd` | none | `{ok: true}` (pause and resume agent-browser profile writes) |
| `browser` | `BrowserRequest` (see below) | Same JSON as Cadre's `visible-browser.py` output |
| `ax` | `tool`, `args` | `ToolResult` (see below) |
| `info` | none | `{platform, version, displays: [{id, width, height, scale}], capabilities}` |

`ComputerAction` (from `@cadre/adapter-kit`):
`{kind:"key", key, modifiers?}`, `{kind:"pointer", type:"move"|"down"|"up"|"click"|"double_click", x, y, button?}`,
`{kind:"clipboard", text}` (types the text), `{kind:"scroll", direction:"up"|"down", amount?}`,
`{kind:"wait", ms}`, `{kind:"open", path}`, `{kind:"launch", application, uri?}`.
Coordinates are in the last observation's image space. On a failure partway through a batch,
throw with `Completed N of M actions` like Cadre does, and always release held buttons.

### Workspace

File ops and `exec` default `cwd` resolve inside the bot's workspace on the device:
`~/Burst Computer/<botId>/` on macOS and `~/.local/share/burst/computer/<botId>/` on Linux. Paths
are relative POSIX paths. Absolute paths, `..` and symlink escapes are rejected (same rules as
`workspace_parts` in computer_rpc.py). `exec` itself runs as the user. It is the user's machine,
which is the point. `exec`, input and accessibility are each gated by device settings (§5).

### `browser`

`BrowserRequest`: `{action: "snapshot"|"navigate"|"click"|"fill"|"fill_protected"|"press"|"scroll"|"select"|"tabs"|"select_tab", snapshotId?, ref?, url?, text?, key?, direction?, tabId?, option?, secretText?}`.
The result shape is defined by `packages/adapters/src/visible-browser.py`: snapshots list
interactive elements with stable `ref`s scoped to a `snapshotId`, plus page title, URL, tab list
and visible text. The device implements this with **one shared JavaScript snapshot/action
script** (`BurstComputer/Browser/agent-browser.js`). macOS injects it into a WKWebView. Linux runs it
in Chromium through CDP `Runtime.evaluate`. Burst shows the agent browser in a window (or a tab of
the bot's computer pane) so the user watches it live and can take over.

### `ax` (accessibility tools, from open-codex-computer-use)

`tool` is one of `list_apps`, `get_app_state`, `click`, `perform_secondary_action`, `scroll`,
`drag`, `type_text`, `press_key`, `set_value`, with the same argument names and semantics as
open-codex-computer-use's `ToolDefinitions.swift`. `get_app_state` returns the numbered
accessibility tree of an app's frontmost window plus a screenshot. Later calls target elements by
`element_index` from that tree. That is the fast, consistent path, with pixel coordinates as a
fallback. `ToolResult` is `{content: [{type:"text", text} | {type:"image", data, mimeType}], isError?: boolean}`.

Cadre registers matching agent tools (`computer_apps`, `computer_app_state`, `computer_click_element`,
...) only when the bot's computer is a device that reports `accessibility: true`.

## 4. Screen viewing

People watching from Cadre web or mobile get the device screen through `connectScreen` with
`view: "snapshot"`: frames are `observe` results that the client polls. The person sitting at the
machine already sees it, and Burst shows a "Bot is using this Mac" overlay with a Stop button.

## 5. Safety

* Computer use is **off until the user turns it on** in Burst → Settings → Computer use. That
  screen lists each bot allowed to use the device and lets the user allow or deny exec, input,
  accessibility, and browser access for each.
* While a bot acts, Burst shows a floating indicator and a menu bar state. ⌃⌥⌘. or the Stop button
  cancels all in-flight requests and pauses the device.
* `fill_protected` secret text never appears in logs or results.
* Responses are only accepted for request ids the server issued to that device, and a device only
  ever receives requests for bots owned by its user.
