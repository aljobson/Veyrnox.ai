# ADR-0159: Mobile Vey mascot as the chat entry (parity plan N8)

**Status:** Proposed 2026-10-19. Fourth slice of the parity plan's Track B, after ADR-0148.

## Context

On the web, chat is not a page in the navigation: it is Vey, a floating character that opens a conversation
panel and can sit on either side. The phone had a "Chat with Vey" button on Home instead. The journey review
decided chat is the mascot, not a tab and not a Home button, and left open where Vey sits on a phone and whether
it hides during video and in the composer.

## Decision

- **Vey is a floating round button** with the Veyrnox mark, in the bottom corner of every tab, above the tab bar.
  It is rendered inside each tab's scene (the navigator's `screenLayout`), so it can never sit over the tab bar.
- **A tap opens the chat list** at `/chat`, as a normal screen with its own back button. The chat routes are
  unchanged.
- **Left by default, like the web.** A long press moves Vey to the other side; screen-reader users get the same
  thing as a custom action ("Move Vey to the other side"), because a long press is not discoverable. The side is
  stored as the web stores it: `{ "version": 1, "side": "left" | "right" }`, nothing else, in the same secure
  store the app already uses for the AI-consent record. No new dependency.
- **It hides** while the keyboard is up (never over a text box) and on the **Cinema** tab, whose Play and Report
  actions sit at the bottom of the feed.
- **The Chat button leaves the home** (the More row on Explore keeps Quick edit and Projects). Explore's scroll
  area leaves room below its last row (`VEY_CLEARANCE`, exported for any list that wants the same).
- It is 56 pt (above the 44 pt minimum), labelled "Chat with Vey" with a hint about moving it, and does not animate.
- Three new English strings (`vey.*`) are listed in `docs/mobile/I18N-NEW-KEYS.md`.

## Not done, and why

- **Pushed screens** (the result screen, the composer, Quick edit, players, chat itself) do not show Vey. They sit
  above the tabs and each needs its own placement check against its controls and keyboard. The tabs are where a
  person starts; this is the safe first step, not the end state of "every screen".
- **A bottom sheet.** The chat opens as a pushed screen, not a sheet: presentation belongs with the chat lane
  (`chat/**`), and changing it from the app layout would risk a doubled header.
- **A drawn character.** The button uses the brand mark; character art needs an asset from the owner.
- **Free dragging.** The web also stores a free position; the phone offers the two sides only.
- **Right-to-left mirroring** (the web mirrors the dock for Arabic); out of scope with the rest of RTL (ADR-0132).

## Not proved

- VoiceOver and TalkBack, including the move action.
- The soft keyboard hiding it: the simulator ran with a hardware keyboard, so only the listener is in the code.
- Android, and a real phone.
- Other tabs' last rows: Create, Library and Publish are owned by other lanes and have no clearance for Vey yet.
  Check the last row of each at the end of a long list.

## Consequences

No new routes, dependencies, flags or server calls.
