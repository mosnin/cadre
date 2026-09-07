import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("realtime voice dispatches an actual task once and releases the microphone on hangup", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const fixture = { sent: [] as unknown[], stopped: false, receive: (_event: unknown) => {} };
    Object.assign(window, { realtimeFixture: fixture });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        const audio = new AudioContext();
        await audio.resume();
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        gain.gain.value = 0;
        const destination = audio.createMediaStreamDestination();
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        Object.assign(fixture, { gain });
        for (const track of destination.stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            fixture.stopped = true;
            stop();
            oscillator.stop();
            void audio.close();
          };
        }
        return destination.stream;
      },
    });
    class Peer {
      connectionState = "connected";
      channel = {
        readyState: "open",
        onopen: null as (() => void) | null,
        onmessage: null as ((event: { data: string }) => void) | null,
        send: (data: string) => fixture.sent.push(JSON.parse(data)),
        close() {},
      };
      createDataChannel() {
        fixture.receive = (event) => this.channel.onmessage?.({ data: JSON.stringify(event) });
        return this.channel;
      }
      addTrack() {}
      async createOffer() {
        return { type: "offer", sdp: "v=0\r\nmock-offer" };
      }
      async setLocalDescription() {}
      async setRemoteDescription() {
        this.channel.onopen?.();
      }
      close() {}
    }
    Object.assign(window, { RTCPeerConnection: Peer });
  });
  await signup(page, `realtime-${Date.now()}@rakazo.test`, "password12", "Realtime Voice");
  await completeOnboarding(page);
  await rpc(page, "voice/connect", { provider: "scripted", apiKey: "fake-scripted-voice-key" });
  const botId = activeBotId(page);
  await page.route("**/rpc/voice/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        json: {
          configured: true,
          ready: true,
          transcribe: true,
          realtime: true,
          provider: "openai",
          voiceId: "coral",
        },
      }),
    }),
  );
  await page.route("**/api/voice/realtime", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ sdp: "v=0\r\nmock-answer" }),
    }),
  );
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Call", exact: true }).click();
  const call = page.getByTestId("call-view");
  await expect(call).toHaveAttribute("data-voice-transport", "realtime");
  await expect(call.getByRole("status")).toHaveText("Listening…");
  await expect
    .poll(async () => {
      const bounds = await call.boundingBox();
      return (
        bounds && [
          Math.round(bounds.x),
          Math.round(bounds.y),
          Math.round(bounds.width),
          Math.round(bounds.height),
        ]
      );
    })
    .toEqual([0, 0, 390, 844]);
  await page.evaluate(() => {
    (window as any).realtimeFixture.gain.gain.value = 0.12;
  });
  const orb = page.getByTestId("voice-orb");
  await expect
    .poll(async () => Number(await orb.getAttribute("data-audio-level")))
    .toBeGreaterThan(0.2);
  await captureScreenshot(page, testInfo, "mobile-realtime-speaking");
  await page.evaluate(() => {
    (window as any).realtimeFixture.gain.gain.value = 0;
  });
  await expect.poll(async () => Number(await orb.getAttribute("data-audio-level"))).toBe(0);
  const sends: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/voice/tool") && request.postDataJSON().name === "start_task")
      sends.push(request.postDataJSON().args.request);
  });
  await page.evaluate(() => {
    const fixture = (window as any).realtimeFixture;
    const event = {
      type: "response.done",
      response: {
        output: [
          {
            type: "function_call",
            name: "start_task",
            call_id: "voice-task-1",
            arguments: JSON.stringify({ request: "Use your screen and type realtimeproof" }),
          },
        ],
      },
    };
    fixture.receive(event);
    fixture.receive(event);
  });
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0]).toBe("Use your screen and type realtimeproof");
  await expect
    .poll(
      async () => {
        const snapshot = await rpc<any>(page, "threads/get", { botId });
        return !snapshot.run && snapshot.messages.at(-1)?.role === "bot";
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).realtimeFixture.sent.some(
          (event: any) =>
            event.item?.type === "function_call_output" && JSON.parse(event.item.output).accepted,
        ),
      ),
    )
    .toBe(true);
  // Audio transport is emulated; creation, authorization and tasks use the real API.
  await page.evaluate(() => {
    const event = {
      type: "response.done",
      response: {
        output: [
          {
            type: "function_call",
            name: "spawn_agent",
            call_id: "voice-spawn-1",
            arguments: JSON.stringify({ name: "Voice helper", request: "Reply with helper ready" }),
          },
        ],
      },
    };
    (window as any).realtimeFixture.receive(event);
    (window as any).realtimeFixture.receive(event);
  });
  let helperId = "";
  await expect
    .poll(async () => {
      const bots = await rpc<any[]>(page, "bots/list", {});
      const helpers = bots.filter((bot) => bot.name === "Voice helper");
      helperId = helpers[0]?.id ?? "";
      return helpers.length;
    })
    .toBe(1);
  await expect
    .poll(async () => {
      const snapshot = await rpc<any>(page, "threads/get", { botId: helperId });
      return snapshot.messages.filter(
        (message: any) =>
          message.role === "user" &&
          message.blocks.some(
            (block: any) => block.kind === "text" && block.text === "Reply with helper ready",
          ),
      ).length;
    })
    .toBe(1);
  await page.evaluate((agentId) => {
    (window as any).realtimeFixture.receive({
      type: "response.done",
      response: {
        output: [
          {
            type: "function_call",
            name: "task_status",
            call_id: "voice-status-1",
            arguments: JSON.stringify({ agentId }),
          },
        ],
      },
    });
  }, helperId);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).realtimeFixture.sent.some(
          (event: any) =>
            event.item?.call_id === "voice-status-1" && JSON.parse(event.item.output).agentId,
        ),
      ),
    )
    .toBe(true);
  await captureScreenshot(page, testInfo, "mobile-realtime-task");
  await page.setViewportSize({ width: 1365, height: 900 });
  await expect
    .poll(async () => {
      const bounds = await call.boundingBox();
      return bounds && [Math.round(bounds.width), Math.round(bounds.height)];
    })
    .toEqual([1365, 900]);
  await captureScreenshot(page, testInfo, "desktop-realtime-task");
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Hang up", exact: true }).click();
  await expect(call).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).realtimeFixture.stopped)).toBe(true);
});
