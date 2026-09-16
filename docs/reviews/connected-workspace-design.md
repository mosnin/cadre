# Connected workspace

Status: implemented; release checks pending. Brief: cadre-connected-workspace, revision 2.

## Person and tension

A person wants to delegate work, return to its progress, and understand which business an agent represents. The reported interface obscures company identity, overloads navigation, and separates setup into unrelated dialogs. These are user reports, supported by supplied screenshots. The PWA blank state is reported; its exact device failure has not been reproduced.

## Three mechanisms

1. **Work unfolding in place.** Start with one setup sequence. Its selected workspace, company and agent become the persistent location of the resulting conversation. Related company context and computer open alongside the work. A full workspace navigator is summoned when changing work, then recedes. It does not occupy a permanent sidebar column. This keeps orientation and avoids repeated setup.
2. **A work timeline.** Setup decisions, agent work and results share a chronological stream. Excellent continuity for one task, but settings and company identity become hard to find across many simultaneous tasks. Preserve its useful idea: return to the exact interrupted setup step.
3. **A spatial desk.** Conversations, agents, company documents and computers occupy movable surfaces. Direct relationships could be expressive on a large display, but manual arrangement introduces work and loses predictable location on a phone. Preserve adjacent context, omit freeform positioning.

Select mechanism 1. Its original contribution is continuity from setup into the daily workspace, not unfamiliar controls. It fits existing conversations and computers, has deterministic keyboard order, and adapts to a phone without a second mental model. This is a design hypothesis, not evidence of measured usability or historical uniqueness.

## Composition

Use the first supplied reference's dominant central subject and separated contextual planes, and the second reference's clear hierarchy and restrained emphasis. The conversation is the main surface. Company context and the computer are supporting surfaces. Space and type establish hierarchy; avoid a grid of generic cards, fake statistics, decorative imagery, and redundant dividers. Retain Cadre identity and semantic tokens. Bot color remains identity, not a status signal. The semantic palette uses neutral charcoal surfaces and an off-white primary action in dark mode. Dark backgrounds, controls, text and focus rings contain no purple or navy tint. This follows the user's final palette direction. Light mode retains its separate warm palette.

## Linear workflows

- New workspace: name → connect or create Company OS business (optional) → agent → first task.
- Company connection: confirm workspace → authorize at Company OS → return to the same workspace and next unfinished step. Show connected company name and explicit connection state.
- Agent creation: name and purpose → create once → begin work. Provider setup appears only when required. Advanced instructions remain available after creation.
- First value: a useful agent response or task output based on the person's own brief. Creating a workspace alone is not activation. No promised timing while authorization/model/runtime latency is unknown.
- Back retains choices. Cancel leaves saved work intact. OAuth cancellation returns to a recoverable choice. A failed request never shows success. Workspace changes clear the previous workspace's active surfaces and queries through existing isolation contracts.

## Daily work

Current workspace and agent identify the active work. A workspace navigator opens as one full surface with a bounded reading width; selecting a conversation dismisses it. Opening navigation exposes workspaces, searchable conversations and creation. Selecting work returns focus to that work. Company connection belongs to the workspace identity and workspace settings. Account preferences, integrations, usage and other secondary controls remain reachable without dominating the conversation list. The computer retains its existing ownership, boot, control and recovery semantics.

## Scope and source inventory

Web and Electron share the component package. PWA includes narrow screens, safe areas and standalone launch. Native mobile shares contracts and tokens; native platform selection and navigation remain native as required by the product contract. No change to agent/runtime authority.

Matching roles to migrate and validate against actual directory sources:

| Roles | Directory sources | Consumers |
| --- | --- | --- |
| App navigation | Hex UI sidebar-3 | Shell navigation |
| Text entry, selection | beUI input, select, combobox, checkbox, switch, radio | Setup, account, agent, model, integration, routine and admin forms |
| Modal, popover, tooltip | beUI center-morph-modal, popover, tooltip | Shared primitives and overlays |
| Tabs, disclosure, command search | beUI tabs, bouncy-accordion, command-palette | Settings, agent surfaces, shell commands |
| Login and signup | Hex UI login-3, beUI signup-form | Auth routes |
| Messages and scrolling | beUI message, message-bubble, message-scroller | Conversation thread |
| Composer and attachments | beUI prompt-input, attachment-upload | Thread composer |
| Tool work and decisions | beUI tool-result, tool-approval, approval-card, agent-activity | Tool events, pending approvals and activity |
| Code and files | beUI code-block, file-tree, file-diff | Rendered code and computer files |
| Loading and route recovery | beUI loader, not-found-glitch | Pending operations and missing routes; no glitch effect |
| Data tables | beUI table | Admin and tabular settings where present |

Inventory is provisional until consumer audit finishes. Do not install unused catalog entries or call this source-compliant yet. Buttons, labels, separators, textareas and native controls without a matching source retain existing accessible implementations with unified tokens and sizing. Required native controls do not receive web DOM components. Actual source provenance, dependency inspection, build receipts and rendered selectors must accompany migrated roles.

## Interaction and finishing contract

- One visible next action in setup; back and optional skip remain clear.
- Keyboard labels, focus restoration, escape behavior and 44px touch targets.
- Shared icon size and stroke; no Unicode symbols used as substitute icons.
- Surface changes track user action; short interruptible transitions, immediate reduced-motion alternative. No perpetual decorative animation.
- Markdown previews become readable plain text. Agent instruction forbids em dashes; stored source and code remain intact.
- Validate empty, populated, busy, failed, long-name, disconnected and connected states at phone and desktop widths in both themes.
- Exercise reload/startup, workspace isolation, company return, create agent, chat, computer and all existing secondary actions.
- Source/build gate, rendered Design OS review, then Details review on the same final revision. Screenshots and passing checks are evidence, not proof of user-observed ease.

## Context provenance

Repository-local product context and semantic token sources; no authenticated Symbolic project binding established. User-supplied references and explicit full UI replacement instruction govern this redesign. The requested Component OS sources override the repository's older official-registry-only preference for these matching roles. No tenant identity is inferred from the repository name.

## Source version recovery

The live beUI registry had changed since the installed directory was pinned. Reconstructed its historical registry items from upstream `starc007/ui-components` commit `8d3fa7b4b3b4d74f53ea7096d5eb59e4479c0340`, retaining the registry's source banner and file order. The resulting Popover, Message, and Command Palette JSON bytes exactly match the directory's SHA-256 records. Private snapshots remain outside tracked source. Adapted implementations retain later accessibility and search fixes with inspectable diffs. The source checker is unchanged.

## Current verification

The full local browser run passed 93 of 95 checks. The two failed checks were test synchronization and hidden-navigation selector assumptions; both passed after correction. The final affected-surface run passed all 12 checks on the charcoal build, including library recovery, accessibility assertions and connection controls after browser history restoration. CI remains the integration gate. Deterministic browser checks have passed workspace setup and draft restoration, company connection controls, library create/edit/import/export, keyboard navigation, password recovery, model search, group conversations and computer takeover. Unit checks cover plugin validation, scoped reference reads, appearance preferences and native theme compatibility. A successful deterministic test does not establish real provider authorization or deployment.

Real Company OS consent and a live company context read still require a signed-in provider session. Native device rendering and binary publication remain unverified. No claim of measured usability, historical uniqueness, independent review, or whole-product acceptance is made.

## Additional accepted requirements

Default to dark when no valid theme preference is saved. Respect an explicit light, dark, or system preference. Paint the same theme before JavaScript application startup. Buttons and single-line fields are fully rounded. Multiline instruction editors retain practical rounded rectangular editing space. Remove container outlines; group by 8-unit spacing, 24-unit groups and 32-unit sections, keeping labels 8 units from fields. Maintain keyboard focus indication and quiet input boundaries.

Workspace library: create and edit reusable skills or sequential workflow recipes, import SKILL.md or a complete plugin folder, inspect imported instructions, make editable copies, and remove workspace content. Imported documents retain relative paths so agents can read nested references. Import does not activate hooks, install dependencies, or configure MCP credentials. Existing agent skill creation/update tools save to the same owner and workspace scope. The installed Design OS bundle contains 209 files and fits the document importer. Its document entrypoints and reference reads are verified below; this does not activate plugin hooks or servers.

## Workspace library verification

The installed Design OS bundle was validated, temporarily stored in the isolated test database, read through the agent skill resource tool, and removed after the check. All 209 text files survive import; the manifest exposes 35 intended skill entrypoints. The canonical Design OS reference resolves from its portable entrypoint. No private plugin content is committed or installed into a production account by this check.

Cross-workspace and cross-owner reads are denied. Concurrent same-name plugin imports yield one installation and one conflict. Removal is idempotent and cannot delete another workspace's installation. Editable copies preserve their plugin origin so relative references remain available. Web and native mobile expose create/edit/import/export; native device rendering remains unverified. Workflow recipes use the skill storage and agent read/update tools; timed runs still use Schedules.

Two source-checker findings require explicit interpretation, recorded in component-usage.json: the upstream combobox barrel is tree-shaken while its actual implementation modules emit and run; the login layout's decorative image is removed under the user's explicit instruction. The checker itself is unchanged and is not reported as passing. The imported source and compiled dependency graph remain inspectable.

## Ordered rendered review

The final primary PWA review is recorded in [the source-bound detail record](connected-workspace-detail-review.json). Design OS self-review passed for the eight explicitly listed surfaces, then Details self-review passed for the same surfaces and source hashes. Captures include 320px phone, 768px short breakpoint and 1440px desktop layouts, plus company identity, account connection and the populated library. The record validator passes; it does not certify visual quality. Whole-product manual inspection and native-device evidence are not claimed.

Neutral charcoal replaces the earlier tinted dark palette. The dark background is shared by web, PWA metadata and native theme tokens. Functional controls retain focus indicators and quiet boundaries. Source-review exceptions remain documented; there is no aggregate Component OS acceptance claim.
