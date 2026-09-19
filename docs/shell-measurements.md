# Sana AI shell — measurements

Source: Mobbin, Sana AI (web). Reference images live in `.sana-refs/`
(gitignored — they are screenshots of another company's product and stay local).

| ref | screen |
|---|---|
| `home-clean` | empty home: rail, composer, suggestion list |
| `home-agent-menu` | agent picker open from the header |
| `chat-response` | assistant answer with inline citations |
| `action-items` | answer containing a table |
| `agent-overview` | conversation with the right-hand Overview panel |
| `edit-agent` | agent editor, Knowledge tab, live preview pane |
| `sources-menu` | composer Sources popover |
| `modal` | centred consent dialog |
| `dark-chat` | dark theme |
| `doc-response` | long answer with the feedback row |

## Scale

The Mobbin images are 1920x1320 with a 121px footer bar, so the usable frame is
1920x1199. Every raw number below is measured at that width.

They are **upscaled from a 1512px render**, which is the width the numbers only
make sense at. At 1920 the nav labels would be a ~21px face and the composer
placeholder ~19px, which no product ships; at 1512 they are 16px and 15px, and
every other measurement lands on a conventional value at the same time. So the
build scale is **0.7875** (1512/1920), and the right-hand column is what we
implement.

| element | at 1920 | at 1512 (build) |
|---|---|---|
| Rail width | 340 | **268** |
| Nav row pitch | 48.5 | **38** |
| Nav label cap height | 15-17 | **12-13** |
| Section label ("Folders") cap | 12 | **9.5** |
| Workspace header cap | 26 | **20** |
| Upgrade button | 257 x 45 | **202 x 35** |
| Composer width | 1102 | **868** |
| Composer height | 108 | **85** |
| Composer placeholder span | 19 | **15** |
| Suggestion row pitch | 77.5 | **61** |
| Suggestion label cap | 16 | **12.6** |
| Separator hairline | 1 | **1** |

The composer is centred on the main pane, not on the window: its midpoint sits
at x=1129.5 against a pane midpoint of 1130.

## Palette

| token | value | where |
|---|---|---|
| rail background | `#f9f9f9` | left rail |
| pane background | `#ffffff` | main pane |
| composer fill | `#f3f3f3` | composer pill, resting |
| primary button | `#0b1418` | Upgrade |
| separator | 1px hairline between suggestion rows |

## Structure

Left rail, fixed 268px, in four stacked blocks: workspace switcher; primary nav
(New chat, Workflows, Search, Meetings, More); a Folders section; then a pinned
footer carrying the usage meter and the primary button, with Settings below it.

The main pane has no chrome of its own beyond a thin header — an agent picker at
the left, Invite and Help at the right — and centres a single column holding the
composer and, beneath it, a hairline-separated list of suggestions. There is no
card, no panel and no border around any of it.

## Verified against the build

Measured off the running app at 1512px with `getBoundingClientRect`, so these
are the rendered numbers rather than numbers read off a capture. The reference
column is the 1920px reading divided by 1.27, plus the 12px the shell insets
its panes by.

| element | reference @1512 | built | delta |
|---|---|---|---|
| Rail width | 268 | 268 | 0 |
| Workspace row, top | 27.7 | 27 | −0.7 |
| Nav row pitch | 38 | 38 | 0 |
| Nav label size | 13.4 | 13.5 | +0.1 |
| First nav row, top | 73.4 | 76 | +2.6 |
| Composer column width | 868 | 868 | 0 |
| Composer height | 85 | 85 | 0 |
| Composer top | 390.5 | 393 | +2.5 |
| Suggestion row pitch | 61 | 61 | 0 |
| First separator | 526 | 532 | +6 |

At 390px the column reflows to 358 and the document reports no horizontal
overflow; the rail becomes a drawer, which is what the reference's own
collapse control does at that width.

## Where Cadre's shell differs, and why

The reference has no equivalent for three things Cadre has to show, so they
were placed rather than dropped:

- **Company OS connection.** A row of its own above the nav pushed every nav
  row down by 69px and lost its own text to an ellipsis at rail width. It is a
  workspace setting, so it sits in the footer with the library and the account.
- **Bot rows carry a role and a last line.** The reference's folder rows are a
  single label. A bot has to be recognisable at a glance, so the rows keep the
  generated avatar, the role and the preview, at 28/13.5/12/11.5.
- **Conversations and Activity.** Two ways into the same bots, which the rail
  already split before this and the reference has no counterpart for. They sit
  between the nav and the list, where the reference puts its section label.
