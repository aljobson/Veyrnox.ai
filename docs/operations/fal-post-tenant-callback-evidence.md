# Post-tenant staging callback evidence — 10 October 2026

The owner approved the [prepared sample](fal-post-tenant-callback-plan.md): one
FLUX.2 Pro image, two staging credits and approximately $0.03 of fal usage,
subject to fresh deployment/headroom checks. Generate was pressed exactly once.
The ordinary signed callback, asset storage and authenticated Library checks
passed. Provider dashboard history and request-specific billing remain
unmeasured while its Recent History page is stuck loading; do not count those
plan assertions as passed.

## Fresh preflight

Agent Reach's Chrome session identified aljobson and showed 0/10 concurrent
requests. The credit page then showed $1.69 available, auto top-up off, and the
warning that balances may lag usage by up to an hour. The older $2.95 observation
was not used as the available balance. Official model defaults and
[pricing](https://fal.ai/models/fal-ai/flux-2-pro) still supported the approved
approximately $0.03 estimate. No credit purchase or account setting change was
performed.

Read-only staging and production database checks at 11:35:57–11:35:59 UTC found
both capacity policies disabled, admission paused false, zero held reservations,
zero READY/STARTED/UNKNOWN dispatches, zero nonterminal direct fal jobs and no
nonterminal Veyrnox composite jobs. The catalog's active flux-2-pro entry cost
two credits and recorded provider_cost_per_unit 0.03 per generation.

Cloudflare showed staging `3ee58791` and production `e35b3acc` as Ready at 100%
traffic. Staging retained schema true and durable dispatch, queue publication
and submission outcome false; production retained all four false. Both fal
secret binding names were present and encrypted. No deployment or secret was
changed by this test.

## Correlated request and callback

| Observation | Evidence |
| --- | --- |
| Single browser submission | POST /api/v1/generations returned HTTP 200, state SUBMITTED and balance_after 717 |
| Application job | `7df0bfa3-7788-4afe-936b-212d28273d16` |
| fal request handle | `01a1259a-42b8-7080-91f5-6de382ff655e` |
| Created | `2026-10-10T11:37:08.640853Z` |
| Final state | STORED, error_code null, updated `2026-10-10T11:37:18.434834Z` |
| Creation to stored-row timestamp | 9.794 seconds; one sample, not an SLO percentile |
| Signed callback tenant header | `github\|nwp4eyxnrejkmv4b2jd0wxvw`, matching the verified aljobson tenant |
| Callback response | HTTP 200, Worker outcome ok; dashboard event at 12:37:18.380 BST / 11:37:18.380 UTC |
| Callback deployment | `3ee58791-55d1-4fea-bb90-5820fd826dd8` |
| Cloudflare request ID | `42870996db59f56eda05d2846e817789` |
| Callback wall time | 1398 ms; this is the observed Worker duration, not end-to-end generation latency |

The callback was observed live and then inspected in persisted Cloudflare logs
after refreshing the time range to include the sample. Its signed request-id
header matched the fal handle above, its user-id header matched aljobson, and
the response metadata showed 200 on the actual staging revision. The ordinary
handler verifies the tenant and signature before correlating and processing the
job. This is current signed-tenant evidence; the encrypted binding inventory
alone could not establish it. No raw signature, payload or signed URL is
retained in this report.

## Financial, storage and UI checks

Read-only job-specific queries found exactly one matching prompt/model job
created after the single button press, one fal inbox event with processed_at
`2026-10-10T11:37:18.347Z`, and one asset:
`365e1e19-9a2d-4ae5-8495-9f18e8700300`, image/jpeg, 110207 bytes. There was exactly
one ledger entry, delta -2 and reason debit:generation, with no refund. This
direct job had zero dispatch rows and zero capacity reservations, as expected
with durable dispatch disabled.

The authenticated owner Library showed the new teapot card as DONE, Flux.2 [pro]
and -2 credits. The balance changed from 719 to 717 and the asset count from 25
to 26. The image completed loading with natural dimensions 1024 by 768. Browser
network evidence also showed HTTP 200 from the authenticated job and asset URL
routes. These asset-route responses are JSON, not an independent R2 object HEAD;
no such HEAD is claimed. A screenshot was retained locally at
`/tmp/fal-post-tenant-library-pass.png`.

The callback proves the signed aljobson tenant for this staging request. A
matching provider-history entry and its individual billed cost have not yet
been read: Chrome's Recent History page remained on Loading requests. The $0.03
figure remains an estimate, not verified request-specific billing or an
isolated account balance delta. Do not run a second generation to obtain that
evidence. Production's current credential attribution is not established by a
staging request.

## Final state and limits

The counts-only staging health read at `2026-10-10T11:44:56.022Z` had all thirteen
recovery counts and all five reconciliation counts zero, with no unhealthy
tasks or issues. Separate database reads at 11:45:04–11:45:06 UTC again found
both policies disabled, zero held reservations and pending dispatches, and no
nonterminal direct fal or Veyrnox composite jobs. Fresh Cloudflare runtime
settings retained the expected staging and production flags. The live log view
was stopped; no new watcher or notification automation was created.

No production request, activation, migration, credential change, refund,
resubmission or fault injection was performed. This does not measure repeated
success callback deduplication, provider retries, sustained capacity or a
24-hour clean window. Both databases still cannot enforce one atomic shared
fal-account limit, and external montage submitters remain outside their policy.
See the [remaining release gates](fal-release-readiness-review-2026-10-10.md).

Reticle's local daemon reported no connected page, and its MCP tools were not
available in this client. No Reticle verdict is claimed for the deployed sample.
Live evidence above comes from browser network observation, Cloudflare callback
metadata, read-only database queries and authenticated image rendering. This
update changes documentation only; no application instrumentation was deployed.
