# Company workspace repair

Mode: product refinement. Review: self-review, not an independent assessment.
Scope: Cadre web and installed PWA workspace switcher, Company OS onboarding and status, navigation controls, icon consistency, and conversation previews. Native app was not the reported surface. Company OS consent is a separate repository and release.

## Evidence and defects

User screenshots show translation IDs in place of actions, headings and explanatory copy. These are untranslated message IDs, not renamed workspace data. Development-mode fallbacks concealed the missing catalog extraction in earlier tests. The release workflow must exercise the compiled production build.

Other reported defects: absent company creation, no visible company identity or connection state, inconsistent icon sizes/weight, misleading sidebar arrows, raw Markdown previews, and agent em dashes.

## Composition decisions

This record was created during repair, not before the initial implementation. It does not retroactively certify the earlier work.

1. Hierarchy: workspace identity first, attached company and its connection state second, conversations next. Actions have complete labels. No new decorative icons or illustrations.
2. Composition: workspace list and creation actions remain anchored to the workspace control. A quiet company status sits immediately beneath it. Company connection management uses account settings. Creating a company retains OAuth state through the Company OS sign-in and consent journey.
3. Material: reuse the existing monochrome surface and border tokens. No new blur or decorative containers.
4. Details: retain Geist and semantic text colors. Equivalent interactive Lucide glyphs use 18 px boxes and 1.75 stroke weight. Navigation targets remain at least 44 px on phones. Creation heading uses the existing consent title role. Preview text removes Markdown syntax without modifying stored messages. No em dashes in new agent writing instructions or new interface copy.
5. Responsive behavior: 390 x 844 phone plus desktop, short height and breakpoint checks required. Workspace list scrolls independently of fixed actions. Settings actions wrap on narrow widths. Long names truncate in the sidebar, not in the consent form. Pending and failure states remain readable.

Alternative considered: leave company identity solely in the dropdown or settings. Rejected because the user cannot tell the active business while reading a conversation.

## Skill application and limits

Design OS rendered-quality contract, scoped detail-completion, screenshot review checklist, content voice standard, and Details review instructions were read. The repair follows production-build inspection and parent-before-child review. No premium rating or user-validation claim is made.

Component OS's inventory was read and the sidebar, input, select, popover and modal sources fetched for provenance review. Existing Cadre primitives are Base UI/shadcn; they are not the required Component OS sources. That baseline gap is unresolved. Fetching sources is not adoption, and this repair must not be described as fully Component OS compliant. Company OS's existing input/button composition is retained in the consent form.

## Verification record

- Local compiled-build browser tests: workspace creation, isolation switching, settings connection, desktop and phone action labels.
- Separate Company OS browser tests: company creation form, preservation of the request and permission review after creation; deterministic preview backend, not a real user grant.
- Real account consent and authenticated context read remain distinct from frontend deployment health.
- Final screenshots and source hashes are recorded after the last implementation change. Any further change reopens their affected review.
