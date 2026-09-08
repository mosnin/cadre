import { preview } from "astro";

// The CLI auto-detaches in agent environments. The public API keeps this server
// attached to Playwright so startup failures and shutdown are observed directly.
const server = await preview({ server: { host: "127.0.0.1" } });
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.stop();
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
