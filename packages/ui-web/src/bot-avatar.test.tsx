import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BotAvatar } from "./bot-avatar.js";

describe("BotAvatar", () => {
  it("draws the agent's own colour", () => {
    const html = renderToString(<BotAvatar color="#3380FF" identity="maya" />);
    // The mid stop is the colour itself; the other two are derived from it.
    expect(html).toContain("rgb(51, 128, 255)");
    expect(html).toContain("cadre-orb");
  });

  it("gives two agents two different orbs", () => {
    const maya = renderToString(<BotAvatar color="#3380FF" identity="maya" />);
    const github = renderToString(<BotAvatar color="#26BF8C" identity="github" />);
    expect(maya).not.toBe(github);
  });

  it.each([
    ["running", "speaking"],
    ["waiting_takeover", "speaking"],
    ["waiting_input", "listening"],
    ["queued", "connecting"],
    ["leased", "connecting"],
    ["idle", "idle"],
    [undefined, "idle"],
  ])("maps run status %s to the orb's %s", (status, state) => {
    const html = renderToString(<BotAvatar color="#3380FF" status={status} />);
    expect(html).toContain(`data-orb-state="${state}"`);
  });

  it("breathes only while a run is in flight, and only when it is still", () => {
    // Below the live threshold the orb cannot show the run in its own motion,
    // so the halo says it instead.
    const working = renderToString(<BotAvatar color="#3380FF" size={20} status="running" />);
    const idle = renderToString(<BotAvatar color="#3380FF" size={20} status="idle" />);
    expect(working).toContain('data-working="true"');
    expect(idle).not.toContain('data-working="true"');
  });

  it("falls back rather than handing the shader a colour it cannot read", () => {
    const html = renderToString(<BotAvatar color="not a colour" />);
    expect(html).toContain("cadre-orb");
    expect(html).not.toContain("NaN");
  });
});
