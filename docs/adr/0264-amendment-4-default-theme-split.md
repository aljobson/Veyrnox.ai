# ADR-0264 amendment 4: The website is dark by default, the mobile app light

Date: 2026-11-14
Status: Accepted (owner, 2026-11-14). Records existing behaviour; no code change.

## Context

The 2026-11-13 design audit (`docs/design/design-audit-2026-11-13/README.md`)
found the two products start in different themes and asked whether that was
deliberate or drift:

- **Website.** Dark is the default and the brand (`app/globals.css`, the
  `:root` block). The nav toggle and the picker on `/app/account` write
  `data-theme` (light, dark or system) and keep it in the `veyrnox_theme`
  cookie, so a choice lasts.
- **Mobile app.** `DEFAULT_APPEARANCE.theme` is `light`
  (`apps/mobile/src/theme.ts`), and since #1996 every cold launch starts in
  light mode, whatever was saved or the phone uses. The only exception is the
  reload an Appearance change triggers: a one-shot `veyrnox.themeKeep` flag
  lets the person's choice survive that one reload.

Nothing recorded the split, so it read as an inconsistency.

## Decision

Keep both. The website stays dark by default; the mobile app starts light on
every cold launch. The split is deliberate:

- The website's receipt world (thermal-paper slips on a near-black page) is
  the brand's showcase and is built for dark first.
- The mobile app's first-run and paywall screens were designed and checked in
  light mode (amendment 3 was checked on the simulator in light mode), and
  #1996 made light the launch state on purpose.

## Consequences

- The two share every token value that carries meaning (accent, money,
  danger and the feature hues are the same in both themes on both
  platforms), so a person moving between them sees one brand in two lights.
- On mobile a saved dark choice holds for the session it was made in, not
  across a cold launch. This is the behaviour #1996 chose. Changing it means
  dropping the cold-launch override in `theme.ts` and its tests
  (`firstRun.test.ts`, `hardPaywall.test.ts`, `designSystemV2.test.ts`), and
  a new amendment.
- Design reviews should check the website in dark first and the app in light
  first, then the other theme.
