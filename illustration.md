# Illustrations for the logged-out site

Working catalog for the marketing site (`apps/www`). It records the full ForgeUI set that is
available to us, which illustration earns a place on which page, and the rules an illustration has
to follow before it ships.

Two things this file is not: it is not a licence to paste generic SaaS art into the site, and it is
not a checklist to install end to end. Most of the catalog below will never ship. The point of
writing all of it down is so the handful we do use are *chosen* rather than defaulted into.

## Access

The registry is namespaced and the Pro items are token-gated.

`apps/www/components.json`:

```json
{
  "registries": {
    "@forgeui": {
      "url": "https://forgeui.in/r/{name}.json",
      "headers": { "Authorization": "Bearer ${FORGEUI_API_TOKEN}" }
    }
  }
}
```

The token itself lives in `apps/www/.env.local` as `FORGEUI_API_TOKEN`. That file is gitignored and
the value never lands in a tracked file, a commit message, or a PR description — this repository is
public.

> **Open supply-chain question.** `AGENTS.md` says web and Electron vendor shadcn components "from
> the official registry only (third-party registries are a supply-chain risk)". ForgeUI is a
> third-party registry, so pulling from it is a deliberate exception that needs the maintainer's
> sign-off, not something to assume. See [Sourcing](#sourcing) at the bottom.

## Full catalog

### Illustrations

```
npx shadcn@latest add @forgeui/cloud-orbit
npx shadcn@latest add @forgeui/data-pipeline
npx shadcn@latest add @forgeui/timeline
npx shadcn@latest add @forgeui/onboarding-steps
npx shadcn@latest add @forgeui/workflowrun
npx shadcn@latest add @forgeui/model-mesh
npx shadcn@latest add @forgeui/pagescan
npx shadcn@latest add @forgeui/emptyproject
npx shadcn@latest add @forgeui/revenuechart
npx shadcn@latest add @forgeui/spaminbox
npx shadcn@latest add @forgeui/chatthread
npx shadcn@latest add @forgeui/export-flow
npx shadcn@latest add @forgeui/notification-stack
npx shadcn@latest add @forgeui/agentresearch
npx shadcn@latest add @forgeui/speedgauge
npx shadcn@latest add @forgeui/bankcard
npx shadcn@latest add @forgeui/apirequest
npx shadcn@latest add @forgeui/emptyschedule
npx shadcn@latest add @forgeui/modepicker
npx shadcn@latest add @forgeui/trendlines
npx shadcn@latest add @forgeui/codeprompt
npx shadcn@latest add @forgeui/agentcursors
npx shadcn@latest add @forgeui/codepresence
npx shadcn@latest add @forgeui/recordimport
npx shadcn@latest add @forgeui/handoffmenu
npx shadcn@latest add @forgeui/botreply
npx shadcn@latest add @forgeui/integrationwall
npx shadcn@latest add @forgeui/metricschart
```

### Animated components

```
npx shadcn@latest add @forgeui/animated-form
```

### Header blocks

```
npx shadcn@latest add @forgeui/header05
npx shadcn@latest add @forgeui/header02
```

### Hero sections

```
npx shadcn@latest add @forgeui/hero-section02
npx shadcn@latest add @forgeui/hero-section06
npx shadcn@latest add @forgeui/hero-section10
npx shadcn@latest add @forgeui/hero-section15
```

### Logo clouds

```
npx shadcn@latest add @forgeui/logo-cloud03
npx shadcn@latest add @forgeui/logo-cloud01
```

### Feature sections

```
npx shadcn@latest add @forgeui/feature01
npx shadcn@latest add @forgeui/feature02
npx shadcn@latest add @forgeui/feature03
npx shadcn@latest add @forgeui/feature04
npx shadcn@latest add @forgeui/feature05
npx shadcn@latest add @forgeui/feature06
npx shadcn@latest add @forgeui/feature07
npx shadcn@latest add @forgeui/feature08
npx shadcn@latest add @forgeui/feature09
```

### Runtime dependencies used across the set

The catalog's install lines pull from this pool. Union of everything:

```
npm i motion clsx tailwind-merge
npm i gsap @gsap/react react-icons clsx tailwind-merge
npm i lucide-react clsx tailwind-merge
```

Each one is a new dependency on a static marketing site, so it has to be paid for by something a
visitor can feel. The four shipped illustrations need `motion`, `react-icons`, `clsx`, and
`tailwind-merge`, and those are now in `apps/www`. `gsap` and `@gsap/react` are not — nothing that
ships uses them, so they stay out. Lucide icons come through `react-icons/lu` rather than a second
`lucide-react` dependency.

## What ships where

The site's job is to get somebody to *"a bot does my work while I'm asleep, and it's my machine"*
as fast as possible. Every illustration below is there because it proves one claim. If it only
decorates, it does not go in.

Order matters more than quantity. The page reads: what you get → see it happen → it works where you
already work → it's yours → it's free.

| Placement | Illustration | The claim it proves |
| --- | --- | --- |
| Hero | *none* | The demo directly below is the aha. Art here would compete with it. |
| Below hero | existing `ProductDemo` | A real thread beats any illustration. Left alone. |
| "Any model, your key" | `model-mesh` | Six providers around a Rakazo instance you run. |
| "Readable routines" | `timeline` | Named routines on a weekly schedule with a live playhead. |
| "Approvals that hold" | `handoffmenu` → approvals list | Routine work done alone; consequential work held for you. |
| "It works where your work already lives" | `integrationwall` | The tools a bot signs in to, monochrome. |
| Bot templates | existing roster cards | Already strong. Left alone. |
| Open source / final CTA | *none* | Ending on a button is stronger than ending on a picture. |

Four illustrations on the homepage. The existing layout, sections, and copy are unchanged: the three
self-host illustrations drop into the top of the existing `.feature-card`s in `card-grid-3`, and the
tool wall gets one new section built from the site's own `.section` / `.section-intro` / `.eyebrow`
primitives. The diff against the site's own files is additive — no existing rule, token, or string
was edited.

One collision is worth knowing about. The site's `.feature-card p` rule is unlayered, so it outranks
Tailwind's layered utilities and resized the text inside the artwork, which made the timeline's bars
grow until they overlapped. `.feature-card__art :is(p, h3)` hands `margin`, `font-size`, and
`line-height` back to the utility layer with `revert-layer`, scoped to the art slot only. Expect the
same clash with any other vendored Tailwind component dropped inside a themed container here.

### Deliberately not used

Most of the catalog. Recording why, so it does not get relitigated:

- `revenuechart`, `trendlines`, `metricschart`, `speedgauge`, `bankcard` — Rakazo is not an
  analytics or fintech product. Charts here would be invented numbers, which is both dishonest and
  off-message.
- `spaminbox` — Inbox Manager is one bot of eight. Leading with mail narrows the product.
- `emptyproject`, `emptyschedule` — empty states sell absence. Wrong job for a landing page.
- `botreply` — imports `next/image`. This is an Astro site, so it does not run without a rewrite,
  and its Discord/Notion framing is narrower than `integrationwall` anyway.
- `cloud-orbit`, `pagescan`, `apirequest`, `codeprompt`, `codepresence`, `agentcursors`,
  `recordimport`, `export-flow`, `data-pipeline`, `notification-stack`, `chatthread`,
  `onboarding-steps`, `agentresearch`, `modepicker`, `workflowrun` — each is either a weaker
  version of something `ProductDemo` already does live, or it describes a mechanism rather than a
  benefit.
- `hero-section*`, `header*`, `feature*`, `logo-cloud*` — the site already has a header, hero, and
  feature layout carrying four locales, structured data, and a waitlist dialog. Swapping the shell
  would throw that away to gain nothing a visitor notices.

Only the four that ship are vendored into `apps/www/src/components/forgeui/`. The rest were pulled,
reviewed, and deleted rather than left in the tree as unused third-party code.

## Rules for adapting one

An illustration that has not been adapted is worse than no illustration. Before any of these ship:

1. **Tokens, never hex.** Use the site's custom properties — `--ink`, `--body`, `--muted`, `--line`,
   `--blue`, `--surface`, `--panel`. No product hex, no `[var(--…)]` arbitrary values. ForgeUI ships
   its own palette and it will not match.
2. **Monochrome plus one.** Ink and greys carry the structure; blue is the single accent. Bot
   identity colours are the only other colour allowed, and they come from `DEMO_ROSTER`.
3. **Correct icons, every time.** `lucide-react` only, matched to the actual concept — a schedule is
   a calendar, a model is not a lightning bolt. No `react-icons` brand glyphs for companies we do
   not integrate with.
4. **Real nouns.** Labels come from the product: bot names from `DEMO_ROSTER`, real routine names,
   real tool names. No "Lorem", no "Acme", no invented metrics.
5. **Motion is subordinate.** It plays once on entry, it loops slowly or not at all, and it never
   competes with `ProductDemo`. Every animation honours `prefers-reduced-motion: reduce` and has a
   still first frame that reads correctly on its own.
6. **Weight budget.** These sit on a static Astro page. Prefer inline SVG plus CSS. Reach for a
   React island only when the motion genuinely cannot be done in CSS, and hydrate it
   `client:visible`, never `client:load`.
7. **Decorative or described, pick one.** Structural art gets `aria-hidden="true"`. Art carrying
   meaning gets a real accessible name. Nothing gets a generic "illustration" label.
8. **Localised.** Any visible word inside an illustration is UI, so it goes through `src/i18n/home.ts`
   in all four locales or it does not appear as text.

## Sourcing

Vendored from ForgeUI (option A), with the maintainer's sign-off on the `AGENTS.md`
third-party-registry exception. What that cost, recorded plainly:

- New dependencies in `apps/www`, which previously had none of them: `motion`, `react-icons`,
  `clsx`, `tailwind-merge`.
- Four third-party component files now live in the tree. Each was read in full before committing.
- `apps/www/components.json` carries the registry config; the token stays in `.env.local`.

Every vendored file was then adapted rather than dropped in as-is:

- All Tailwind `neutral-*` values and `dark:` variants were replaced with the site's own tokens,
  bridged into Tailwind's namespace by an `@theme inline` block in `global.css`. Zero raw neutrals
  remain in the four files.
- The T3 Chat logo at the centre of `model-mesh` was replaced with the Rakazo coordinator mark, and
  the glow retuned from Tailwind blue to `--blue-top`.
- `timeline` lost its Gantt placeholder rows for named routines on a weekday ruler, with roster bot
  colours and a blue "now" playhead instead of an orange one.
- `handoffmenu` was rebuilt from a list of rival AI coding tools into the approvals list, with
  lucide icons via `react-icons/lu` and a `Done` / `Asks you` distinction.
- `integrationwall` swapped Spotify, Twitch and Vimeo for tools a bot would actually be pointed at,
  rendered monochrome instead of in brand colours.
- `timeline` and `handoffmenu` take their visible strings as props so all four locales are covered.
- `timeline` rows were re-spaced and its bottom fade dropped so all three routines read in full at
  card width.
- `model-mesh` honours `prefers-reduced-motion` in JS, since CSS cannot stop Motion's animations.

The alternative (option B, authoring natively in inline SVG and CSS) stays on the table if the
dependency weight or the registry exception ever stops being worth it. The placement table above is
written to be satisfied either way.
