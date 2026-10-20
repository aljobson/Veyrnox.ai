# ADR-0238 — Mobile: ask for approval, and share the review links

**Status:** Proposed 2026-10-20
**Related:** [ADR-0135](0135-mobile-publish-brands-approvals.md) (the approvals list drops links on purpose), [ADR-0122](0122-mobile-publish-composer.md), parity phase P5

## Decision

The owner said "buildit" to the open question of whether the app may share a bearer link, so the app now creates an approval request and hands each reviewer's private link to the system share sheet.

1. **Create.** "Ask for approval" on the Approvals screen opens a form: a finished creation, the accounts, the text, the time the post goes out if approved (in the future), 1 to 10 reviewer email addresses, and the rule (any one approves, or everyone must). A dialog names the reviewers, accounts, time and rule before anything is sent. One idempotency key, saved before the send (as in the composer), covers a retry after a lost connection.
2. **The links.** The route answers with one private link per reviewer. They are shown once, on the screen that made the request, with a Share button each that opens the system share sheet. A link is kept only if it is https and its path is `/social/review/...`. Links are never stored, never logged and never put in a notification; the approvals list still drops them (ADR-0135). Anyone holding a link can review, which the screen says. Reviewers still decide on the web.
3. **Not built:** per-network text variants and YouTube visibility for an approval (the route takes them; the composer already has the controls), and re-sharing a link later (it would mean reading links from the list, which stays off).
4. No server change, no dependency, no flag. Unit tests only; the screens were not run on a device.

The link's host is pinned: it is kept only when its origin equals the app's own API origin (the one every request uses), with no userinfo, so a link on another host or a lookalike is dropped, not shared.
