# ADR-0125 — Mobile: Help and content-decision appeals

**Status:** Proposed 2026-10-18
**Related:** [ADR-0083](0083-admin-operations-surface.md) (sanctions and appeals), [ADR-0110](0110-mobile-account-and-safety.md), [ADR-0106](0106-mobile-app.md), roadmap slice M12

## Context

The web has an account page listing warnings, removals and content freezes with an appeal for each. `GET` and `POST /api/v1/appeals` already serve it: identity comes from the Bearer token, there is no cookie, CSRF header or Turnstile, and the server never returns the operator's reason. The app has Report and legal links but no way to see or contest a decision. `POST /api/v1/help` is a one-question assistant, not a list of answers.

## Decisions

1. **No server change.** The app uses `/api/v1/appeals` as it is.
2. **A Help screen** (`/help`, from Account): email support, the legal links already in the app, Report, and a link to content decisions. There is **no FAQ**: the help route answers one typed question at a time (and may call a model), so an in-app assistant is a separate decision.
3. **A Content decisions screen** (`/appeals`): each recorded warning, removal or freeze with its date and appeal state (under review, successful, not successful), and a pause notice when generating is on hold. Nothing else about the decision is shown.
4. **Appealing**: once per decision, 10 to 2000 characters, checked on the phone with the server's rule. A repeated send answers with the first appeal and counts as sent. Server refusals (rate limit, not appealable) are shown in plain words.
5. English only; no credit or money wording is involved.

## Not decided here

- An in-app Ask Vey assistant on `/api/v1/help`.
- A push or in-app notice when an appeal is decided (the outcome arrives by email).

## Consequences

- No dependency and no native change.
- Tested with fake clients, and the request and refusals against a local fixture; not run on a simulator in this slice.
