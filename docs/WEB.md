# Web

The Cadre web address serves Burst's hosted web client. The client is built from the Burst
repository ([mosnin/burst](https://github.com/mosnin/burst), under `desktop/`) and deployed to
Cloudflare as a static Worker. It reaches the person's own machines, or cloud colonies running in
Cloudflare Containers, through the Burst Connect relay. Nothing from T3 Code is copied into this
repository; Burst's build carries T3 Code's MIT attribution.

The API and worker are unchanged. Burst Desktop, the Burst Mac app, and `burst-device` still sign
in to Cadre's `/api/auth/*` and `/rpc/*`, which the Vercel gateway (`vercel.json`,
`infra/vercel-build.mjs`) proxies to the runtime on Render (`render.yaml`).

## How it is built

`scripts/burst-web.sh` pins one Burst commit and the Wrangler version. Burst's own runbook,
`desktop/docs/operations/burst-cloud.md` section 3 in that commit, is the reference for the build.

```sh
scripts/burst-web.sh checkout ../burst-web   # fetch the pinned commit
scripts/burst-web.sh build ../burst-web      # Burst's Node.js and pnpm, from desktop/package.json
scripts/burst-web.sh deploy ../burst-web     # build, then wrangler deploy --domain <app host>
```

The script never lets `VITE_HTTP_URL`, `VITE_WS_URL` or `VITE_HOSTED_APP_CHANNEL` into the build:
the hosted client reaches every environment through the relay.

To move to a newer Burst, change `BURST_COMMIT` in the script after reviewing what it brings in.

## Deploying

The `deploy web` workflow (`.github/workflows/deploy-web.yml`) runs only when started by hand, and
stops before building if any required setting is missing.

| Setting | Kind | Value |
| --- | --- | --- |
| `T3CODE_RELAY_URL` | repository variable | Burst Connect relay origin, `https` |
| `T3CODE_HOSTED_APP_URL` | repository variable | The web app's own origin; the deploy attaches its host |
| `BURST_WEB_ENVIRONMENT_HOSTS` | repository variable | Host patterns environments are reached on, such as `*.tunnels.example.net` |
| `CLOUDFLARE_API_TOKEN` | repository secret | Token that can deploy Workers and attach custom domains |
| `CLOUDFLARE_ACCOUNT_ID` | repository secret | The Cloudflare account to deploy to |
| `BURST_SOCIAL_PROVIDERS` | optional variable | `github,google`; the relay must hold their credentials |
| `BURST_WEB_CSP_CONNECT_SRC`, `BURST_WEB_CSP_IMG_SRC` | optional variables | Extra hosts for the security headers |
| `BURST_WEB_CSP_REPORT_ONLY` | optional variable | `1` for the first deploy, to read policy reports before enforcing |

The relay is deployed from the Burst repository, not here. It must trust the app origin: set
`RELAY_HOSTED_APP_ORIGIN` to `T3CODE_HOSTED_APP_URL` and include it in `RELAY_ALLOWED_ORIGINS`.

Roll back with `wrangler rollback` in `desktop/apps/web` of the same checkout, or from the
Worker's Deployments tab in the Cloudflare dashboard.
