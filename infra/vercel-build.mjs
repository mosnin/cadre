import { mkdir, writeFile } from "node:fs/promises";

const runtime = new URL(process.env.API_PROXY_TARGET ?? "");
if (
  runtime.protocol !== "https:" ||
  runtime.username ||
  runtime.password ||
  runtime.pathname !== "/"
) {
  throw new Error("API_PROXY_TARGET must be the HTTPS origin of the cloud runtime");
}
const marketing = process.env.MARKETING_ORIGIN ? new URL(process.env.MARKETING_ORIGIN) : null;
if (
  marketing &&
  (marketing.protocol !== "https:" ||
    marketing.username ||
    marketing.password ||
    marketing.pathname !== "/")
) {
  throw new Error("MARKETING_ORIGIN must be an HTTPS origin");
}
// The web app moved to Burst's hosted client (docs/WEB.md). This gateway only proxies the API,
// which the Burst apps sign in to, and serves the marketing site on every other path.
await mkdir(".vercel/output/static", { recursive: true });
await writeFile(
  ".vercel/output/config.json",
  JSON.stringify({
    version: 3,
    routes: [
      ...["api", "rpc"].map((prefix) => ({
        src: `/${prefix}/(.*)`,
        dest: `${runtime.origin}/${prefix}/$1`,
        headers: { "cache-control": "private, no-store", "x-vercel-enable-rewrite-caching": "0" },
      })),
      ...(marketing ? [{ src: "/(.*)", dest: `${marketing.origin}/$1` }] : []),
    ],
  }),
);
