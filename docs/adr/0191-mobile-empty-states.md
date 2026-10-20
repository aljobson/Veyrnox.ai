# ADR-0191: Mobile empty states and the low-balance prompt (N6)

**Status:** Proposed 2026-10-20. Part of the first-run and navigation lane (N-slices).

## Context

The plan (N6) says no screen should be blank without a next action, and that a person who cannot afford anything should
be offered Buy credits. Before this, an empty Library showed one line of grey text, an empty Posts list showed
"No posts yet." in English only, and a low balance showed nothing until a creation was refused.

## Decision

- **`EmptyState`** (title, optional body, one action) replaces the bare text on an empty Library (action: Make something,
  to Create) and an empty Posts list (action: New post, to the composer). It announces its title as a heading.
- **`LowBalanceNote`** appears on Explore when the balance is known and below the cheapest template price (the server's own
  price list), or below 3 credits when no price list loaded. It says what is left and offers Buy credits. An unknown or
  unreadable balance never shows it. The prompt decides only whether to offer a purchase; every price stays the server's.
- **`useBalance`** reads the balance through the same cached call the header chip uses.
- Copy is English, with the new keys listed in `docs/mobile/I18N-NEW-KEYS.md`.

## Not done

- **Cinema and Create** are listed in the plan, but their screens belong to other lanes. `EmptyState` is ready for them to
  adopt; a Create screen with no models, and an empty Cinema feed, still show their existing lines.
- The Posts screen's other English strings (statuses, "No text") are untouched.
- Not run: VoiceOver, TalkBack, Android, a real phone. Not yet looked at on the simulator.
