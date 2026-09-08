import { listPiCatalog } from "@rakazo/adapters";
import type { Actor } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { persistModelCredential, type RouterDeps } from "./router.js";

const actor: Actor = {
  userId: "user-test",
  spaceId: "space-test",
  email: "user@example.test",
  isDeploymentOwner: false,
};

function fixture() {
  const credential = { id: "credential-test", provider: "openai-codex", label: "Test" };
  const preference = { updateMany: vi.fn(), upsert: vi.fn() };
  const tx = {
    userModelCredential: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(credential),
    },
    secret: { create: vi.fn().mockResolvedValue({ id: "secret-test" }) },
    spaceModelPreference: preference,
  };
  const put = vi.fn().mockResolvedValue({ id: "secret-test", ciphertext: "test-ciphertext" });
  const deps = {
    prisma: { $transaction: vi.fn(async (fn) => fn(tx)) },
    secrets: { put },
    env: { defaultProvider: "openrouter", defaultModel: "vendor/deployment-model" },
  } as unknown as RouterDeps;
  return { deps, put, preference };
}

describe("persistModelCredential model selection", () => {
  it("selects a model from the connected subscription provider when the client omits it", async () => {
    const { deps, preference } = fixture();
    const expected = listPiCatalog().find((entry) => entry.provider === "openai-codex")!.id;
    const result = await persistModelCredential(deps, actor, {
      provider: "openai-codex",
      plaintext: "synthetic-credential",
    });
    expect(result.modelId).toBe(expected);
    expect(preference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          userId: actor.userId,
          spaceId: actor.spaceId,
          modelId: expected,
        }),
      }),
    );
  });

  it("preserves an explicit model selection", async () => {
    const { deps } = fixture();
    const result = await persistModelCredential(deps, actor, {
      provider: "openai-codex",
      modelId: "selected-model",
      plaintext: "synthetic-credential",
    });
    expect(result.modelId).toBe("selected-model");
  });

  it("uses a custom deployment model only for its own provider", async () => {
    const { deps } = fixture();
    const result = await persistModelCredential(deps, actor, {
      provider: "openrouter",
      plaintext: "synthetic-credential",
    });
    expect(result.modelId).toBe("vendor/deployment-model");
  });

  it("asks for a model before storing secrets when the provider has no selectable model", async () => {
    const { deps, put } = fixture();
    await expect(
      persistModelCredential(deps, actor, {
        provider: "unknown-provider",
        plaintext: "synthetic-credential",
      }),
    ).rejects.toThrow("Choose a model for this provider.");
    expect(put).not.toHaveBeenCalled();
  });
});
