import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("shared computers accept input immediately and refresh only their viewer on reconnect", async ({
  page,
}, testInfo) => {
  await signup(page, `shared-screen-${Date.now()}@rakazo.test`, "password12", "Shared Screen");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  await rpc(page, "computer/boot", { botId });
  let screenRequests = 0;
  let takeovers = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/rpc/computer/takeover")) takeovers++;
  });
  await page.route("**/rpc/computer/screenUrl", (route) => {
    screenRequests++;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        json: { url: "https://shared-screen.example/embed.html", sharedInput: true },
      }),
    });
  });
  await page.route("https://shared-screen.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body style="background:#161616;color:white;font:16px system-ui;padding:24px"><h1>Agent browser</h1><label>Shared input <input aria-label="Shared input"></label><button id="retry">Reconnect</button><script>parent.postMessage({type:"cadre:computer-connection",state:"connected"},"*");document.getElementById('retry').onclick=()=>parent.postMessage({type:'cadre:computer-retry'},'*');</script></body></html>`,
    }),
  );
  await page.getByTitle("Agent computer").click();
  await page.getByTestId("computer-preview-open").click();
  const viewer = page.frameLocator('iframe[title="Bot screen"]');
  await viewer.getByRole("textbox", { name: "Shared input" }).fill("Human input without takeover");
  await expect(viewer.getByRole("textbox")).toHaveValue("Human input without takeover");
  await expect(page.getByRole("button", { name: "Take control", exact: true })).toHaveCount(0);
  expect(takeovers).toBe(0);
  await captureScreenshot(page, testInfo, "computer-shared-input-desktop");
  const before = screenRequests;
  await viewer.getByRole("button", { name: "Reconnect" }).click();
  await expect.poll(() => screenRequests).toBeGreaterThan(before);
  // The URL may be stable; the failed frame still must be replaced.
  await expect(viewer.getByRole("textbox")).toHaveValue("");
  // HTTP load is not a working viewer: a proxy error or failed module import
  // must retain a watchdog and offer a fresh capability instead of blanking.
  await page.route("https://shared-screen.example/**", (route) =>
    route.fulfill({
      status: 502,
      contentType: "text/html",
      body: "<!doctype html><title>Unavailable</title>",
    }),
  );
  await viewer.getByRole("button", { name: "Reconnect" }).click();
  await expect(page.getByText("Could not load the screen", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.unroute("https://shared-screen.example/**");
  await page.route("https://shared-screen.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><label>Shared input <input aria-label="Shared input"></label><script>parent.postMessage({type:"cadre:computer-connection",state:"connected"},"*")</script>',
    }),
  );
  await page.getByRole("button", { name: "Retry screen", exact: true }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await viewer.getByRole("textbox").fill("Phone input");
  await captureScreenshot(page, testInfo, "computer-shared-input-mobile");
  await page.getByRole("button", { name: "Close computer" }).click();
  expect(takeovers).toBe(0);
});

test("opening a sleeping computer keeps a visible boot status and close action", async ({
  page,
}, testInfo) => {
  await signup(page, `boot-screen-${Date.now()}@rakazo.test`, "password12", "Boot Screen");
  await completeOnboarding(page);
  await page.route("**/rpc/computer/boot", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue();
  });
  await page.getByTitle("Agent computer").click();
  await page.getByTestId("computer-preview-open").click();
  await expect(page.getByRole("button", { name: "Close computer" })).toBeVisible();
  await expect(page.getByText(/Booting/).first()).toBeVisible();
  await captureScreenshot(page, testInfo, "computer-startup-status");
  await page.getByRole("button", { name: "Close computer" }).click();
  await expect(page.getByTestId("computer-preview")).toBeVisible();
});
