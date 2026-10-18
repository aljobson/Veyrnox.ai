# ADR-0129 — Mobile: reporting and blocking for content from other people

**Status:** Proposed 2026-10-18 (needs the owner's decision on block)
**Related:** [ADR-0110](0110-mobile-account-and-safety.md) (report, block deferred), [ADR-0106](0106-mobile-app.md), `docs/mobile/M7-STORE-SUBMISSION-CHECKLIST.md` section 8; Apple App Review Guideline 1.2 (names AI content creation apps as user-generated content apps), Google Play user-generated content and AI-generated content policies

## Context

Apple 1.2 asks for a filter for objectionable content, a way to report it with timely response, a way to block abusive users, and published contact details. ADR-0110 shipped report and contact and deferred block "until the app shows other people's content". Cinema (M9) now shows titles made by other people.

## What the app shows today (audited on `main`)

| Place | Whose content | Report |
|---|---|---|
| Create result, Library, job screen | the person's own creation | yes, "Report" on the job (`kind=job`) |
| Cinema list and title screen | other people's published titles | yes, on each card and on the title screen (`kind=cinema_title`) |
| Chat replies | AI text in the person's own private thread | none; not shared with anyone |
| Publish screens | the person's own posts and accounts | not applicable |
| Account | general report and contact address | yes, "Report a problem or content" |

Cinema is not open posting. A title stays private while automated checks and, where uncertain, a reviewer examine it (legal page "Cinema content"); it carries an age rating; it shows a display name only. The app has no comments, replies, follows, direct messages or profiles, so one person cannot contact or target another through it. Filtering exists server-side (AUP, safety checks before publishing); contact is `support@veyrnox.com`.

## Decision (proposed)

1. **Keep Report everywhere other people's content appears.** Nothing is missing today; this table is the audit.
2. **No block control for now**, on the ground that Cinema is moderated editorial content with no way for one person to contact or target another. Block has nothing to act on: there is no abusive person to avoid, only a title, and a title is hidden by reporting it.
3. **Revisit before any of these ship**: comments or replies on Cinema, profiles or follows, shared libraries, or in-app messages. Any of them ships together with block and mute, or not at all.

## Needs the owner

- **Accept or reject point 2.** The decision is the owner's to see, and is recorded as: no block or mute for v1. Apple's reviewer may still ask for a block control because 1.2 names AI content apps. The cheap fallback if review asks is a per-device "Hide this title" on Cinema cards (stored on the phone, hides that title from the feed); a "hide creator" variant can match on the creator username already in the payload.
- Put the audit table in the App Review notes.

## Consequences

- No code change. If point 2 is rejected, one more slice (hide title, with its own ADR) is needed before submission.
