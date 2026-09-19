import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BotAvatar } from "./bot-avatar.js";

describe("BotAvatar", () => {
  it("draws the agent's own colour", () => {
    const html = renderToString(<BotAvatar color="#3380FF" identity="maya" />);
    expect(html).toContain("cadre-orb");
    expect(html).toContain("#3380ff");
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

  it("marks a run in flight on the orb", () => {
    const working = renderToString(<BotAvatar color="#3380FF" size={20} status="running" />);
    const idle = renderToString(<BotAvatar color="#3380FF" size={20} status="idle" />);
    expect(working).toContain('data-working="true"');
    expect(working).toContain('data-halo="true"');
    expect(idle).not.toContain('data-working="true"');
  });

  it("falls back rather than handing the shader a colour it cannot read", () => {
    const html = renderToString(<BotAvatar color="not a colour" />);
    expect(html).toContain("cadre-orb");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("fluid-orb");
    expect(html).not.toContain("<canvas");
  });
});
