import { describe, expect, it } from "vitest";
import { modelCredentialDto } from "./model-connect.js";
import { serializeModelSecret } from "./pi-oauth.js";

describe("modelCredentialDto", () => {
  it("returns stored baseUrl and modelId for openai-compatible credentials", () => {
    const plaintext = serializeModelSecret({
      kind: "openai_compatible",
      baseUrl: "https://example.invalid/v1",
    });
    expect(
      modelCredentialDto(
        {
          id: "cred-1",
          provider: "openai-compatible",
          label: "Local MLX",
          isDefault: true,
          defaultModel: "qwen3-4b",
        },
        plaintext,
      ),
    ).toEqual({
      id: "cred-1",
      provider: "openai-compatible",
      label: "Local MLX",
      hasKey: true,
      isDefault: true,
      baseUrl: "https://example.invalid/v1",
      modelId: "qwen3-4b",
    });
  });

  it("exposes defaultModel as modelId for provider credentials", () => {
    expect(
      modelCredentialDto({
        id: "cred-2",
        provider: "xai",
        label: "xAI",
        isDefault: false,
        defaultModel: "grok-4.6",
      }),
    ).toEqual({
      id: "cred-2",
      provider: "xai",
      label: "xAI",
      hasKey: true,
      isDefault: false,
      modelId: "grok-4.6",
    });
  });
});

describe("buildModelConnectPlaintext for OpenRouter", () => {
  it("stores the trimmed OAuth-issued key as a plain api key", async () => {
    const { buildModelConnectPlaintext } = await import("./model-connect.js");
    const { parseModelSecret } = await import("./pi-oauth.js");
    const plaintext = buildModelConnectPlaintext({
      provider: "openrouter",
      apiKey: "  sk-or-v1-abcdef123  ",
    });
    expect(parseModelSecret(plaintext)).toEqual({ kind: "api_key", key: "sk-or-v1-abcdef123" });
  });
});
