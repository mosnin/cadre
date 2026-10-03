# Temporary sub-agents

Three layers exist in Cadre:

1. **Group chats** of agents (bots).
2. **Agents**: one-on-one chats with a bot.
3. **Sub-agents**: temporary workers an agent in either kind of chat spawns while it carries out a task.

Sub-agents are not bots. They never create `Bot` rows, never appear in bot lists or the
sidebar, and are not addressable outside their task. A sub-agent is a `Run` (trigger
`subagent`) of the *spawning bot*, in the spawning bot's thread. It runs with that bot's
identity, model resolution, approval rules and permissions, and never more.

The server follows a durable, event-driven shape: the model decides during a run; the
surrounding software keeps the state and starts the next run when needed. Nothing waits in a
worker process for long.

## Data model

`Run` gets (all optional except `subagentDepth`):

| column | meaning |
| --- | --- |
| `parentRunId` | spawning run (self relation, `ON DELETE CASCADE`), unique with `parentToolCallId` |
| `rootRunId` | run that started the whole tree |
| `parentToolCallId` | tool-call id of the `spawn_agent` call (spawn idempotency key) |
| `subagentDepth` | 0 for a top-level run, 1 for its children, 2 for theirs |
| `agentType`, `agentLabel` | agent type name and the 3-8 word description |
| `agentBackground` | spawned with `background=true` |
| `agentResult` | the child's report (partial text while running, final when settled) |
| `agentResultDeliveredAt` | set when the report reached whoever consumes it (idempotency) |
| `agentInbox` | `send_to_agent` messages waiting for a running child |
| `agentWait`, `agentWaitKey` | durable wait of a parked run: `{agentIds, mode, deadlineAt}` and its unique key |

`Bot.subagentTypes` (JSON) holds custom agent types. `AgentTask` is the plan ledger
(`id, spaceId, botId, threadId, rootRunId, title, status, assignedRunId, result, notes,
position`). Migrations: `20260921090000` to `20260921090005` (columns and table, concurrent
indexes, NOT VALID then VALIDATE foreign key, unique spawn key).

`RunSchema.trigger` and `RunActivityRowSchema.trigger` gain `"subagent"`.

A sub-agent's id (`agentId`) is its run id.

## Tools (all approval-exempt; they cannot widen permissions)

* `spawn_agent({agent_type?="general", description, prompt, model?, background?=true, task_id?})`
  Background returns `{agent_id, status:"running"}` at once. Foreground waits like
  `wait_for_agents` for that one child (and parks if it takes longer than about 5 seconds).
  The child sees only `prompt`. Spawn several in one turn for parallel work.
  An identical spawn (same type, description and prompt) in the same run returns the existing
  child.
* `wait_for_agents({agent_ids?, mode?="all"|"any", timeout_seconds?=300 (1-600)})`
  Returns statuses and reports at once if the condition holds (reports clipped to 12,000
  characters each, marked `truncated`). Otherwise it holds a worker for at most about 5 seconds, then
  **parks durably** (see below).
* `send_to_agent({agent_id, message})` queues a message for a running child (read at its next
  step) or resumes a finished child with a new turn. Allowed only while the child's root tree is
  still active; otherwise the result is `sub-agent closed`.
* `cancel_agent({agent_id, reason?})` cancels the child and its descendants and returns partial
  output.
* `list_agents()` lists this run's sub-agents and theirs with status.
* `update_plan({tasks:[{id?, title?, status?, notes?}]})` upserts the plan ledger. Status is
  `pending|running|done|blocked|cancelled`. Entries with an id update that task; entries without
  create one. Omitted tasks stay unchanged. `task_id` on `spawn_agent` attaches the child's result.

`run_subagent` (in-turn helper) is unchanged.

Limits come back to the model as tool results, never exceptions. Constants live in
`packages/adapters/src/run-guardrails.ts`: `MAX_SUBAGENT_DEPTH=2`,
`MAX_CONCURRENT_SUBAGENTS_PER_ROOT=8`, `MAX_SUBAGENTS_PER_ROOT=32`, tree token budget
`maxTreeTokens() = maxRunTokens()*2` (sum of `UsageRecord` tokens across the tree; new spawns
are refused and running children are cancelled once exceeded), per-child lifetime
`maxSubagentLifetimeMs() = maxRunDurationMs()*2` (the reconciler fails an older child).

## Agent types (`packages/core/src/agent-types.ts`)

Built in: `general` (parent's tools minus tools that reach the user, create persistence, cross a
security boundary, use the screen or Cadre Code), `researcher`, `planner`, `reviewer`
(read-only: read/list files, memory recall, web, skills, scratchpad list, read-only connector
tools; reviewer also `code_status`/`code_diff`), `coder` (the `code_*` tools; only if the parent
has them), `operator` (computer tools; only if the parent has them).

A child's tools are the spawning run's tools intersected with its type, applied through every
ancestor, so a child never holds a tool its parent lacks. Never given to any child:
`message_user`, `ask_user`, `request_secret`, `request_takeover`, `run_subagent`, bot
delegation and messaging, `schedule_*`, `create_space`, `add_mcp_server`. Spawn tools and
`update_plan` are removed at depth 2. Executing a tool outside the child's set is refused.

Custom types: `bot.subagentTypes: [{name, description, instructions, tools?, model?}]`, at most
12, `name` matches `/^[a-z][a-z0-9-]{1,31}$/`, unique; set through `bots.update` (zod
validated). A custom type replaces a built-in of the same name. Model precedence: explicit
`model` argument, then the type's model, then the bot's model.

## Child execution

`continueRun` runs a `subagent` run like any other (same lease, attempt, retry and
`ExternalEffect` replay machinery), with these differences: instructions are the bot's base
identity and safety lines, the agent type's instructions and a sub-agent preamble; the only
user message is the task prompt (no thread history, no group context, no messaging notes); tools
and model as above; no computer execution lease and no screen release (it shares the spawner's
computer and screen lease); no `thread.progress`, tool or narration messages. Segment and
unattended policy follow the root run's trigger.

Approvals work as for any run: the ask card goes to the thread, the user's answer resumes the
child (`answerRunInput`). While waiting, the child is `blocked`.

## The six pieces

1. **Coordinator**: the spawning agent's model (decisions) plus `subagents.ts` (state transitions).
   Code: `spawnSubagent`, `resolveParkedWait`, `createContinuation`.
2. **Workers**: child `Run`s executed by the existing worker. Code: `executor.ts`
   (`isSubagent` branches), `narrowToolsForSubagent`, agent types in core.
3. **Persistent state**: `Run` columns above, `AgentTask`, `UsageRecord`. Every decision in
   `subagents.ts` reads and writes these rows; nothing lives in process memory. The ledger is shown
   in the coordinator's instructions on every run of that bot and thread (`renderPlanLedger`).
4. **Messages/events**: `thread.subagent` (child lifecycle), `agent.waiting` and
   `agent.resumed` (parent), a durable card message per child, steering notices
   (`claimAgentSteering`), `agent_inbox` for `send_to_agent`.
5. **Background execution**: `wait_for_agents` never holds a worker for long. If the awaited
   children are not done within the grace period, the run records `agentWait` on itself and
   `agentWaitKey`, emits `agent.waiting`, and ends its turn (a top-level run completes, a
   sub-agent parks as `waiting_input` with a wait record). Completion handlers
   (`settleSubagent` -> `onChildTerminal`, `cancelRunTree`, `afterRunEnded`) call
   `resolveParkedWait`. When the condition holds (all/any) or `deadlineAt` passed
   (reconciler), exactly one continuation is created: a `follow_up` run with
   `clientNonce = agent-wait:<key>` (unique) for a top-level parent, or the same sub-agent run
   queued again with the reports as its next message. The prompt carries each report as a
   delimited, escaped data block and lists children still running on timeout. Reports of children
   nobody awaits take the same event path: delivered to the parent run's steering while it
   runs, otherwise a continuation for the spawning bot once it is idle.
6. **Reliability controls**: spawn idempotency (unique `(parentRunId, parentToolCallId)` plus the
   identical-spawn check); crash recovery through the existing reconciler (queued and expired-lease
   runs are re-enqueued, effects replay from `ExternalEffect`); per-child lifetime fail with
   parent notice (`reconcileSubagents`); claim-based delivery (`agentResultDeliveredAt`, `agentWaitKey`
   cleared atomically) so duplicate events cannot double-deliver; cancel cascade through
   `stopThreadRuns`, `clearThread`, the executor's 1 s poll, and the reconciler; stopping or
   clearing a thread clears parked waits so cancelled children never resume the task.

## Groups

In a group thread any member bot can spawn. The child runs as the spawning bot in the group
thread. Reports and continuations go to the spawning bot only: the continuation is a plain
`follow_up` run of that bot with no source message, so no handoff or mention routing happens and
no other member is woken. Children never load group context. Blocks carry `spawnedByBotId`
(and `spawnedByBotName`) so a group transcript can show who spawned each card.

## Lifecycle and closing

Sub-agents are temporary. A tree is active while its root or any of its runs is active. When
it is finished, finished children are closed: `send_to_agent` returns `sub-agent closed`. Each
child's report stays on its `Run` (`agentResult`) and its card message stays in the thread. A
continuation is a new root run and manages earlier children only while they are still running.

## Visibility and busy checks

Sub-agent runs are excluded from every "thread busy" check (user send steering, reaction
wake, snapshot `run`/`activeRuns`, latest-terminal lookup) so a user message starts its own run
beside the children. Their `thread.progress`, tool and `run.*` events (except
`run.waiting_input`) are not streamed to clients; `thread.subagent`, `agent.waiting`,
`agent.resumed`, approval cards and the child's final card are. Snapshots add the live
`thread.subagent` events of running children.

## Contract

`thread.subagent` payload and the `subagent` message block (`SubagentBlockSchema`, all new
fields optional):

```
kind: "subagent"
agentId: string            // child run id
name: string               // the 3-8 word description
task: string               // the prompt, clipped to 1,000 characters
status: "running" | "blocked" | "completed" | "failed" | "cancelled"
progress?: string          // latest activity
result?: string            // report (clipped to 12,000 characters)
runId?: string
parentAgentId?: string | null   // spawning sub-agent's run id, null when a top-level run spawned it
depth?: number                  // 1 or 2
agentType?: string
spawnedByBotId?: string         // bot that spawned it (group transcripts)
spawnedByBotName?: string
taskId?: string                 // plan ledger task
model?: string
background?: boolean
usage?: { inputTokens, outputTokens }
steps?: [{ label, count }]      // tool usage counts
```

`blocked` means waiting on a person (approval). Old clients that only know the original
four statuses will fail to parse `blocked` and `cancelled`; the original block shape is
unchanged. `agent.waiting` payload: `{agentIds, mode, deadlineAt}`. `agent.resumed` payload:
`{reason: "completed"|"timed_out", agentIds, parentRunId}`. Both are new `ProductEventType`
values: clients must ignore unknown event types.

Live projection (`projectMessages`): each child is one card keyed by `agentId`; nested cards
carry `parentAgentId` and `depth`; a durable card replaces the live one; a live card whose run
ends without a final card is closed from the `run.*` event. A child resumed after finishing
publishes a second card with the same `agentId`.

## Existing features and gaps

* Group handoff (`handoff_to_bot`), `message_bot` callbacks (`returnBotMessageOutcome`,
  `botOutcomeReturnedAt`, reconciler backstop) and routines (`wakeRoutine`, reconciler lookahead)
  already follow the same shape: state in rows, a job per wake, idempotent claim, reconciler repair.
  Child bots reuse `ensureSpawnRun`.
* Gaps: the reconciler runs every 30 s, so wait deadlines are honored to that granularity;
  `message_bot` delivery can still be lost if the process dies between commit and enqueue
  (the reconciler repairs it, with latency); no end-to-end test runs against Postgres in
  this repo's offline suite, so the orchestration is verified against an in-memory model of the
  tables; steering is read only at model turn boundaries, so a child's `send_to_agent` message
  waits for its current model call.
