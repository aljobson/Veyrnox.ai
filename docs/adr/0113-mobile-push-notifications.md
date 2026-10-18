# ADR-0113 — Mobile push notifications

**Status:** Proposed 2026-10-18
**Related:** [ADR-0106](0106-mobile-app.md) (the app), [ADR-0111](0111-account-deletion.md) (erasure), roadmap slice S2 (`docs/mobile/ROADMAP-2026-10-17.md`), CLAUDE.md "Database" and "API gateway"

## Context

A video takes minutes. The app polls a job for ten minutes while its screen is open and learns nothing once it is backgrounded, so the person has to come back and look. The server has no device-token storage and no sender.

## Decision

### 1. Provider: the Expo push service

The app is Expo. Expo's service takes an Expo push token and forwards to APNs and FCM, so the Worker holds no Apple key, no Firebase service account and no JWT signing code. One `POST https://exp.host/--/api/v2/push/send` with plain `fetch` fits the Workers rules (no `jose`, no SDK). The URL is a constant, never built from input.

Direct APNs and FCM stay the fallback if Expo's service becomes a problem: the table keeps `platform`, and only `lib/pushNotifications.js` knows the provider. Expo's optional "enhanced security" access token is read from `EXPO_ACCESS_TOKEN` when set; it is a secret and is not required to start.

### 2. What sends a push at launch

Exactly two events, both about work the person started:

- **a generation finished** (`jobs.state = STORED`): "Your video is ready"
- **a generation failed** (`FAILED` or `REFUNDED`): "Your video didn't finish", with "Your credits were refunded." only when the ledger says `REFUNDED`

Chat turns are excluded (the reply is already on screen). The text never carries the prompt, the model or an amount: a lock screen is public. The payload's `data` holds the job id so the app can open the job.

Not at launch, and each needs its own decision: refunds and receipts, Cinema, Publish post results, referral rewards, anything promotional. **Nothing marketing is sent without an explicit consent control** that this ADR does not build.

### 3. Consent and opt-out

The operating-system permission prompt is the first consent: no token reaches the server unless the person allowed notifications. The second is `notify_jobs` on each device: `POST /api/v1/devices` with `notify_jobs: false` keeps the device registered and silent, and `DELETE` forgets it. A per-category preference screen is deferred until there is a second category.

### 4. Token lifecycle

| Moment | What happens |
|---|---|
| App start / sign-in | The app registers the token. Same call again is a no-op (no write, not counted against the limit), except `last_seen_at` refreshed at most once a day. |
| Token rotates | The app sends the new token with the same `device_id`; the old row for that install is deleted. |
| Another person signs in on the same phone | Registering a token already held by someone else moves it to the new account; the first loses it. |
| Sign-out | The app calls `DELETE /api/v1/devices` before it revokes the session. |
| Expo says `DeviceNotRegistered` | That token is switched off (`disabled_at`); registering it again switches it back on. Ticket-level errors only: Expo's later *receipts* are not read in this slice. |
| Not seen for 180 days | Deleted by the sweep's housekeeping. |
| Account deletion (ADR-0111) | A trigger on `users.deleted_at` removes the person's tokens, outbox rows and write log inside the same transaction as `erase_account`, so a rolled-back erasure keeps them and a finished one leaves none. `erase_account` itself is not redefined. |
| Limits | Ten devices per account (oldest give way); twenty effective writes per hour per account. |

### 5. How a push is triggered: a sweep, not the job path

A per-minute Cron task (`runPushSweep`) enqueues one `push_outbox` row per finished job (`UNIQUE (job_id, kind)`, so at most one push per outcome however many retries or sweeps), claims a batch with a lease, sends it, and records the outcome. Retries run at 2, 4 and 6 minutes; the fourth failed attempt closes the item.

It is a sweep rather than a call at each completion because jobs finish in ten places (fal, kie, OpenRouter, BytePlus and GrsAI sweeps, clip edit, Auto Short, montage, audio stems). A hook in each would put push code on the money path and miss a path the next time one is added. The sweep reads `jobs` and writes only `push_*` tables: **a failed, slow or broken push cannot change a job, a refund or the ledger**, and the job-completion code, whose webhook handlers already take the user from our own job row and never from the payload, is untouched.

A job older than two hours, or one that finished more than 15 minutes ago, is not announced, so switching the flag on never replays history and a late push is never sent. Latency is the cron interval, up to a minute.

### 6. The flag

`PUSH_NOTIFICATIONS_ENABLED` must be `"true"`; both the routes (404 otherwise) and the sweep check it. It is set in the staging block of `wrangler.jsonc` and **left out of production**, as `STORE_BILLING_ENABLED` is: an unset flag is off and production vars sit at the binding budget (`tests/workerBindingBudget.test.mjs`). Turning it on in production needs a slot freed first and the owner's word.

## Consequences

- The app gets two routes (the contract is the header comment of `app/api/v1/devices/route.js`): `POST /api/v1/devices` and `DELETE /api/v1/devices`, Bearer-only, inside the gate, so no entry in `routesOutsideGate`.
- Tokens are stored in the clear: sending needs them. They are table-only (RLS forced, no browser-role or direct `service_role` grant, access through `SECURITY DEFINER` functions), never logged and never returned by any route.
- Messages are English only. Localising them needs a per-device locale, deferred with the app's i18n slice.
- Still to do before production: the iOS push entitlement and Android FCM credentials in the app's EAS project (the mobile session's), a real-device delivery check on staging, and the flag.
