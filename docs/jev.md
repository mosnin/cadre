# Typed decisions (Jev)

This is the running record of where Rakazo uses a decision model instead of a
chat model, why each one is there, and what it falls back to. Add a row when you
add a decision; the table is the inventory.

## What a decision model is

Jev is a System One model. It does not write. It takes a **state** and a set of
**typed questions** and returns, per question, the answer plus a calibrated
probability for every option:

- **choice** — one option from a set you define.
- **score** — a position on an ordered rubric you define.
- **noul** — the probability that a statement is true.

Many questions travel in one request, including speculative ones the caller
discards. Through OpenRouter's Decisions API (`POST /api/alpha/decisions`) the
default model `typesafe/jev-1.13` bills **$0.042 per million input tokens and
nothing on output**.

## The rule

> Add a decision only where it **replaces a generation** or **avoids work**.
> Never where it is purely additive on the hot path.

Cost is not the constraint at these prices; latency is. Every decision is a
network round trip. Replacing a generation is a large win because a generation
is seconds and a decision is a few hundred milliseconds. Bolting a decision onto
a path that was already fast makes that path slower for nothing.

## The second rule

> A decision may raise a bar, stop a run, or skip work. It may never lower a
> bar, permit something that was forbidden, or act in place of a person.

Calibration describes groups of predictions, not any individual answer. Nothing
here is the last thing between an agent and an irreversible action.

## Where it is used

| Decision | Replaces | Question | Falls back to |
| --- | --- | --- | --- |
| Tool-call review (`runDecisionReview`) | A full judge **generation** per consequential call | `choice` pass/ask, plus a speculative `choice` of concern category | The generative judge, unchanged |
| Connector consequence (`escalateConnectorConsequence`) | Nothing; **closes a gap** in the name regex | `noul` "does this change anything outside this workspace?" | The name check's own verdict |
| Stuck run (`runIsStuck`) | Nothing; **catches what the hash guard cannot** | `noul` "is this repeating work that already failed?" | Continuing into the next segment |
| Run model routing (`routeRunModel`) | Nothing; **avoids** paying frontier prices for simple turns | `choice` over the configured pool | The deployment default |
| Search ranking (`rankWebSearchHits`) | Nothing; **avoids** fetches and context on results that answer nothing | One `score` per result, one request | The engine's own order |
| Browser action (`planBrowserAction`) | A **generation** per browser step | `choice` operation + speculative `choice` per operation's targets + `choice` of which known value fills the field + `choice` of dropdown control and option together | The agent deciding, as today |
| Routine skip (`routineHasWork`) | Nothing; **avoids an entire run** | `noul` "is there anything to do this time?" | Running the occurrence |
| Handoff target (`chooseHandoffBot`) | A name written in prose | `choice` over the bot directory | The model's own pick |

`escalateConnectorConsequence` is the one that is purely additive on latency, and
it is deliberately narrow: it is asked **only** for connector calls the name check
already cleared, which is the one place that regex can be wrong in the dangerous
direction. It has been wrong there twice.

## Filling a form without writing anything

Filling a field looks like a writing task and is not. The agent already holds the
values; which known value belongs in which field is a mapping over a closed set.
So `browser_pursue` takes `entities` (label and value pairs) and the decision that
picks the field also picks the value, in the same request.

Two things follow. A form is filled without generating a single character, and
the text typed can only ever be one the caller supplied: there is no path from the
model's output to the keyboard. The option list also carries an explicit "none of
these belongs here", so a field with no matching value hands control back instead
of being filled with the closest thing.

This is the one idea worth taking from Cua-S1, whose planner points at source
entities rather than writing values for the same reason.

## Waiting only as long as the page needs

A decision arrives in a few hundred milliseconds, so a fixed wait after every
action is what a browser step actually costs. The driver used to sleep a fifth of
a second after each one and then poll `document.readyState`.

It now waits for two animation frames instead, which is what a rerender takes,
and gives up at 50ms. Only filling a combobox waits longer, and only until its
suggestions are genuinely on screen — a visible `[role="option"]` under the
field's own `aria-controls` or `aria-owns` — capped at 200ms. A navigation keeps
the old wait, because a navigation that has been asked for has not yet replaced
the document and there is nothing to observe.

The wait runs in an isolated world beside the page, so the page cannot see it and
the page's own overrides of `requestAnimationFrame` or `setTimeout` do not apply.
The same world reads the page's **visible** text for the snapshot: an offscreen
article body or a footer filled the model's context without saying anything about
the screen being acted on.

## Pointing at a dropdown option

A native dropdown has no on-screen list to click — Chromium renders it outside
the page — so it was unusable. A snapshot now carries each dropdown's own choices,
and `SELECT` picks the control and the option in a single question whose answers
are `control::option`. The browser refuses any option that was not in the snapshot
it handed out, so this is the same "point, don't write" property as filling a
field: nothing a model composed reaches the page.

`WAIT` exists for a page that is still working, and spends at most two of a
pursuit's steps; a third means the pursuit is blocked, not patient.

## Confidence, and why there is no global threshold

Probability compares the options. Confidence says whether the model had enough to
go on at all. An answer can put 0.9 on one option and still carry low confidence,
and that is exactly when not to act.

`DECISION_CONFIDENCE` in `packages/core/src/decisions.ts` names three bars, and
each caller picks the one that matches what a wrong answer costs:

- `advisory` (0.35) — ordering and ranking, which a person can ignore.
- `routing` (0.55) — choosing a path the run then takes.
- `consequential` (0.80) — anything that touches the outside world unattended.

Two places use them asymmetrically on purpose:

- Review takes `routing` to **ask** and `consequential` to **pass**. Stopping to
  ask costs a moment; waving a consequential action through on a shaky read costs
  the action.
- Routine skip takes `consequential` to **skip**. A run that happened when it
  needn't is visible in the thread; one that silently didn't is not.

## Configuration

```bash
JEV_DECISIONS_ENABLED=1     # 0 turns every decision off
JEV_MODEL=typesafe/jev-1.13 # the decision model
JEV_API_KEY=                # only if decisions should not use OPENROUTER_API_KEY
JEV_TIMEOUT_MS=6000         # per request; 500 to 30000
JEV_ROUTER_MODELS='[...]'   # the model pool; empty means no routing
```

With no key, every caller keeps the behaviour it had before the decision layer
existed. That is not a courtesy, it is the contract: no hosted vendor is required
to run the core product.

## What it cannot do

It does not write, so anything that has to be worded still needs a chat model. It
does not extract spans. It does not take images. And it is never the only thing
standing between an agent and something irreversible.

## Privacy

A decision sends the state its question is about to a third party: the arguments
of a tool call, a search query and its result snippets, the text and control names
of a page, or the newest user message when routing. Leave it off for workloads
that cannot share that context.

## Adding one

1. Check it against both rules above. Most ideas fail the first.
2. Build the question with `choice` / `score` / `noul` from `@rakazo/core`.
3. Read the answer through `actionableChoice` or an explicit confidence check,
   never `answer.choice` directly.
4. Write the fallback first and test it: no provider, a hedged answer, an option
   that was never offered, and a failed request all have to land somewhere sane.
5. Add a row to the table above.
