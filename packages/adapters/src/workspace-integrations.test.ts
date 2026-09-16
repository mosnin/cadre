import { describe, expect, it } from "vitest";
import {
  normalizeWorkspaceIdentity,
  WORKSPACE_PROVIDERS,
  WorkspaceIntegrations,
  workspaceProviderDefaults,
  workspaceProviderOverridesFromEnv,
} from "./workspace-integrations.js";

describe("workspace provider identity", () => {
  it("accepts org_id and workspace shapes and refuses personal accounts", () => {
    expect(
      normalizeWorkspaceIdentity({ sub: "u", org_id: "o", org_name: "Org" }, "workspace"),
    ).toEqual({ sub: "u", org_id: "o", org_name: "Org" });
    expect(
      normalizeWorkspaceIdentity({ sub: "u", workspace: { id: "w", name: "Team" } }, "workspace"),
    ).toEqual({ sub: "u", org_id: "w", org_name: "Team" });
    expect(() => normalizeWorkspaceIdentity({ sub: "u", email: "a@b.c" }, "workspace")).toThrow(
      "Choose a workspace",
    );
  });
  it("overrides origins and static client ids from the environment", () => {
    const service = new WorkspaceIntegrations({
      prisma: {} as never,
      pool: {} as never,
      secrets: {} as never,
      webOrigin: "https://cadre.test",
      providers: workspaceProviderOverridesFromEnv({
        OPERATE_ORIGIN: "https://operate.local/",
        STORED_OAUTH_CLIENT_ID: "seeded-client",
        SCALAR_OAUTH_CLIENT_ID: "ignored-for-dynamic",
      }),
    });
    expect(service.provider("operate").origin).toBe("https://operate.local");
    expect(service.provider("stored").registration).toEqual({
      kind: "static",
      clientId: "seeded-client",
    });
    expect(service.provider("scalar").registration).toEqual(
      workspaceProviderDefaults.scalar.registration,
    );
    expect(WORKSPACE_PROVIDERS).toEqual(["operate", "stored", "scalar"]);
  });
});
