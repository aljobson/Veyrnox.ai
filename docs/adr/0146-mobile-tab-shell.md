# ADR-0146: Mobile five-tab shell (parity plan N1)

**Status:** Proposed 2026-10-19. First slice of the parity plan's Track B (`docs/mobile/spec/IMPLEMENTATION-PLAN.md`).

## Context

Signed-in Home was a column of buttons with no tab bar, and nothing linked onward from the feature
screens. The owner's journey review chose five bottom tabs, a credits chip in every tab header, Account
behind an avatar, and Vey as the chat entry (N8, later). N1 is the shell only: screens move in
without a change in behaviour, so every later slice lands in a fixed frame.

## Decision

- **Five tabs:** Explore (today's Home), Create, Cinema, Library, Publish. The tabs are an Expo Router
  `(tabs)` group inside `(app)`. A group adds no path segment, so every URL is unchanged: `/`, `/create`,
  `/cinema`, `/library` and `/publish` open the same screens, and push-tap routes, app links and deep
  links keep working. Every other screen still opens above the tabs, with its own back button.
- **Header on every tab:** the logo, a credits chip that opens Buy credits (which links to Credit
  history), and an avatar that opens Account. Credits stay out of the tab bar so the store-only purchase
  rule is easy to audit.
- **Labels and sizes (ADR-0133):** each tab has a visible label, a spoken label, and a 44 pt target. The
  bar has a fixed height, so label growth stops at the same limit as the header (1.3 times); at the
  largest system text size all five labels fit.
- **Library:** its "Video files" action moves from the header into the screen, so the header stays the
  same on every tab.
- **No icons yet.** The tabs are text only: an icon set needs a new dependency and a native rebuild, so it
  waits for a design pass.
- **Sign-in redirects** now name `/(app)/(tabs)`, because the old `(app)` index no longer exists.
- The static audit accepts `HeaderRight` beside `HeaderAction` as a size-capped header control.
- Eight new English strings (`tabs.*`) are listed in `docs/mobile/I18N-NEW-KEYS.md` for the
  localization process; no machine translation.

## Not proved

- **VoiceOver and TalkBack** were not run on the tab bar (steps as in ADR-0133).
- **Android** layout and the system back button across tabs.
- A **real phone**: this was checked on the iPhone 17 Pro simulator against the mock server, at the
  normal and the largest text size.
- Home is still the old button column; replacing it with the Explore content is N4.

## Consequences

Layout and routing only. No new routes, dependencies, flags or server calls.
