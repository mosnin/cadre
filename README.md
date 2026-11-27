# Cadre

[![GitHub stars](https://img.shields.io/github/stars/mosnin/cadre?labelColor=black&style=for-the-badge&color=2563EB)](https://github.com/mosnin/cadre/stargazers)
[![Discord](https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?labelColor=black&style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/RWwKa2Sn7h)

![Cadre — AI teammates you actually own](./docs/readme-hero.png)

Cadre is an open-source platform for running persistent AI teammates. Bring your own model and
computer provider, or run the complete stack locally.

Cadre is becoming [Burst](https://github.com/mosnin/burst). The desktop app is now Burst Desktop,
and the Cadre web address serves Burst's hosted web client ([docs/WEB.md](./docs/WEB.md)). This
repository still holds the API, worker, Expo mobile app, and marketing site; they move in later
stages.

Cadre is in beta. Learn more at [cadre.to](https://cadre.to).

## Features

- Persistent bots with their own conversations, memory, routines, and history
- Voice mode: speak replies, dictate, and call a bot. Bring your own ElevenLabs, OpenAI, or Cartesia key
- Shared Team Computers and isolated Private computers
- Browser, terminal, file, and graphical desktop access
- Bots that can delegate to peer bots or short-lived subagents
- Bring-your-own model credentials through Pi
- App integrations through Composio or Pipedream Connect, plus user-installed Treg, remote MCP, and OpenAPI tool sources
- Docker, E2B, Daytona, Box, and trusted local-computer support

## Demo

https://github.com/user-attachments/assets/dccdeddb-2134-4a56-8eed-b2e591736b1c

## Stack

- TypeScript
- React 19 and Expo
- Hono and oRPC
- PostgreSQL and Prisma
- Better Auth
- Graphile Worker
- Pi
- Docker, E2B, Daytona, and Box
- Composio, Pipedream Connect, MCP, and OpenAPI integrations

## Quick start (published images)

You need Docker Engine, the Compose plugin, curl, and OpenSSL. No clone or Node install.

```bash
mkdir -p cadre && cd cadre &&
curl -fsSLO https://raw.githubusercontent.com/mosnin/cadre/main/infra/compose/install-images.sh &&
bash install-images.sh
```

The installer downloads the Compose files, creates `.env` with random secrets, and starts the Cadre
API at `http://127.0.0.1:3100`. It preserves an existing `.env` when rerun. Local Docker computers are on by default. Optional remote providers: `e2b`, `daytona`, or `box`
with the matching API key.

Default image tag is `edge` (main builds, `linux/amd64` + `linux/arm64`). Details and tags:
[self-hosting guide](./docs/self-host.md#published-images-no-checkout).

On restricted networks, override the installer download base (`CADRE_DOWNLOAD_BASE`), skip
existing Compose files (`--local` / `CADRE_DOWNLOAD_SKIP_EXISTING`), or mirror the bootstrap
script URL — see
[Restricted networks / mirror downloads](./docs/self-host.md#restricted-networks--mirror-downloads).

For an agent-assisted install, use [SETUP_PROMPT.md](./SETUP_PROMPT.md).

## Run on a server

Bots stay on when the backend runs on a server. Use the same installer on a VPS, then connect from
the mobile app.

```bash
bash install-images.sh --prepare-only
# edit .env: SANDBOX_PROVIDER=box (or e2b / daytona) with its API key, CADRE_HOST=your.domain
bash install-images.sh
```

Put HTTPS in front of port 3100; [docs/self-host.md](./docs/self-host.md#public-single-vm-deployment)
covers the Caddy setup and host hardening.

## Local development (source checkout)

You need Node.js 22.22.2 or newer in the 22.x line, Node.js 24.x, or Node.js 26+;
pnpm 9; and Docker. Node.js 23.x and 25.x are not supported.

```bash
git clone https://github.com/mosnin/cadre.git
cd cadre
cp .env.example .env
```

Set `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, and `SCREEN_PROXY_SECRET` in `.env` to independent
long random values. Docker sandboxes also need a dedicated `SANDBOX_SUPERVISOR_TOKEN`. You can
also set `OPENROUTER_API_KEY`, or connect a supported model provider during onboarding.

Managed app catalogs are optional. Set `COMPOSIO_API_KEY` for Composio, or the
`PIPEDREAM_CLIENT_ID`, `PIPEDREAM_CLIENT_SECRET`, and `PIPEDREAM_PROJECT_ID` trio for Pipedream
Connect. Users can add an HTTPS MCP server, Treg endpoint, or OpenAPI JSON document from
**Integrations** without enabling either managed catalog. Connector credentials are encrypted on the
server and are never returned by the API.

Treg is usage-metered. Self-hosters supply their own Treg token; operators embedding Treg in a
hosted product should review [Treg's integration terms](https://treg.to/integrate.md), which require
a written agreement for hosted resale.

```bash
docker compose --env-file .env -f infra/compose/docker-compose.yml up postgres -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm sandbox:build
pnpm dev
```

The API listens on `http://127.0.0.1:3100`.

For deployment, provider selection, backups, and upgrades, see the
[self-hosting guide](./docs/self-host.md).

## Mobile

The Expo app is a client of the Cadre API. Build and release instructions live in
[docs/mobile-release.md](./docs/mobile-release.md). The Expo app supports English and 简体中文
under **Account → Language**; the marketing homepage (`apps/www`) is available in en/de/ko/zh.

## Development

Cadre is a TypeScript monorepo built with React, Expo, Hono, Postgres, Prisma, Graphile Worker,
and Pi.

```text
apps/       api, worker, mobile, and public website
packages/   domain, contracts, persistence, adapters, UI, and test tooling
infra/      local services and computer images
docs/       architecture, operations, and release guides
```

Common checks:

```bash
pnpm lint
pnpm check
pnpm test
pnpm test:integration
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development workflow and test matrix.

## Documentation

```bash
pnpm test              # unit, property, and in-process contract tests
pnpm test:integration  # Postgres journeys, Graphile jobs, LISTEN/NOTIFY
pnpm test:topology     # local Docker + Graphile worker recovery (needs Docker)
pnpm test:canary       # live OpenRouter / E2B / Box canaries
# explicit real vision-model + real E2B desktop acceptance test:
COMPUTER_E2E_MODEL=<vision-capable-openrouter-model-id> pnpm test:computer
```

- [Self-hosting](./docs/self-host.md)
- [Computer runtime and isolation](./docs/computer-runtime.md)
- [Web (Burst hosted client)](./docs/WEB.md)
- [Mobile releases](./docs/mobile-release.md)

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull
request. For security vulnerabilities, follow [SECURITY.md](./SECURITY.md) instead of filing a public
issue.

Cadre is licensed under the [Apache License 2.0](./LICENSE).

Questions and ideas are welcome in the [Cadre Discord community](https://discord.gg/RWwKa2Sn7h).
