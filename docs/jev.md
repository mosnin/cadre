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

This is the whole shape of `packages/adapters/src/decision-turn.ts` and
`decision-start.ts`. Tool-call review used to be two requests about the same
call; start used to be routing, then skill, then company, each about the same
task. They now travel together. Speculative questions — the review verdict, the
skill name, the URL to fetch, the browser step after this one, the injection
screen on a ranking request — ride on the request that was being made anyway.
They are never the reason for a request of their own. The start request also
runs beside credential lookup, plugin sync, and connector discovery, so its
70–500ms is not added to the critical path. When the first action is a fetch or a short search, that tool starts the
moment start resolves — overlapping connector discovery, memory ranking, and
provision — so the result is already in the task. A run with no model
swallows that in-flight prefetch the same way it swallows provision. Computer
provision starts beside start, credential lookup and plugin sync once a
model is already named without that work, so a warm machine is not paid for
after those return. Override-credential lookup and live plugin sync run
together; model-key resolution starts as soon as the credential is known,
so a Composio listing no longer sits in front of the API key. A run with
no model never starts either.
The start request begins beside credential lookup and plugin sync — it only
needs the task, the skill list, and whether anyone already named a model —
so those waits no longer stack in front of it. Durable memory ranking, the
scratchpad, current-turn images, and semantic recall start on the same
beat: none of them read connectors, so a Composio listing no longer sits
in front of the memory request either.
Fetch and search start the moment start returns, so they no longer wait
for discovery or memory either.
Attached-file bytes start downloading beside start — they do not need the
computer — and are written to the workspace once the machine is up.
The first generation starts as soon as credentials resolve unless the first
action is `browse` or the user attached files — those need the machine now.
Fetch and search still wait for the prefetch they already started, so the
page or hits can be inlined. Attached files write before browse starts, so
the two do not share the computer at once.
Answer, search, fetch, skill, company, code, and computer generate while
the boot continues. A company-first start injects company-context and
connected-workspace together when this run has a workspace identity, so
Operate, Stored, and Company OS do not each cost a `skill_read`
generation on a run that can use them. Fetch, search, and skill-first
answers are kept only when the harness can act: a URL already in the
task, a short query that is already the user's wording, or a named
skill — including when first already chose `skill` and the needed noul
was shy. A commitment the prefetch or injection path cannot use is
dropped so the model is not told to repeat work that never started.
A prefetch that fails degrades the same way: the page stays out of the
prompt and the model fetches. A later `web_search` or `web_fetch` does not wait either.
The first tool that touches the workspace waits on the same provision
promise, which a generation has usually already outlasted.
When the first action is `browse`, or `computer` with a URL already in the
task, pursuit starts the moment start says so and the computer is up —
overlapping connector discovery, memory ranking, key resolution, and prompt
assembly — so the first generation sees the page that was already acted on
instead of spending a turn deciding to call `browser_pursue` or
`browser_observe`. The live browser worker keeps one CDP session across
those steps, so a click is a decision plus a protocol call rather than a
new Python process and a new websocket. The same page is untrusted data,
like a tool result: `<fetched_page>`, `<search_results>`,
`<browser_progress>`, and `<browser_page>` never override the user's
request. A run that only learns the model after start kicks the same
pursuit once provision begins. Group context, messaging identity, approved-effect replay,
prior progress, the bot directory, and saved logins start beside computer
provision, so those reads overlap the boot instead of waiting for it.
Helper routing starts before the helper waits for a slot, so a queued delegate
does not pay for the decision after it is already allowed to run. A thread
already over the history window starts compacting at the beginning of the run —
the same job the end of the run would have queued — so the summarizer overlaps
this turn instead of sitting on the next one's critical path.

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
| Tool call (`decideToolCall`) | A full judge **generation** per consequential call, and **closes a gap** in the name regex | One request: `noul` consequence when the name cleared the call, plus `choice` pass/ask and concern when a default-rule judge will run — including mutation-named tools the name already flagged | The generative judge, and the name check's own verdict |
| Run floor (`assessRunFloor`) | Nothing; **catches what the hash guard cannot**, in the Foreman shape | One request: `noul` stuck, off-track, and needs-a-person | Continuing into the next segment |
| Run start (`decideRunStart`) | Two extra start-of-run **requests**, a `skill_read` **generation**, and the first `web_fetch` / `web_search` **generation** | One request: `choice` first action, speculative `choice` of model / skill / company area / URL, `noul` "is a skill needed?" — then only the first step the harness can act on is kept (a named skill, a URL already in the task, or a short search that is already a query) | Each field unset: the deployment default, the catalog unread, the skill's own order, the agent deciding |
| Search ranking (`rankWebSearchHits`) | Extra **fetches** on a shortlist that already answers | One request: a `score` per result plus `noul` "already answered?" and the injection `noul` | The engine's own order, and the agent fetching |
| Catalog ranking (`rankCatalogHits`) | Loading the **wrong connector tool** | One request: a `score` per shortlisted tool plus the injection `noul` over their descriptions | The keyword order |
| Memory order (`rankMemoryDocuments`) | A **recency sort** that decided which saved facts a run would never see | One request: a `score` per document plus the injection `noul` | The recency order, unlabeled |
| Fetch screen (`screenUntrustedText`) | Nothing; **raises a bar** on pages that try to instruct the agent | `noul` "is this a jailbreak or override?" | The page, unlabeled |
| Browser page screen | Nothing on `browser_observe` / `browser_act`; **free** on `browser_pursue` because it rides the action request | The same injection `noul`, asked beside the step when the page already has enough text | The page, unlabeled |
| Connector result screen (`labelUntrustedToolResult`) | Nothing; **raises a bar** on mail, issues, and other connector payloads that try to instruct the agent | The same injection `noul` over the string fields the model reads | The payload, unlabeled |
| Browser action (`planBrowserTurn`) | A **generation** per browser step, the **next** step's request when the page still has that control, a **navigate** generation that would invent a URL, and the **first** browse generation when start already chose `browse` or `computer` with a URL | One request: `choice` operation + speculative targets + the same questions prefixed `next_` + which known value fills the field + dropdown control and option together + which goal URL to open | The agent deciding, as today |
| Symbolic find / check / triage | A **generation** that reviews its own diff, files, or log | Scores, nouls, and a closed failure `choice` over evidence the agent already gathered | No findings, with `notChecked` filled |

The same injection screen now also rides memory ranking: a saved fact that
tries to instruct the agent is labelled, and still kept. A low score is still
not a reason to hide one.

The consequence question is the one that is purely additive on latency, and it is
deliberately narrow: it is asked **only** for connector calls the name check
already cleared, which is the one place that regex can be wrong in the dangerous
direction. It has been wrong there twice. Because it is being asked anyway, the
review verdict costs nothing but tokens to ask alongside it. When the name
already flagged a mutation and the default path will judge, review **is** the
request: it replaces the generation that used to open after a second, empty,
decision. A rule that already asks or always-allows never reads a verdict, so
it never opens one.

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

A decision arrives in a few hundred milliseconds. The driver used to pay a
new Python process and a new DevTools websocket on every click, then sleep a
fifth of a second and poll `document.readyState`. The live worker keeps the
session, so the remaining wait is the page itself.

It now waits for two animation frames instead, which is what a rerender takes,
and gives up at 50ms. Only filling a combobox waits longer, and only until its
suggestions are genuinely on screen — a visible `[role="option"]` under the
field's own `aria-controls` or `aria-owns` — capped at 200ms. A navigation still
polls `document.readyState` briefly, because a navigation that has been asked for
has not yet replaced the document. Ordinary clicks and fills do not: settle
already waited for the rerender, and the old 2s readyState loop was most of the
step.

The wait runs in an isolated world beside the page, so the page cannot see it and
the page's own overrides of `requestAnimationFrame` or `setTimeout` do not apply.
The same world reads the page's **visible** text for the snapshot: an offscreen
article body or a footer filled the model's context without saying anything about
the screen being acted on.

CDP clicks do not move the X cursor, so a VNC viewer would see buttons activate
with no pointer. Each click warps the real cursor first via `xdotool`, using the
window chrome the snapshot already measured — no extra CDP round trip on the
click path. Desktop `computer_act` glides the pointer along a short path (a few
8ms steps) so the same viewer can follow it; settle after a batch is 80ms when
no screenshot is coming back, 150ms when one is.

## Pointing at a dropdown option

A native dropdown has no on-screen list to click — Chromium renders it outside
the page — so it was unusable. A snapshot now carries each dropdown's own choices,
and `SELECT` picks the control and the option in a single question whose answers
are `control::option`. The browser refuses any option that was not in the snapshot
it handed out, so this is the same "point, don't write" property as filling a
field: nothing a model composed reaches the page.

`WAIT` exists for a page that is still working, and spends at most two of a
pursuit's steps at 150ms each; a third means the pursuit is blocked, not patient.

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
- Routine skip used `consequential` to **skip**. That path is gone until a
  change feed exists; the bar is recorded so it is not rebuilt softer. A run
  that happened when it needn't is visible in the thread; one that silently
  didn't is not.

## Configuration

Every key below is in [`.env.example`](../.env.example), and
[`jev-install.md`](./jev-install.md) covers installing, verifying and operating
the layer — including how to tell a working install from one that is silently
falling back.


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
does not extract spans. It does not take images — so desktop `computer_act` stays
a vision generation; Jev drives the browser from the accessibility table, not
from screenshots. And it is never the only thing standing between an agent and
something irreversible.

## Privacy

A decision sends the state its question is about to a third party: the arguments
of a tool call, a search query and its result snippets, the text and control names
of a page, a fetched page when screening it, file excerpts or a diff when judging
code, skill names and descriptions when a run starts, the newest user message
when deciding that start, or **an excerpt of each durable
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
