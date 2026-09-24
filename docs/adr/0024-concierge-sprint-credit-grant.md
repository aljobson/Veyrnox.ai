# ADR-0024 — Manual credit grants for the concierge sprint test

- **Status**: Accepted (2026-09-13)
- **Date**: 2026-09-13
- **Deciders**: Product owner (Al Jobson)
- **Related**: [ADR-0022 — Manual credit grant for provider live tests](0022-manual-test-credit-grant.md), [ADR-0018 — Credit Pack Top-ups](0018-credit-pack-top-ups.md), #91, #101

## Context

Veyrnox.ai has no paying customers. The product owner is testing demand by
selling a hand-delivered ad sprint to performance marketers and agency
owners: 20 ad concepts, each in 1:1, 4:5 and 9:16 (60 image files), in 48
hours, for a fixed price paid by direct invoice. The founder makes the images
in production Veyrnox. The test is judged on 2026-09-27: three or more sprints
paid and not refunded passes.

Generating those images needs credits on a founder-owned production account.
The ways to get them:

- **A Top-up** does not work. Production LemonSqueezy runs in test mode
  (`LEMONSQUEEZY_TEST_MODE` is `"true"` in `wrangler.jsonc` until #101), so a
  test-card checkout would create Pack Credits with no money received, and a
  fake Top-up would appear in the Top-up reconciliation and ops data.
- **ADR-0022** covers only provider live tests on the test account. Reusing it
  for sales work would stretch a narrow approval.
- **Generating on the provider consoles** (fal, kie, OpenRouter) skips
  Veyrnox entirely, so the test would not exercise the product being sold.

CLAUDE.md allows credits only through `signup_grant` or `ledger_grant`, and a
manual grant needs an ADR and a `reason` naming the human who decided.

Credit cost per image, read from the live production `model_catalog` on
2026-09-13 (active image models): `flux-2-pro` 2, `seedream-4` 3,
`nano-banana` 3. The repository agrees: `0020_floor_pricing_and_veo_fast.sql`
set `nano-banana` to 4, and `0027_correct_fal_costs_from_watcher.sql` brought
it to 3 once the cost watcher showed the recorded $0.06 per image was really
$0.039, which holds a 60.6% margin at 3 credits. There is no catalog drift.
One sprint is 60 delivered images. Allowing one discarded attempt per
delivered image, a sprint on the most expensive live model costs
60 × 2 × 3 = 360 credits. A 500-credit grant leaves room for the revision
round.

## Decision

Grant credits to one founder-owned production account in stages, each grant
tied to a step of the test, so unpaid work never gets a grant.

| Grant | When | Credits | Reason text |
|-------|------|---------|-------------|
| Practice | Once, before the first offer is sent | 500 | `grant:manual Al Jobson concierge practice` |
| Sprint | Once per sprint, after its invoice is paid | 500 | `grant:manual Al Jobson concierge sprint <invoice number>` |

- Call: `public.ledger_grant(<founder account user id>, 500, '<reason text>')`.
- Ceiling: 3,500 credits in total (1 practice + up to 6 sprints). This covers
  the Pass band and a one-week Middle-band extension. More needs an amendment
  to this ADR.
- The founder account's email is recorded in the first entry appended below.
- Each grant is approved by the product owner in chat, with its reason text,
  before it runs.
- `ledger_grant` takes no idempotency key. **Superseded 2026-09-20:** `supabase/0073` added a 4-argument overload that does, plus a unique index. Pass a key and skip the manual pre-check below. Before every call, query
  `ledger_entries` for that account and exact reason text. If a row exists,
  do not call again. The per-invoice reason makes each sprint grant unique.
- The credits are paid-equivalent (`free_delta` 0) and are spent only on
  concierge sprint work: the practice sprint, paid sprints, and their one
  revision round.

## Consequences

- `credit_balances.balance = SUM(ledger_entries.delta)` still holds: every
  grant is an ordinary ledger row, not a balance edit.
- Provider spend on this account is a real cost and shows in the ops metrics.
  It is not revenue. Sprint revenue arrives by invoice, outside the ledger,
  so the ledger never records it. Reconciliation is unaffected because no
  Top-up rows are created.
- A refunded sprint does not claw back its grant. The credits were already
  spent on provider calls, and no money entered the ledger.
- Credits left when the test ends stay on the founder account. They may be
  used only for a later sprint or a provider live test under ADR-0022.
- Once #101 launches Credit Packs with live payments, future sprint credits
  should come from real Top-ups on the founder account instead, and this ADR
  is closed to new grants.

## Open questions

- If the live `credits_5s` of the chosen model rises above 4 before a grant,
  recompute the 500-credit stage.
- Commercial-use terms of the chosen model for client ads must be confirmed
  before the first offer.

## Grant log

_None yet. Append one line per grant: date, reason text, ledger entry id,
balance before and after._
