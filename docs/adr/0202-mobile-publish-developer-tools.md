# ADR-0202: Mobile Publish developer tools (parity plan P7, slice 5)

**Status:** Proposed 2026-10-19. Builds on ADR-0135 (Publish brands) and ADR-0149.

## Decision

A **Developer tools** screen (`/publish/developer`, a row on Account) with three tabs, for the chosen Publish brand
(the brand header the other Publish screens use). The server allows owners and managers only, and answers 404 until
`customer_api_not_open` / `customer_webhooks_not_open` are lifted; the screen turns each answer into plain words
(not open yet, needs a Publish plan, owner or manager only, limit reached).

- **API keys:** list (`GET /api/v1/social/developer/keys`), create (label, 1 to 3 of `accounts:read`, `posts:read`,
  `posts:write`, expiry 30, 90 or 365 days), revoke (`DELETE ?id=`).
- **Webhooks:** list with recent deliveries, create (label, an https address under the server's rules, 1 to 3 of
  `post.published`, `post.delivered`, `post.failed`), revoke.
- **Request log:** `GET .../logs` with the status filter and a search of up to 80 characters.

**Secrets shown once.** A new key or signing secret is in the create call's answer only. The screen holds it in memory,
shows it selectable, offers the system share sheet (so it can go to a password manager) and a button "I have saved
it". Leaving the screen discards it. It is never logged, written to storage or put in a URL. The list shows only the
key prefix.

The input rules (name length, scopes, expiry, webhook address) mirror the server's, so a bad entry is caught before
the call. Nothing here touches billing or credits.

## Not built

No copy-to-clipboard button: the app has no clipboard module and a dependency cannot be added in this lane. Share and
selectable text do the job. No Publish plan screen link (no such screen yet), so a 402 only explains.

## Not proved

Unit tests with mocks (lists, validation, request bodies, once-only secrets, errors). Not run against the server, a
simulator or a phone; no component tests. The list row fields are those the web page reads.
