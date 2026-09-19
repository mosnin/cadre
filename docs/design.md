# Cadre — the design of the application

This is the internal application: everything behind sign-in. The marketing
site is a separate codebase and this document does not govern it.

It exists so the next change reaches for a measured number instead of a
guess. Where a number here has a source, the source is named.

---

## 1. Where the numbers come from

The shell is a recreation of a reference, measured at the width the
reference was captured at and rebuilt to those numbers rather than to an
impression of them. The working — every reading, the scale factor, and the
rendered value beside it — is in [`shell-measurements.md`](./shell-measurements.md).

The method, which any future surface should follow:

1. Read the reference at its own width; divide to the width we build at.
2. Write the numbers into a tokens module, not into scattered classes.
3. Build.
4. Screenshot the **running application**, not a mockup of it.
5. Measure the render with `getBoundingClientRect` and put the two columns
   side by side.
6. Close the gaps. Repeat 4–5 until the list is empty.
7. Check 390px.

Step 4 is the one that catches things. Two real bugs on this shell were
found only by looking at a capture: bot names rendering invisible, and a
blank white orb the moment someone picked a new colour. Neither was
visible to `tsc`, to the linter, or to the tests.

A measurement window that clips returns a smaller number with no sign
anything went wrong. Choose the window wider than the text can be, check
the run does not touch either edge, and compare px per character when the
two strings differ in length.

---

## 2. Layout

### The rail is in the layout, not over it

268px, in normal flow, beside the conversation at and above `md`. It is not
a panel that covers the screen: that was the previous shape and it meant
the rail was never visible beside the thing it navigates.

Consequences that have to hold together, and did not before:

- It opens with the application and **stays**. Collapsing is a stored
  preference (`cadre.railCollapsed`), not a side effect of navigating.
- Opening a dialog does not push it away.
- `/app` is a route a person can be on. The bot refresh used to redirect off
  it every three seconds, which is why "New chat" had nothing to return to.
- It does **not** take the caret on load. A drawer that just opened over the
  conversation should; a rail that is always there must not. Closing it
  still hands focus back to the control that reopens it.

Below `md` it is a drawer, because 268px of rail leaves nothing for a
conversation on a phone.

### One gutter

The header, the nav, the list and the footer all sit on the rail's single
12px gutter. Search, nav row and bot row all span 24→268 at 1512px. This is
asserted in `ui-appearance.spec.ts`: the search field and the row beneath it
must share both edges within 1px.

### Three columns need 1024

The rail takes 268 and the side panel 384. Below 1024 there is not enough
left for a conversation between them — at 768 it measured **68px**. So the
side panel floats over the conversation until 1024, and `main` is marked
inert while it floats.

### Measured geometry

| element | reference @1512 | built |
|---|---|---|
| Rail width | 268 | 268 |
| Workspace row, top | 27.7 | 27 |
| Nav row pitch | 38 | 38 |
| Nav label | 13.4 | 13.5 |
| First nav row, top | 73.4 | 76 |
| Composer column | 868 | 868 |
| Composer height | 85 | 85 |
| Suggestion pitch | 61 | 61 |

Constants live in `apps/web/src/pages/shell/home-tokens.ts`. Change the
number there, not a Tailwind class buried in markup.

---

## 3. Colour

Dark is the default and it is Cadre's own dark, from `@cadre/ui-tokens` —
never the near-blacks sampled off a reference. Taking a reference's colour
would make one screen a slightly different shade from every other screen,
which is worse than not matching it exactly. **The reference decides the
geometry; Cadre decides the colour.**

Light maps to the same token names so the shell follows the application's
own appearance switch rather than carrying a second one.

Agent colour is per agent, not per theme: an agent has a `color`, the agent
panel is where it is chosen, and `ORB_PRESETS` in `@cadre/core` is the set
it starts from.

---

## 4. Icons

Lucide, and nothing hand-drawn. No emoji or Unicode pictographs anywhere —
they render in whatever font the OS supplies, so weight, size and baseline
vary per machine.

One optical weight across controls, enforced in CSS rather than per call
site, because a `size` prop on a lucide icon inside a button is overridden
by it:

```css
:where(button, a, [role="button"]) svg.lucide { width: 1.125rem; height: 1.125rem; }
@media (min-width: 768px) {
  [data-testid="bots-sidebar"] :where(button, a, [role="button"]) svg.lucide {
    width: 0.9375rem; height: 0.9375rem;
  }
}
```

18px everywhere, 15px in the rail where the reference measures 15 on a 38px
row, and 18 below `md` where the rail is a drawer and 15 is not a touch
target. `spaces.spec.ts` asserts every visible rail glyph is one size at one
stroke, so a new icon cannot quietly arrive at another.

Inline SVG is acceptable only for data visualisation and for the avatar
shapes, which no icon set ships.

---

## 5. Avatars

Three styles, an account preference, `orb` the default for new accounts.
Anyone who chose robot or organic keeps it; the migration moves the column
default only.

**The orb** is assistant-ui's voice orb (MIT, notice beside the file),
carried across unchanged. What is ours:

- **Colour.** Upstream ships four fixed variants. `orbStops` derives the
  shader's three stops from the agent's own colour — the mid, a lift toward
  white and a drop toward black, by the distance the upstream variants keep
  between theirs. A colour anyone picks reads like a designed palette.
- **Budget.** A browser allows a handful of live WebGL contexts and starts
  dropping the oldest; a rail can show twenty agents. A context goes only to
  an orb ≥40px, on screen, with motion allowed. Everything else draws the
  same stops as a still gradient and breathes a halo while a run is in
  flight.
- Colour rides a **ref** into the render loop. In the effect's deps it tore
  the context down on every change, and a canvas whose context was lost
  hands the same dead context back — a blank white orb.

Mobile has no shader and draws the same stops as a radial gradient from the
same shared helper, so a colour chosen on the web reads the same there.

Never an empty grey circle. A slot with nothing in it reads as broken, not
as a convention.

---

## 6. Motion

`motion` (motion.dev) for anything that enters or moves. Duration 0.28–0.32s
on `cubic-bezier(0.16, 1, 0.3, 1)`; a stagger is ~45ms per row. Every
animation passes `initial={reducedMotion ? false : …}` so a person who asked
for less motion gets the end state, not a slower version of the journey.

`NumberFlow` where a number changes while someone is looking at it — the
month's runs and tokens in the rail footer. Not where a number is merely
displayed.

**The completion sweep.** When a run finishes, the agent's name sweeps once
in Claude's palette. Two rules it has to obey, both learned by breaking
them:

- The resting state is **ordinary text**. All the gradient and transparency
  lives in `.is-revealed`. A scroll reveal always fires so it can rest
  transparent; an event trigger may never fire, and names that never come
  back are invisible names.
- The resting colour is resolved from `getComputedStyle().color` **before**
  the class lands. `currentColor` would resolve against the element's own
  now-transparent colour and the text would finish the sweep blank.

---

## 7. Responsive

Reflow, never clip. `overflow-x-hidden` on a container that is too narrow
**hides** content; it does not adapt.

At 390px a table scrolls or restructures, the rail becomes a drawer, and
nothing is cut mid-character. The workspace home's column reflows to 358
with the document reporting zero horizontal overflow. Check every surface at
390 before calling it done.

---

## 8. Content

Never invent content a surface does not have. If the real state is awkward —
a connection that is unavailable, a chart flat at zero — show it. Inventing
plausible content removes exactly what the screen is for.

Every control goes somewhere real. A row that looks like an action and does
nothing is worse than no row.

---

## 9. Where Cadre differs from its reference, and why

A reference has no slot for things Cadre has to show. These were placed
deliberately rather than dropped:

- **Company OS connection.** A row of its own above the nav pushed every nav
  row down 69px and lost its own text to an ellipsis at rail width. It is a
  workspace setting, so it sits in the footer with the library and the
  account.
- **Role and last line under each bot row.** The reference's rows are a
  single label. A bot has to be recognisable at a glance, so the rows keep
  the generated avatar, the role and the preview, at 28/13.5/12/11.5.
- **Conversations and Activity.** Two ways into the same bots, which the
  reference has no counterpart for. They sit between the nav and the list.

---

## 10. Before calling anything done

- [ ] Same sections, same order, same nesting as the reference
- [ ] Type scale measured, not guessed — compared px per character
- [ ] Control dimensions match (row heights, field heights, pill widths)
- [ ] Spacing and gaps match; the rail is on one gutter
- [ ] Palette is Cadre's tokens, dark by default
- [ ] Icons are Lucide at the enforced size and stroke
- [ ] No empty grey placeholders; no emoji
- [ ] Motion respects reduced motion
- [ ] Reflows at 390px with nothing clipped
- [ ] Screenshotted running, measured, and diffed against the reference
