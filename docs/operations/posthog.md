# PostHog activation and rollback

The code is safe to deploy without PostHog configuration: it renders no consent panel, initializes no SDK, returns 404 from `/ingest`, and sends no events.

## Before activation

1. Create a PostHog Cloud EU project. Do not use a US project with this configuration.
2. Set project retention to no more than 12 months for analytics/error events and 30 days for session replay, matching the Privacy Policy.
3. Restrict project membership to people who need production diagnostics, require MFA, and record who can view replays.
4. Confirm data deletion is available for a supplied distinct id. Veyrnox sends only the Supabase auth id for signed-in people.
5. Create a build-only personal API key with the narrowest source-map write permission. It is not the public project token.

## Configuration

- GitHub environment variable `NEXT_PUBLIC_POSTHOG_KEY`: the public `phc_…` project token.
- GitHub environment variable `NEXT_PUBLIC_POSTHOG_REPLAY_SAMPLE_RATE`: a number from `0` to `1`; production is temporarily `1` for deterministic replay validation.
- GitHub environment variable `POSTHOG_PROJECT_ID`: the EU project id.
- GitHub environment secret `POSTHOG_PERSONAL_API_KEY`: build-only source-map key.
- Local development: put the same names in `.env.local` only when testing the integration. Never commit that file.

The public token alone enables consented events and replay. Source-map upload additionally requires both build-only values. The replay rate defaults to 20% when the sampling variable is missing or invalid and is bounded to the inclusive `0`–`1` range. At `1`, the consent manager explicitly overrides PostHog's sampling control so every separately consented eligible session can be validated; project-level replay must still be enabled. Consent, sensitive-route exclusions and masking apply to every recording. Lower the environment value and redeploy after deterministic validation is complete.

## First-release checks

1. With fresh browser storage, confirm no request to `/ingest` occurs before a choice.
2. Decline, reload, and confirm there is still no ingest request and Privacy choices can reopen the panel.
3. Choose Analytics only. Confirm one path-only `$pageview`, interaction events with no text/attributes, Web Vitals, and no replay snapshots.
4. Choose Analytics & replay. Confirm an eligible page records a masked replay, then visit `/auth`, `/app/account`, `/app/admin` and `/app/credits` and confirm recording stops.
5. Sign in and sign out. Confirm PostHog sees only the opaque auth id while signed in and a new anonymous identity afterwards; switch accounts in one browser and confirm the two people are not merged.
6. Trigger a harmless test browser exception and a test server render exception in staging. Confirm both group correctly, contain no error input/message, link to a replay only where consent allowed, and resolve to source with the uploaded maps.
7. Inspect captured properties before production activation. Any prompt, chat text, input value, query string, referral/OAuth/payment token, email, media URL, console line, network body or network header is a stop-ship defect.

## Rollback

Remove `NEXT_PUBLIC_POSTHOG_KEY` from the build environment and redeploy. This disables the SDK, consent UI, error capture and replay together and makes `/ingest` return 404. Removing only the personal key stops future source-map uploads but does not stop collection.
