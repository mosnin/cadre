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
discards. TypeSafe measures a request of thirteen questions over one document at
**10x faster and 12x cheaper** than thirteen requests, with the same answers:
questions are evaluated in parallel and in isolation, and the state — the
expensive part — is paid for once. A decision answers in **70–500ms**.

`typesafe/jev-1.13` bills **$0.042 per million input tokens and nothing on
output**. Two endpoints serve it, and `packages/adapters/src/jev-decisions.ts`
speaks both: TypeSafe's own (`POST api.typesafe.ai/v1/systemone`, through the
vendor SDK, one hop shorter) when `TYPESAFE_API_KEY` is set, and OpenRouter's
Decisions API (`POST /api/alpha/decisions`) otherwise, because most deployments
already hold that key. Nothing above the adapter can tell which answered.

## The rule

> Add a decision only where it **replaces a generation** or **avoids work**.
> Never where it is purely additive on the hot path.

Cost is not the constraint at these prices; latency is. Every decision is a
network round trip. Replacing a generation is a large win because a generation
is seconds and a decision is a few hundred milliseconds. Bolting a decision onto
a path that was already fast makes that path slower for nothing.

## The third rule

> A question is free; a **request** is not. Ask everything about one state at
> once, and never open a request for a question that is only speculative.

This is the whole shape of `packages/adapters/src/decision-turn.ts`. Two things
used to be asked about the same tool call, one after the other, each carrying its
own copy of the same state. They now travel together, and the review question —
which is read only if the gate reaches a judge — rides on the request that was
being made anyway. It is never the reason for a request of its own.

Answers are also remembered. `decision-cache.ts` keys on the model, the state and
every question with its criteria, so anything that would change an answer changes
the key, and a page that did not change or a tool called twice with the same
arguments costs nothing the second time. Identical requests in flight together
share one.

## The second rule

> A decision may raise a bar, stop a run, or skip work. It may never lower a
> bar, permit something that was forbidden, or act in place of a person.

Calibration describes groups of predictions, not any individual answer. Nothing
here is the last thing between an agent and an irreversible action.

## Where it is used

| Decision | Replaces | Question | Falls back to |
| --- | --- | --- | --- |
| Tool call (`decideToolCall`) | A full judge **generation** per consequential call, and **closes a gap** in the name regex | One request: `noul` "does this change anything outside this workspace?", plus a speculative `choice` pass/ask and `choice` of concern category | The generative judge, and the name check's own verdict |
| Stuck run (`runIsStuck`) | Nothing; **catches what the hash guard cannot** | `noul` "is this repeating work that already failed?" | Continuing into the next segment |
| Run model routing (`routeRunModel`) | Nothing; **avoids** paying frontier prices for simple turns | `choice` over the configured pool | The deployment default |
| Search ranking (`rankWebSearchHits`) | Nothing; **avoids** fetches and context on results that answer nothing | One `score` per result, one request | The engine's own order |
| Browser action (`planBrowserAction`) | A **generation** per browser step | `choice` operation + speculative `choice` per operation's targets + `choice` of which known value fills the field + `choice` of dropdown control and option together | The agent deciding, as today |

The consequence question is the one that is purely additive on latency, and it is
deliberately narrow: it is asked **only** for connector calls the name check
already cleared, which is the one place that regex can be wrong in the dangerous
direction. It has been wrong there twice. Because it is being asked anyway, the
review verdict costs nothing but tokens to ask alongside it.

## Two that were built and removed

Worth recording so they are not proposed again.

**Skipping a routine occurrence** would be the largest saving here — the run it
avoids is the whole cost — but it needs a cheap summary of what changed since the
last occurrence, and nothing in this product produces one. Asking connectors for
it would cost the work the skip was meant to save. It goes back in when a change
feed exists, not before.

**Choosing who takes a handoff** fails the first rule. The name is written in the
same generation that was going to happen regardless, so a decision replaces
nothing and only adds a round trip.

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

## What it is bad at, and what that forbids

TypeSafe publishes the model's jaggedness, and three items on that list are
constraints on this code rather than trivia:

- **A statement and its negation do not sum to one.** So a question is always
  asked in the direction of the action it licenses. `routineHasWork` asks whether
  the routine has *nothing* to do, because skipping is what a "yes" causes;
  reading a low "is there work" as a high "there is none" would be inferring an
  answer that was never given.
- **Counting, arithmetic, dates and ordered quantities are unreliable.** Nothing
  here asks for one. Where a number matters, code computes it and the model is
  asked what it means.
- **A large state full of irrelevant detail costs accuracy.** Every state on this
  path is capped and trimmed, and the browser snapshot sends only the text that is
  actually on screen for exactly this reason.

It is also, by its own documentation, vulnerable to adversarial content — which is
what a web page is. That is the second rule's real justification, not a
formality.

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
TYPESAFE_API_KEY=           # TypeSafe directly; preferred when set
JEV_API_KEY=                # OpenRouter, if not OPENROUTER_API_KEY
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

1. Check it against all three rules above. Most ideas fail the first, and the
   ones that pass usually belong in a bundle that already exists rather than in a
   request of their own.
2. Build the question with `choice` / `score` / `noul` from `@rakazo/core`.
3. Read the answer through `actionableChoice` or an explicit confidence check,
   never `answer.choice` directly.
4. Write the fallback first and test it: no provider, a hedged answer, an option
   that was never offered, and a failed request all have to land somewhere sane.
5. Add a row to the table above.
