import { describe, expect, it } from "vitest";
import { conversationPreview } from "./preview-text.js";

describe("conversationPreview", () => {
  it("removes formatting from complete and truncated previews", () => {
    expect(
      conversationPreview("Done: **the login page** at [Example](https://example.test)."),
    ).toBe("Done: the login page at Example.");
    expect(conversationPreview("Opened **the login pa")).toBe("Opened the login pa");
    expect(conversationPreview("## Update\n- Saved `report.md`")).toBe("Update Saved report.md");
  });
});
