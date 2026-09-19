# Typed decisions (Jev)

This is the running record of where Cadre uses a decision model instead of a
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
| Run floor (`assessRunFloor`) | Nothing; **catches what the hash guard cannot**, in the Foreman shape | One request: `noul` stuck, off-track, and needs-a-person | Continuing into the next segment |
| Run model routing (`routeRunModel`) | Nothing; **avoids** paying a strong Qwen for simple turns | `choice` over the Qwen pool (or `JEV_ROUTER_MODELS`) | The deployment default (`qwen/qwen3-235b-a22b`) |
| Skill suggestion (`suggestSkill`) | Extra `skill_read` **generations** on a large catalog | One request: `noul` "is a skill needed?" plus speculative `choice` of skill | The catalog line, unread |
| Company focus (`suggestCompanyFocus`) | A **generation** that guesses which Company OS records to pull | `choice` over overview, goals, customers, product, constraints, decisions, department | The company-context skill's own order |
| Search ranking (`rankWebSearchHits`) | Nothing; **avoids** fetches and context on results that answer nothing | One `score` per result, one request | The engine's own order |
| Catalog ranking (`rankCatalogHits`) | Loading the **wrong connector tool** | One `score` per shortlisted tool, one request | The keyword order |
| Memory order (`rankMemoryDocuments`) | A **recency sort** that decided which saved facts a run would never see | One `score` per document, one request | The recency order, unchanged |
| Fetch screen (`screenUntrustedText`) | Nothing; **raises a bar** on pages that try to instruct the agent | `noul` "is this a jailbreak or override?" | The page, unlabeled |
| Browser action (`planBrowserAction`) | A **generation** per browser step | `choice` operation + speculative `choice` per operation's targets + `choice` of which known value fills the field + `choice` of dropdown control and option together | The agent deciding, as today |
| Symbolic find / check / triage | A **generation** that reviews its own diff, files, or log | Scores, nouls, and a closed failure `choice` over evidence the agent already gathered | No findings, with `notChecked` filled |

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

## Ordering is what the ceiling makes of it

A run carries the user's and the bot's durable memory up to a byte ceiling, and
whatever does not fit is dropped. That made the sort order a silent decision
about which facts the run would never see, and the order was recency — so a fact
saved months ago was cut for its age rather than its irrelevance.

Scoring each document against the task fixes both halves: the model reads less
that has nothing to do with the task, which its own documentation says makes it
more accurate, and the document that matters survives the ceiling. It only
reorders. Nothing is dropped that would otherwise have fitted, because a memory
is a fact the user chose to keep and a low score is not a reason to hide one, and
a document the model will not judge keeps the slot it arrived in.

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
JEV_ROUTER_MODELS='[...]'   # the model pool; unset uses Qwen 8b + 235b; [] or 0 turns routing off
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
of a page, a fetched page when screening it, file excerpts or a diff when judging
code, skill names and descriptions when suggesting one, the newest user message
when routing or choosing a company-records starting point, or **an excerpt of each durable
memory document** when ordering them. That last one is the most sensitive on the
list, because durable memory is whatever the user chose to keep. Leave it off for
workloads that cannot share that context; with no key every caller keeps the
behaviour it had, and memory stays in recency order.

## Adding one

1. Check it against all three rules above. Most ideas fail the first, and the
   ones that pass usually belong in a bundle that already exists rather than in a
   request of their own.
2. Build the question with `choice` / `score` / `noul` from `@cadre/core`.
3. Read the answer through `actionableChoice` or an explicit confidence check,
   never `answer.choice` directly.
4. Write the fallback first and test it: no provider, a hedged answer, an option
   that was never offered, and a failed request all have to land somewhere sane.
5. Add a row to the table above.
