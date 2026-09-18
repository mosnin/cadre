import { choice, noul, score } from "@rakazo/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decisionModel, decisionProvider } from "./jev-decisions.js";

const KEY_ENV = { OPENROUTER_API_KEY: "sk-or-test" } as NodeJS.ProcessEnv;

function respond(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("decision provider configuration", () => {
  it("is absent without a key, so every caller keeps its own behaviour", () => {
    expect(decisionProvider({} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it("reuses the OpenRouter key and can be turned off explicitly", () => {
    expect(decisionProvider(KEY_ENV)).toBeDefined();
    expect(
      decisionProvider({ ...KEY_ENV, JEV_DECISIONS_ENABLED: "0" } as NodeJS.ProcessEnv),
    ).toBeUndefined();
  });

  it("defaults to Jev and takes an override", () => {
    expect(decisionModel({} as NodeJS.ProcessEnv)).toBe("typesafe/jev-1.13");
    expect(decisionModel({ JEV_MODEL: "typesafe/jev-next" } as NodeJS.ProcessEnv)).toBe(
      "typesafe/jev-next",
    );
  });
});

describe("asking for a decision", () => {
  it("sends every question in one request and returns the answers", async () => {
    const fetchMock = respond({
      model: "typesafe/jev-1.13-20260917",
      answers: {
        route: { type: "choice", choice: "fast", probabilities: { fast: 0.9, strong: 0.1 } },
        urgent: { type: "noul", noul: 0.8 },
        quality: { type: "score", score: 3 },
      },
      usage: { input_tokens: 120, output_tokens: 0 },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await decisionProvider(KEY_ENV)!.decide({
      state: { task: "summarise a page" },
      sessionId: "run-1",
      questions: {
        route: choice("Which model?", { fast: null, strong: null }),
        urgent: noul("Is this urgent?"),
        quality: score("How good?", ["poor", "fine", "good", "great"]),
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("typesafe/jev-1.13");
    expect(body.session_id).toBe("run-1");
    expect(Object.keys(body.questions)).toEqual(["route", "urgent", "quality"]);
    expect(result?.model).toBe("typesafe/jev-1.13-20260917");
    expect(result?.answers.route).toMatchObject({ choice: "fast" });
    expect(result?.answers.urgent).toMatchObject({ noul: 0.8 });
  });

  it("drops an answer naming an option that was never offered", async () => {
    vi.stubGlobal(
      "fetch",
      respond({ model: "m", answers: { route: { type: "choice", choice: "invented" } } }),
    );
    const result = await decisionProvider(KEY_ENV)!.decide({
      state: "x",
      questions: { route: choice("Which?", { fast: null, strong: null }) },
    });
    expect(result?.answers.route).toBeUndefined();
  });

  it("drops an answer whose probabilities do not add up", async () => {
    vi.stubGlobal(
      "fetch",
      respond({
        model: "m",
        answers: {
          route: { type: "choice", choice: "fast", probabilities: { fast: 0.9, strong: 0.9 } },
        },
      }),
    );
    const result = await decisionProvider(KEY_ENV)!.decide({
      state: "x",
      questions: { route: choice("Which?", { fast: null, strong: null }) },
    });
    expect(result?.answers.route).toBeUndefined();
  });

  it("returns nothing rather than failing the caller when the provider errors", async () => {
    vi.stubGlobal("fetch", respond({ error: "nope" }, 400));
    await expect(
      decisionProvider(KEY_ENV)!.decide({
        state: "x",
        questions: { route: choice("Which?", { fast: null }) },
      }),
    ).resolves.toBeUndefined();
  });

  it("retries a request that never produced a decision, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ model: "m", answers: { route: { type: "choice", choice: "fast" } } }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = await decisionProvider(KEY_ENV)!.decide({
      state: "x",
      questions: { route: choice("Which?", { fast: null }) },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result?.answers.route).toMatchObject({ choice: "fast" });
  });

  it("does not retry once the caller has cancelled", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await decisionProvider(KEY_ENV)!.decide({
      state: "x",
      signal: controller.signal,
      questions: { route: choice("Which?", { fast: null }) },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
  });

  it("asks nothing when there are no questions", async () => {
    const fetchMock = respond({});
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      decisionProvider(KEY_ENV)!.decide({ state: "x", questions: {} }),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("a question the service would reject", () => {
  it("is dropped before it can cost the whole request", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: "typesafe/jev-1.13",
            answers: { ok: { type: "noul", noul: 1 } },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = decisionProvider({ OPENROUTER_API_KEY: "k" } as NodeJS.ProcessEnv);
    const result = await provider?.decide({
      state: "s",
      questions: {
        ok: noul("Is it so?"),
        // A rubric of one level is not a rubric, and the service answers it with a 422.
        broken: { type: "score", instructions: "How much?", criteria: ["only one"] },
      },
    });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(Object.keys(body.questions)).toEqual(["ok"]);
    expect(result?.answers.ok).toMatchObject({ noul: 1 });
  });

  it("does not open a request when it was the only question", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = decisionProvider({ OPENROUTER_API_KEY: "k" } as NodeJS.ProcessEnv);
    await expect(
      provider?.decide({
        state: "s",
        questions: { broken: { type: "score", instructions: "How much?", criteria: ["one"] } },
      }),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("choosing an endpoint", () => {
  it("prefers TypeSafe's own, and names the model the way that endpoint does", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: "jev-1.13",
            answers: { ok: { type: "noul", noul: 0.9 } },
            usage: { input_tokens: 10, output_tokens: 0 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = decisionProvider({
      TYPESAFE_API_KEY: "ts-test",
      OPENROUTER_API_KEY: "sk-or-test",
      JEV_MODEL: "typesafe/jev-1.13",
    } as NodeJS.ProcessEnv);
    const result = await provider?.decide({ state: "s", questions: { ok: noul("Is it so?") } });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toBe("https://api.typesafe.ai/v1/systemone");
    // OpenRouter needs the vendor prefix to route; TypeSafe's own endpoint does not take it.
    expect(JSON.parse(init.body as string).model).toBe("jev-1.13");
    expect(result?.answers.ok).toMatchObject({ noul: 0.9 });
  });

  it("asks once for a state that has not changed", async () => {
    const fetchMock = respond({
      model: "typesafe/jev-1.13",
      answers: { ok: { type: "noul", noul: 0.9 } },
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = decisionProvider(KEY_ENV);
    const request = { state: { page: "one" }, questions: { ok: noul("Is it so?") } };
    await provider?.decide(request);
    await provider?.decide({ ...request });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
