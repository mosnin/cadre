import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AvatarStyleProvider } from "./avatar-style.js";
import { GroupAvatar } from "./group-avatar.js";

// These assert the robot renderer's own markup, so they say which style they
// mean rather than leaning on whichever one is currently the default.
const render = (node: ReactNode) =>
  renderToString(<AvatarStyleProvider value="robot">{node}</AvatarStyleProvider>);

describe("GroupAvatar", () => {
  it("renders fallback squad icon when no members provided", () => {
    const html = render(<GroupAvatar members={[]} />);
    expect(html).toContain("<svg");
  });

  it("renders single BotAvatar when 1 member", () => {
    const html = render(<GroupAvatar members={[{ name: "Harry", color: "#8B5CF6" }]} />);
    expect(html).toContain("rakazo-bot-avatar");
  });

  it("renders 2 overlapping bot avatars for 2 members", () => {
    const html = render(
      <GroupAvatar
        members={[
          { name: "Sherlock", color: "#8B5CF6" },
          { name: "Elon", color: "#06B6D4" },
        ]}
      />,
    );
    const count = (html.match(/data-working=/g) || []).length;
    expect(count).toBe(2);
    expect(html).toContain('data-working="false"');
  });

  it("renders a working member inside a group avatar", () => {
    const html = render(
      <GroupAvatar
        members={[
          { name: "Sherlock", color: "#8B5CF6", status: "running" },
          { name: "Elon", color: "#06B6D4", status: "idle" },
        ]}
      />,
    );
    expect(html).toContain('data-working="true"');
    expect(html).toContain("rakazo-bot-avatar-ring");
  });

  it("renders 3 mini bot avatars for 3 members", () => {
    const html = render(
      <GroupAvatar
        members={[
          { name: "Sherlock", color: "#8B5CF6" },
          { name: "Elon", color: "#06B6D4" },
          { name: "Penny", color: "#EC4899" },
        ]}
      />,
    );
    const count = (html.match(/data-working=/g) || []).length;
    expect(count).toBe(3);
  });

  it("renders 2 mini avatars + overflow count for 4+ members", () => {
    const html = render(
      <GroupAvatar
        members={[
          { name: "Sherlock", color: "#8B5CF6" },
          { name: "Elon", color: "#06B6D4" },
          { name: "Penny", color: "#EC4899" },
          { name: "Harry", color: "#10B981" },
        ]}
      />,
    );
    expect(html).toContain("+2");
  });
});
