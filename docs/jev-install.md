# Typed decisions — installing, verifying, and operating

[`jev.md`](./jev.md) says what each decision is and why it exists. This is the
other half: how to turn the layer on, how to prove it is actually answering,
what it costs, and what happens at every point where it can fail.

Read this if you are deploying Cadre, debugging a decision that did not fire,
or adding a provider.

---

## 0. The one thing to know first

**Nothing here is required.** With no key configured, `decisionProvider()`
returns `undefined` and every caller takes the branch it took before this layer
existed: the generative judge still judges, memory stays in recency order,
search keeps the engine's ranking, the browser agent plans its own steps.

That is a contract, not a courtesy — no hosted vendor is required to run the
core product. It is also the reason the install can be verified by turning the
layer *off* and watching nothing break.

---

## 1. What gets installed

Nothing to `npm install`. The layer is three groups of files already in the
repo:

| Where | What it is |
|---|---|
| `packages/core/src/decisions.ts` | The question builders (`choice`, `score`, `noul`), `DECISION_CONFIDENCE`, and the readers that enforce it. No network. |
| `packages/adapters/src/jev-decisions.ts` | The two providers and the resolution order. This is the only file that speaks HTTP. |
| `packages/adapters/src/decision-*.ts` | One file per decision — turn, browser, memory, routing, search, guards — plus `decision-cache.ts`. |

Each has a `.test.ts` beside it. `pnpm vitest run packages/adapters` exercises
the whole layer with no network and no key.

---

## 2. Configuration

Every key is in [`.env.example`](../.env.example) under **Typed decisions
(Jev)**. Nothing is read anywhere else.

```bash
TYPESAFE_API_KEY=            # TypeSafe directly. Wins when set.
JEV_API_KEY=                 # OpenRouter Decisions API, own key
OPENROUTER_API_KEY=          # reused when JEV_API_KEY is empty
JEV_DECISIONS_ENABLED=1      # 0 disables everything, keys and all
JEV_MODEL=                   # blank uses the built-in default
JEV_TIMEOUT_MS=6000          # per request, clamped to 500–30000
JEV_ROUTER_MODELS=           # JSON array; empty means no run routing
```

### The resolution order, exactly

`decisionProvider(env)` in `jev-decisions.ts`:

1. `JEV_DECISIONS_ENABLED === "0"` → `undefined`. Nothing else is read.
2. `TYPESAFE_API_KEY` set → **TypeSafeDecisionProvider**, through the vendor
   SDK. One hop shorter, and someone who set that key meant it.
3. Otherwise `JEV_API_KEY || OPENROUTER_API_KEY` → **OpenRouterDecisionProvider**
   against `POST /api/alpha/decisions`.
4. Neither → `undefined`.

Both are wrapped in `cached(...)`. Nothing above the adapter can tell which one
answered, which is what makes the fallback path testable.

### What each key changes

- **No key** — the layer is inert. Supported and tested.
- **`OPENROUTER_API_KEY` only** — this is most deployments: a key you already
  have, nothing new to sign up for.
- **`TYPESAFE_API_KEY`** — one fewer hop, so the low end of the latency range.
- **`JEV_ROUTER_MODELS` empty** — run routing is off specifically, even with a
  key. Every run uses `PI_DEFAULT_MODEL`. Turn routing on only once you have a
  pool worth choosing between.

---

## 3. Verifying the install

Four checks, cheapest first. Do them in order; each one rules out a layer.

### 3.1 The code is wired (no network, no key)

```bash
pnpm exec vitest run packages/adapters packages/core
```

Passing here proves the question builders, the confidence readers, the cache
keying and **every fallback** behave. It proves nothing about your key.

### 3.2 A provider resolves

```bash
node -e '
  const { decisionProvider } = require("./packages/adapters/src/jev-decisions.ts");
  console.log(decisionProvider(process.env) ? "provider: configured" : "provider: none");
'
```

`none` with keys set means one of: `JEV_DECISIONS_ENABLED=0`, or the key is
whitespace (it is `.trim()`ed, so `" "` reads as empty), or the env file is not
being loaded by the process you are testing.

### 3.3 A decision actually answers

The honest end-to-end check is to make one and watch it come back. Start the
API, open a conversation, and give a bot a task that calls a connector. The
tool-call decision (`decideToolCall`) runs on consequential calls the name
check already cleared.

What you should see:

- The call resolves in **70–500ms** for the decision itself.
- A second identical call in the same window costs nothing —
  `decision-cache.ts` keys on model + state + every question and its criteria.

If the request fails or times out, the caller takes its fallback and the run
continues. **A broken decision layer does not break a run**, which is why the
next check matters.

### 3.4 Proving it is on rather than silently falling back

This is the check people skip, and it is the only one that distinguishes
"working" from "quietly doing nothing":

1. Set `JEV_DECISIONS_ENABLED=0`, restart, run your task, note the behaviour.
2. Set it back to `1`, restart, run the same task.

If the two are identical, your decisions are not being reached — a missing key,
a key that is failing every request, or a path that never asks. Somewhere
observable should differ: memory order, search order, whether a run stopped to
ask.

---

## 4. Theory of operation

### Why a decision and not a small chat model

A chat model asked to answer "is this dangerous?" writes a sentence you then
have to parse, and its confidence is whatever the words imply. A decision model
returns, per question, the answer **and a calibrated probability for every
option**. Two consequences:

- **You can set a bar.** `DECISION_CONFIDENCE` names three, and each caller
  picks the one matching what a wrong answer costs: `advisory` 0.35 for
  ordering a person can ignore, `routing` 0.55 for a path the run then takes,
  `consequential` 0.80 for anything unattended that touches the outside world.
- **You can ask speculatively.** A question is nearly free; a *request* is not.
  Thirteen questions over one document measure ~10x faster and ~12x cheaper
  than thirteen requests, because the questions are evaluated in parallel and
  in isolation and the state — the expensive part — is paid for once.

That second property is the shape of the whole layer. `decision-turn.ts` sends
the consequence question, a speculative pass/ask, and a concern category in
**one** request. The review answer rides along on a request that was being made
anyway; it is never the reason for a request of its own.

### The three rules, and what each one is protecting

1. **Add a decision only where it replaces a generation or avoids work.**
   Cost is not the constraint at these prices — latency is. A generation is
   seconds; a decision is a few hundred milliseconds, so replacing one is a
   large win. Bolting a decision onto a path that was already fast makes it
   slower for nothing.
2. **A decision may raise a bar, stop a run, or skip work. Never lower a bar,
   permit what was forbidden, or act in place of a person.** Calibration
   describes *groups* of predictions, not any individual answer. The model is
   also, by its own documentation, vulnerable to adversarial content — and a
   web page is exactly that. This rule is the real mitigation, not a formality.
3. **Ask everything about one state at once; never open a request for a
   question that is only speculative.**

### Point, don't write

Filling a form looks like writing and is not. The agent already holds the
values, so `browser_pursue` takes `entities` — label/value pairs — and one
decision picks both the field and which known value goes in it.

Two properties fall out. A form is filled without generating a single
character, and **the text typed can only ever be one the caller supplied**:
there is no path from model output to keyboard. The option list carries an
explicit "none of these belongs here", so a field with no match hands control
back rather than taking the closest thing. Native dropdowns work the same way —
`control::option` pairs drawn from the snapshot, and the browser refuses any
option it did not hand out.

### Asking in the direction of the action

TypeSafe publishes the model's jaggedness, and one item is a hard constraint
here: **a statement and its negation do not sum to one.** So every question is
asked in the direction of the action it licenses. `routineHasWork` asks whether
the routine has *nothing* to do, because skipping is what a "yes" causes.
Reading a low "is there work" as a high "there is none" would be inferring an
answer that was never given.

Two more from the same list: counting, arithmetic and dates are unreliable, so
nothing here asks for one — where a number matters, code computes it and the
model is asked what it *means*. And a large state full of irrelevant detail
costs accuracy, which is why every state is capped and the browser snapshot
sends only text actually on screen.

---

## 5. Failure modes

| Symptom | Cause | What happens | What to do |
|---|---|---|---|
| Decisions never fire | No key, or `JEV_DECISIONS_ENABLED=0` | Every caller's fallback; product behaves as before | §3.2 |
| Decisions fire, nothing changes | Answers below the caller's confidence bar | Fallback, correctly | Expected on ambiguous states. Persistent → the state is too large or too noisy |
| Timeouts | `JEV_TIMEOUT_MS` too low for the network | Fallback per request | Raise toward 30000. A decision answers in 70–500ms, so a timeout is the network, not the model |
| An answer that was never offered | Provider returned an option outside the set | Rejected by `validAnswer`, fallback taken | None. This is the guard working |
| Same answer for a changed page | Cache hit | Stale decision | Check the key covers what changed — it keys on model, state, and every question with its criteria |
| Routing never picks anything | `JEV_ROUTER_MODELS` empty or malformed JSON | Deployment default | It is a JSON array; a parse failure is silent by design |

---

## 6. Cost and latency

`typesafe/jev-1.13` bills **$0.042 per million input tokens and nothing on
output**. A decision answers in **70–500ms**.

Plan by *requests*, not questions. One request with thirteen questions is
roughly a tenth the wall-clock and a twelfth the cost of thirteen requests, so
the optimisation that matters is always bundling — and the cache means a page
that did not change, or a tool called twice with the same arguments, costs
nothing the second time.

---

## 7. Privacy

A decision sends the state its question is about to a third party:

- tool-call arguments,
- a search query and its result snippets,
- the visible text and control names of a page,
- the newest user message, when routing,
- **an excerpt of each durable memory document**, when ordering them.

That last is the most sensitive on the list, because durable memory is whatever
the user chose to keep. For workloads that cannot share it, leave the layer off
entirely: every caller keeps its previous behaviour and memory stays in recency
order. There is no partial switch for memory alone.

---

## 8. Adding a decision

1. Check it against all three rules. Most ideas fail the first, and the ones
   that pass usually belong in a bundle that already exists.
2. Build the question with `choice` / `score` / `noul` from `@cadre/core`.
3. Read the answer through `actionableChoice` or an explicit confidence check —
   **never `answer.choice` directly.**
4. Write the fallback first and test it: no provider, a hedged answer, an option
   that was never offered, and a failed request all have to land somewhere sane.
5. Add a row to the table in [`jev.md`](./jev.md).

Two that were built and removed, so they are not proposed again: **skipping a
routine occurrence** (needs a cheap change feed nothing here produces — asking
connectors for one costs the work the skip would save) and **choosing who takes
a handoff** (the name is written in a generation that was happening anyway, so
the decision replaces nothing and only adds a round trip).
