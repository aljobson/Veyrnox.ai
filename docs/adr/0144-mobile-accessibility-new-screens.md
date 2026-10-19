# ADR-0144: Mobile accessibility pass on the M10-M11 screens

**Status:** Proposed 2026-10-19. Extends ADR-0133 (the first pass).

## Context

ADR-0133 covered the screens that existed on 2026-10-18. Since then Quick edit, Brands,
Approvals, Calendar, Best time, Drafts, Connect, Blocked members and Cinema comments were added.
A store review expects the same bar on them: roles and labels, 44 pt targets, and text that
still reads at the largest accessibility text size.

## What I checked

All nine screens at the largest Dynamic Type size on the iPhone 17 Pro simulator, against the
mock server. The static audit (`a11yAudit.test.ts`) already walks every screen file, so the new
screens were covered for roles and labels; the findings below are layout at large text, which it
cannot see.

## Findings and fixes

- **Rows with a label and an action side by side** (Connect, Calendar, Blocked members, Cinema
  comments, Quick edit) pushed the action off the right edge. The rows now wrap, so the action
  drops under the name and nothing is clipped.
- **Best time frequency table** squeezed three columns into wrapped single words. Each entry is
  now two stacked lines (posts a week; weeks of data and score). The spoken label is unchanged.
- **Success and refusal notes** on Connect and Calendar are announced to a screen reader.

Brands, Approvals and Drafts already wrapped correctly and needed no change.

## Not proved

- **VoiceOver and TalkBack were not run.** The steps are the ones in ADR-0133, applied to the
  Connect, Calendar, Best time and Comments screens.
- Android layout at large text.
- Right-to-left layout (still out of scope; see ADR-0132).

## Consequences

Layout and accessibility-prop changes only. No new strings, routes, dependencies or flags.
