# Prepaid provider balances — owner/operator runbook

Owner: the repository owner, who holds every provider account.

fal.ai, kie.ai, OpenRouter and GrsAI are prepaid: the owner tops each balance up
by hand. When one reaches zero the provider refuses the submit, the job is
recorded through `lib/submitRejection.js` and `ledger_refund` returns the
customer's credits, so no money is lost. But every model on that provider is
down until the owner notices and tops up, and nothing in the app read a balance
until this watch (2026-10-10). Subscriptions (ADR-0064) will raise steady monthly
spend once enabled, which makes an unnoticed empty balance more likely.

## What runs

`.github/workflows/provider-balances.yml` runs `scripts/check-provider-balances.mjs`
hourly on `main`, the same shape as `signup-gate` and `recovery-health`. The
script reads each balance through the provider's own read-only endpoint
(`scripts/lib/provider-balances.mjs`: one fixed URL per provider, a 15-second
timeout, a 64 KB body cap, the key in the `Authorization` header and nowhere
else) and compares it with a floor.

| Exit | Meaning | What happens |
| --- | --- | --- |
| 0 | Every balance is above its floor | Nothing |
| 1 | A balance is at or under its floor | One `provider-balance` issue per episode |
| 2 | A balance could not be read (no key, 401, 403, 429, 5xx, timeout, bad shape) | One `provider-balance` issue per episode: could not check is never a pass |

While a `provider-balance` issue is open no second one is filed; the hourly job
summary shows the current state. Close the issue after the top-up once a run
is green. No run moves money or touches the Worker.

The report says `ok`, `LOW` or `UNREADABLE` per provider and names the floor,
never the balance: the repository, its Actions logs and its issues are public.
`node scripts/check-provider-balances.mjs --show-figures` prints the figures
for a run at your own terminal.

## Coverage

| Provider | Covered | How | Why not |
| --- | --- | --- | --- |
| fal.ai | yes | `GET https://api.fal.ai/v1/account/billing?expand=credits` → `credits.current_balance` (USD). Needs permission `billing:usage:read`, which the `BILLING`, `READONLY` and `FULL` presets carry and the `API` preset (the Worker's `FAL_KEY`) does not. | |
| kie.ai | yes | `GET https://api.kie.ai/api/v1/chat/credit` → `data` (kie credits). kie answers HTTP 200 even on failure, so `code !== 200` is a failure. | |
| OpenRouter | yes | `GET https://openrouter.ai/api/v1/credits` → `total_credits - total_usage` (USD). Management key only; a regular key gets 403. | |
| GrsAI | no | | Its documentation (`grsai.com/dashboard/documents`) lists only `/v1/draw/nano-banana` and `/v1/draw/result`. The console shows a balance, but that is a signed-in dashboard, not an API for the key we hold, and this watch does not scrape dashboards. GrsAI runs one row (Nano Banana Pro) and its own console offers a credit alert at a threshold; set that there. |
| BytePlus | n/a | | Postpaid and staged inactive. |

## Floors

A fixed floor per provider, in the unit the provider's endpoint returns. Days of
trailing spend was not chosen: kie documents no usage endpoint, OpenRouter's
per-key usage figures are for the key and not the account, and a second read per
provider doubles what can fail. A fixed floor is one number the owner can set
from the fal usage page and the kie and OpenRouter dashboards.

| Provider | Default | Repository variable |
| --- | --- | --- |
| fal.ai | 20 USD | `PROVIDER_BALANCE_FLOOR_FAL_USD` |
| kie.ai | 4000 credits (about $20 at kie's listed $0.005 a credit) | `PROVIDER_BALANCE_FLOOR_KIE_CREDITS` |
| OpenRouter | 10 USD | `PROVIDER_BALANCE_FLOOR_OPENROUTER_USD` |

The defaults are in `PROVIDERS` in `scripts/lib/provider-balances.mjs`. A
variable that is not a non-negative number makes that provider `UNREADABLE`, so a
typo cannot read as a pass. At or under the floor is `LOW`. Pick a floor that
buys at least a day of spend at the busiest recent day, so the hourly check
gives notice before the provider refuses.

## Turning it on (owner)

Nothing runs until step 4. Each key is an Actions secret only; none goes on the
Worker.

1. **fal:** on fal.ai, create a key on the `BILLING` preset (or `READONLY`; it
   must carry `billing:usage:read` and should not carry
   `models:requests:submit`). Save it as the Actions secret `FAL_BILLING_KEY`.
2. **kie:** kie has one key type, so any kie key can also spend. Create a
   second API key on kie.ai for this watch and save it as `KIE_BALANCE_API_KEY`,
   so it can be revoked without touching the Worker's `KIE_API_KEY`.
3. **OpenRouter:** on the Management API Keys page, create a Management key
   with an expiry (OpenRouter sets one at creation; a leaked Management key
   can create, edit and delete the account's API keys, and it cannot run
   inference). Save it as `OPENROUTER_MANAGEMENT_KEY`. Put the expiry date in
   your calendar: an expired key makes the run `UNREADABLE`, which files an
   issue, and the fix is a new key.
4. Set the repository variable `PROVIDER_BALANCE_WATCH_ENABLED` to `true` and
   dispatch `provider-balances` once from Actions. A green run with three `ok`
   lines means the watch is live; any `UNREADABLE` line names the key to fix.

To stop the watch, set the variable to anything but `true`. To rotate a key,
replace the secret; the next run proves it.

## Triage

- **`LOW`:** top up that provider in its billing dashboard. Check the hourly
  summary turns green, then close the issue. If the same provider goes low
  often, raise its floor or the top-up size.
- **`UNREADABLE … no key in the environment`:** the secret is missing or empty.
- **`UNREADABLE … 401`:** the key was revoked or (OpenRouter) expired.
- **`UNREADABLE … 403`:** the key lacks the permission: a fal key on the
  `API` preset, or an OpenRouter key that is not a Management key.
- **`UNREADABLE … 429 / 5xx / no answer`:** the provider's side. Re-run; if it
  holds, check the provider's status page. Do not assume the balance is fine.

## When a provider does refuse for funds

kie documents code `402` ("Insufficient Credits") on both submit endpoints.
`packages/adapters/kie.js` types that refusal as `provider_payment_required`,
so `jobs.error_code` says the kie balance was empty; the customer's refund is
unchanged (`packages/db/submit-rejected.acceptance.test.ts`). OpenRouter and
BytePlus already type HTTP 402 the same way. fal documents no status or error
type for a locked account ("your account is locked and API requests will be
rejected" is all the FAQ says), and GrsAI documents no insufficient-credits code,
so neither is mapped: a guess would mislabel other refusals. If either is seen
live, capture the status and body shape in a test fixture first, then map it.
