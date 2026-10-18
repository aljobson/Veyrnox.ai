# ADR-0128 — Mobile: consent before content goes to an AI provider

**Status:** Proposed 2026-10-18
**Related:** [ADR-0106](0106-mobile-app.md), [ADR-0110](0110-mobile-account-and-safety.md), `docs/mobile/M7-STORE-SUBMISSION-CHECKLIST.md`; Apple App Review Guideline 5.1.2(i), Google Play AI-generated content policy

## Context

Prompts, chat messages and any photo, video or audio a person adds are sent through our gateway to the third-party AI provider that runs the chosen model (privacy policy, "Your prompts, chat messages and reference files or images are transmitted to the third-party model provider"). Apple's guideline 5.1.2(i) requires telling the person where personal data goes, including to third-party AI, and getting explicit permission first. The app showed only a grey line under an uploaded file, and sent the server's `consent: true` for uploaded sources without the person doing anything. Prompts and chat had no notice at all.

## Decisions

1. **One agreement, asked before the first send.** A sheet titled "Before you create" says that what the person types, and any photos, video or audio they add, is sent to the third-party AI providers that run the models, used only to produce the result, and that it leaves our servers. It links the Privacy Policy and offers "Agree and continue" and "Not now".
2. **The gate is in the API client**, not in each screen: a `beforeSend` hook stops `POST /api/v1/generations`, `/uploads`, `/montage/plan` and `/chat/threads/:id/messages` until the account has agreed. A new screen that sends content is covered without a change. Reads, balance, reports and account calls never ask.
3. **Not now sends nothing.** The call fails with `consent_declined` before any token is fetched or request made; the create form says nothing was sent and nobody was charged. The sheet is asked again at the next send. With no signed-in account or no screen to ask on, the client refuses rather than sends.
4. **Stored per account and wording version** in SecureStore (`veyrnox.consent.<version>.<user id>`), version `ai-share-2026-10-18`. Changing the wording means bumping the version, which asks everyone again. The record survives sign-out so the same person is not asked twice. A storage failure asks again rather than sending silently.
5. **The server's own consent is unchanged.** `consent: true` for uploaded sources (AUP wording `aup-2026-09-26`, recorded as `jobs.consent_attested_at`) is still sent with sources, now only after this agreement.

## Not decided here

- A settings row to withdraw agreement. The person can still stop by not sending; a withdraw control is a small follow-up.
- Chat shows its generic failure when the sheet is declined (the chat screens were not edited in this change).
- Provider names are not listed in the sheet; the Privacy Policy covers them.

## Consequences

- The first generation, upload or chat message of each account shows the sheet once.
- No new dependency (SecureStore is already used). Unit-tested with a fake store; not run on a simulator in this slice.
