# Crun Suno music: activate, roll back, operate (ADR-0376)

Songs are built to run on Crun's Suno (`suno/music-generate`) with fal as standby, and ship DARK: migrations 0584-0586 add schema and two standby, unverified Crun routes beneath `ace-step` and `ace-step-1.5`. Nothing flips until the **OWNER** runs the transaction in section 3. Rehearse everything on staging first. SQL here is reviewed text to paste into a reviewed session, never a committed migration.

Project ids: production `xdxdzmsztyzbnzeforxx`, staging `nszlbcmcysftwyudthjz` (check `list_projects`: "Veyrnox PRODUCTION (live)" is not the live project).

## 1. Preconditions (all must be true)

1. Migrations 0584, 0585 and 0586 are applied by the `apply-migrations` workflow (never by hand on production), and the Worker with the matching code is deployed. Deploy order: migrations first, then the Worker; a Worker without them fails closed.
2. **Crun's written answer** (to the owner's email) covers: music generation through Suno on credits (Terms 6.2 names only images and videos), reselling the generated audio to our customers in a paid product, who holds the rights and any upstream Suno licence, idempotency or lookup, failed-task credit treatment, CreateTask limits beyond 20 per 10 s, and audio URL and credit expiry. Keep the email with the activation record.
3. Privacy policy and sub-processor list updated for Crun (US hosted, prompts and lyrics sent, logs keep them 2 months, generated files 14 days).
4. The paid staging probe passed (section 2) and its evidence is saved.
5. Secrets in place: `CRUN_API_KEY` set with `wrangler secret put`, `CRUN_ENABLED` is exactly `"true"` (the Worker is at its 67-var binding cap: no new variable exists for music). The key's hourly/daily caps are sensible; leave the IP whitelist OFF (Workers have no fixed egress IP).
6. Margin check: `credits x 0.033 >= 2 x cost` (4 x 0.033 = 0.132 >= 0.1072). Re-run it with the real cost from the probe and `estimate-credits`.

## 2. Paid staging probe (OWNER approves the spend)

On staging with a staging Crun key, create ONE song pair and record: the exact final host and any redirect of `suno_audio_url`; the Content-Type and magic bytes of the file; the real Suno model that ran (`v6`, docs and homepage disagree); the credits charged vs `estimate-credits` (12 expected, $0.0536); the TaskInfo status words and `result.code` shape; and one forced refusal (input over a limit) to see the 4xx body shape. Then add ONLY the verified host(s) to the Crun audio allowlist (`packages/adapters/r2Copy.js`, with allowed-host, lookalike-host and redirect tests) and ship that change before activation. Until then settlement fails closed with a typed alert and the route must stay standby.

The probe is also when the missing "model disabled" response (if Crun has one) is identified so the (endpoint, model) breaker can be wired to it.

## 3. Activate (one transaction, OWNER)

Replace the placeholders. The legal and probe evidence goes into `parity_record` (active routes require it) and the provenance moves from `unverified` only after the written Crun answer.

```sql
BEGIN;
-- 1. Evidence-bearing provenance + parity for BOTH offers' Crun routes.
UPDATE public.model_routes
   SET provenance = 'licensed_reseller',
       parity_record = '<probe date, probe job ids, Crun written answer reference>',
       state = 'active', updated_at = now()
 WHERE supplier = 'crun' AND endpoint = 'crun:suno/music-generate'
   AND model_id IN ('ace-step', 'ace-step-1.5');
-- exact ROW_COUNT must be 2: abort if not.

-- 2. Customer price: 4 credits per candidate (catalog value read by quotes; reorder does NOT change credits).
UPDATE public.model_catalog SET credits_5s = 4, updated_at = now() WHERE id IN ('ace-step', 'ace-step-1.5');
-- exact ROW_COUNT must be 2.

-- 3. Put Crun first for each offer. Every ACTIVE route of the offer must be listed.
SELECT public.model_route_reorder('ace-step',
  ARRAY[(SELECT id FROM public.model_routes WHERE model_id='ace-step' AND supplier='crun' AND endpoint='crun:suno/music-generate'),
        (SELECT id FROM public.model_routes WHERE model_id='ace-step' AND supplier='fal')], 'crun suno activation');
SELECT public.model_route_reorder('ace-step-1.5',
  ARRAY[(SELECT id FROM public.model_routes WHERE model_id='ace-step-1.5' AND supplier='crun' AND endpoint='crun:suno/music-generate'),
        (SELECT id FROM public.model_routes WHERE model_id='ace-step-1.5' AND supplier='fal')], 'crun suno activation');
-- each result must be {"ok": true}; the RPC syncs catalog provider, endpoint, cost, cost unit, billing seconds and updated_at.

-- 4. Assert the final state before COMMIT.
SELECT id, provider, provider_endpoint, credits_5s, provider_cost_per_unit FROM public.model_catalog WHERE id IN ('ace-step','ace-step-1.5');
-- expect provider 'crun', endpoint 'crun:suno/music-generate', credits_5s 4, cost 0.0536.
COMMIT;
```

Quotes made before the transaction are stale (`updated_at` changed) and the entitlements read the catalog fresh, so the first request after COMMIT sees the Crun contract. Then make one real song and watch it end to end (section 5).

## 4. Roll back to fal (one transaction, OWNER)

Do not depend on the breaker being closed: a tripped breaker makes `model_route_reorder` refuse the Crun route, so take Crun out of play first.

```sql
BEGIN;
UPDATE public.model_routes SET state = 'standby', updated_at = now()
 WHERE supplier = 'crun' AND endpoint = 'crun:suno/music-generate' AND model_id IN ('ace-step', 'ace-step-1.5');
-- exact ROW_COUNT 2.
SELECT public.model_route_reorder('ace-step',
  ARRAY[(SELECT id FROM public.model_routes WHERE model_id='ace-step' AND supplier='fal')], 'crun suno rollback');
SELECT public.model_route_reorder('ace-step-1.5',
  ARRAY[(SELECT id FROM public.model_routes WHERE model_id='ace-step-1.5' AND supplier='fal')], 'crun suno rollback');
UPDATE public.model_catalog SET credits_5s = 2, updated_at = now() WHERE id = 'ace-step';
UPDATE public.model_catalog SET credits_5s = 3, updated_at = now() WHERE id = 'ace-step-1.5';
-- exact ROW_COUNT 1 each; then assert provider 'fal' and endpoints 'fal-ai/ace-step' and 'fal-ai/ace-step-1.5'.
COMMIT;
```

Jobs already submitted to Crun stay on their retained route and settle through the Crun sweep; rows still READY or DEFERRED can be cancelled by the owner, which refunds once. Songs made under the Crun contract keep it (`provider_contract` is immutable) and stay reusable only while they fit the fal draft limits.

## 5. Operate

Watch: `crun_dispatch` rows by state and age; any UNKNOWN; READY older than a few minutes (circuit or limiter); `jobs` with `provider='crun'` still SUBMITTED beyond 45 minutes; the account circuit (`provider_spend_provider_policy` Crun row) and `crun_suno_model_breakers` where `is_open`; `reconcile_balances()`, `reconcile_free_credits()` and `reconcile_top_ups()` must stay at zero rows.

- **UNKNOWN submit** (timeout or transport, no task id; Crun has no lookup or idempotency key). Alert fires on every one. After 10 minutes, find the task in the Crun logs page (crun.ai/logs, by prompt, time and credits). Task found: `SELECT public.reconcile_crun_dispatch_unknown('<job>', '<attempt_token>', 'ACCEPTED', '<task_id>');`. Not found or unsure: `... 'REJECTED', NULL)` refunds the candidate once, accepting at most one wasted $0.0536 task. A REJECTED before 10 minutes returns `UNKNOWN_TOO_YOUNG`.
- **Account circuit paused (401/402/403: key, credits, disabled).** Fix the cause (balance top-up, key). Then `SELECT public.resume_crun_account_admission(<fence>);` with the fence read from the policy row. Image, video, swap and music all observe the same circuit. Held READY rows refund themselves as `supplier_unavailable` after 20 minutes if it stays closed.
- **Route breaker tripped (455 maintenance or 505 disabled).** Every `crun:suno/music-generate` route is tripped. Reopen the routes through the route admin RPC once Crun confirms service is back; consider rolling back to fal (section 4) if the outage is long.
- **Suno model disabled.** A row in `crun_suno_model_breakers`; reopen with `SELECT public.reopen_crun_suno_model_breaker('crun:suno/music-generate', '<v6|v6_mini|v6_wild>', <fence>);` after the model returns.
- **Accepted task unreadable or pending beyond 45 minutes.** Never auto-refunded. Check the task in the Crun logs; resolve by the operator RPCs, or wait. Credits are only returned on an authoritative failure.
- **Crun media deleted after about 14 days:** the song is copied to R2 on first read; a song that never settled before then cannot be recovered.
- **Support:** Crun support hours are UTC 21:00-17:00, no SLA, email `support@crun.ai` (one docs page says `support@curn.ai`: use the address on the quickstart).

## 6. After

Record the activation date, the probe evidence and the Crun answer in the ADR record. Re-check the first Crun invoice against $0.0536 per request (the docs also quote $0.005 per credit for usage reports, which implies $0.06): if the real cost is higher, re-run the margin assertion and reprice with a new activation transaction, never in code.
