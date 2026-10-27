# ADR-0265: Vey is not a chat bot in the mobile app

Date: 2026-10-27
Status: Accepted (owner, 2026-10-27). Supersedes the mobile floating Vey of ADR-0159 and the mobile help panel of ADR-0170.

## Decision

The owner asked to remove Vey as a chat bot from the mobile app. Vey stays as a character: the welcome and vibe
screens, the first-creation celebration (ADR-0264), the paywall card peek and the wordmark runner are unchanged.

Removed from the app:

- The floating Vey on every tab except Editor and Publish (ADR-0159). It opened `/chat`, could be moved between the
  bottom corners, and hopped as lists scrolled. `VeyMascot`, `veyPlacement`, `useVeyScroll`, and the scroll-hop and
  reaction channel in `veyMotion` are deleted. The small cheer for a later finished creation was the floating Vey
  reacting; it is gone, and the success haptic remains.
- The Ask Vey question box on Help (ADR-0170) and its client `src/lib/help.ts`. Help keeps the guides, support email,
  the paid chat link, appeals, reporting and the rules. The web `/api/v1/help` endpoint is unchanged; the app no
  longer calls it.
- Vey naming of the chat: search lists the chat under `menu.chat` ("LLM Chat"), and VoiceOver reads an assistant reply
  as "Assistant" rather than "Vey".

`VEY_CLEARANCE`, the bottom padding that let a list's last row scroll clear of the floating Vey, becomes
`LIST_END_PADDING` (32) in `src/theme.ts` on the same screens.

English strings that only these features used are left in place when the frozen historical key order
(`en/_order.ts`, pinned by `catalogRegistry.test.ts`) lists them; nothing renders them. The four that are not pinned
(`vey.show`, `vey.showHint`, `vey.dismiss`, `explore.chat.title`) are deleted. No other language had them.

## Consequences

- Nothing covers content in the bottom corner of the tabs, which phase 2a of the design system had flagged on Create
  and Library.
- The LLM chat itself is unchanged and stays reachable from Home, Help, search and the menu.
- The website keeps its own Vey helper; this decision covers the mobile app only.
