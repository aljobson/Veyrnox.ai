# ADR-0037 — Match monthly credit value and selected generation charges

Status: Prepared for review, 2026-09-24. Not deployed.

The owner requested matching both Higgsfield's customer price and generation
credits. The read-only production catalog audit is in
`docs/pricing/parity-audit-2026-09-24.md`; its reproducible calculator is
`scripts/audit-pricing-parity.mjs`. Provider costs are recorded values, not a
fresh invoice verification. Competitor rates were read from
https://higgsfield.ai/pricing on 2026-09-24.

## First batch

0118 offers one-off packs of $19/270, $59/1200 and $129/3000 credits, matching
the credit value of Higgsfield's monthly Starter, Plus and Ultra plans. They
are not recurring subscriptions. The existing $10/100 entry pack remains;
the $25/300 and $75/1000 packs retire. Purchased credits still never expire.
No annual billing, unlimited generation or free-generation promotions are
promised. Annual Higgsfield pricing is a separate, cheaper benchmark.

Nano Banana becomes 1 credit (from 2), FLUX.2 Pro 1 (from 2), and nominal
6s/768p Hailuo 02 becomes 6 (from 10). No provider or output setting changes.
FLUX and Nano match published base charges; exact output quality equivalence
is not established. Other catalog prices stay unchanged, including Veo's
already lower credit charges.

At the lowest pack rate, $0.043 per credit, these yield provider-only margins
of 53.5%, 30.2% and 41.9%. After an ILLUSTRATIVE 8% + $0.30 fee per pack,
their contributions are $0.01946, $0.00946 and $0.08676 respectively. These
are not net profits: tax-base differences, FX, storage, retries, refunds,
support and other overhead are excluded. Stripe Managed Payments publishes
3.5% on top of processing (https://stripe.com/managed-payments); the actual
account's all-in fee has not been verified.

This intentionally supersedes ADR-0014's 50% provider-margin requirement for
these three rows and ADR-0018's $0.075 sticker floor with a $0.043 floor.
The old net-floor CHECK stays as an additional constraint, not a claim that
its LemonSqueezy formula represents current Stripe fees. It passes these packs.
`packages/catalog/index.ts` is a stale historical spreadsheet transcription,
not the active database catalog; do not use it to certify this rollout.

## Remaining blockers to full parity

- Nano Banana Pro on live kie costs $0.09 versus $0.086 target revenue. The
  staged GrsAI route costs $0.0271 but is inactive; complete deployed gateway,
  polling, R2 and refund validation and establish suitability before switching.
- Wan 2.5 at 7 credits has only $0.001 above provider cost before any fees.
- Kling 2.6 without audio at 5 credits loses $0.06 before fees. Kling 3.0's
  8-credit comparison also loses money; confirm mode/resolution equivalence.
- Seedance Fast at 12 credits has little room for overhead after fees; its
  competitor headline and comparison-table estimates differ. Confirm actual
  generator charge before promising parity.
- Seedream's competitor version is unspecified; do not call v4/v4.5 equivalent.
- Other audio/editing models lack a verified comparable tier in this audit.

The user has been asked whether loss-making parity should be subsidised.
There is no approved subsidy amount, so 0118 contains no loss-making matches.

## Rollout and rollback

Guarded migration 0118 is atomic, repeatable and aborts on provider/cost/unit
drift, missing rows or conflicting new pack IDs. It does not touch top-ups,
jobs, grants or ledger balances. Stripe Checkout already snapshots price and
credits; purchases started before the change retain their original terms.

Apply through the owner-reviewed production migration workflow (ADR-0023),
then verify the public pack/model APIs and signed-in generation price.
This change synchronises UI fallback and preset numbers and removes hardcoded
signup generation estimates. Apply the migration before deploying these fallback
changes; the live catalog remains authoritative. Keep this PR draft until that
rollout sequence and the payment-fee budget have been reviewed.

Rollback uses a new guarded migration restoring model charges 2/2/10,
retiring the new packs and reactivating the old ones. Restore the $0.075
sticker constraint only after handling the cheaper inactive rows, because
the CHECK applies to inactive rows too. Never delete historical pack rows
or rewrite any purchased balance or existing top-up.
