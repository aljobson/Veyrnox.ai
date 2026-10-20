# ADR-0179: Mobile first run (N3)

**Status:** Proposed 2026-10-19. Builds on ADR-0177 (Vey as the character) and ADR-0146 (tab shell).

## Context

A new person lands on Explore with no explanation of credits. The plan (N3) asks for a short, skippable welcome shown
once, with the real free-credit amount.

## Decision

- **Three cards at `/welcome`:** hello (Vey, waving), credits, start. Every card but the last has Skip. The last card
  starts creating and opens Explore.
- **Shown once.** `FirstRunGate`, mounted in the signed-in layout, reads one SecureStore flag
  (`veyrnox.welcome.seen.v1`, a versioned `{ seen: true }`). If it is absent the person is sent to `/welcome`. If the flag
  cannot be read, nothing is forced. Finishing or skipping writes the flag; if that write fails the welcome may show once more.
- **The real free amount.** The credits card reads `free_credits` from `GET /api/v1/balance`. `GET /api/v1/free-allowance`
  was checked and is not that number: it is the daily free generations left per model (ADR-0069). With no free credits, or an
  unreadable amount, the card explains credits without a number and promises none.
- **Nothing about the person is stored,** only the flag. English only until locales are on (ADR-0132). New keys are listed in
  `docs/mobile/I18N-NEW-KEYS.md` for the localization process.

## Not done

- **A reset in Account** ("show the welcome again"): Account belongs to another lane. Clearing the flag is one SecureStore
  delete; the row needs adding there.
- **Permissions in context** (the plan also lists it): nothing here asks for a permission yet.
- **Not proved:** VoiceOver and TalkBack, Android, a real phone, and the flag surviving a reinstall (SecureStore on iOS can
  outlive a reinstall, so a reinstall may skip the welcome).
- Stacked on the Vey branch (PR 1384) because the hero uses its character.
