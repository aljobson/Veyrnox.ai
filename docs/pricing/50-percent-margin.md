# 50% contribution-margin requirement — 2026-09-24

The owner requires 50% margin across the offer. This supersedes the initial
proposal to match generation credits even where contribution was only positive.
The target here is revenue less provider and payment fees, divided by revenue.
It is not a guarantee of 50% net profit after all operating costs.

Assumptions: proposed $129/3000 pack, all credits used, payment fees 8% of
pre-tax price + $0.30 per purchase. Actual account fees, FX, tax fee base,
storage, support, refunds, retries and fixed overhead remain unverified.

At $0.043/credit, payment fees consume $0.00354/credit. To leave half the
selling price, provider cost must be at most $0.01796 per charged credit:

`minimum credits = ceil(provider cost / (0.043 × (1 - 0.08 - 0.50) - 0.30/3000))`

| Model | Recorded provider cost | Revised charge | Contribution margin |
|---|---:|---:|---:|
| Nano Banana (live kie) | $0.0200 | 2 credits | 68.5% |
| FLUX.2 Pro (live fal) | $0.0300 | 2 credits | 56.9% |
| Hailuo 02, 6s (live kie) | $0.1500 | 9 credits | 53.0% |
| Nano Banana Pro (live kie) | $0.0900 | 6 credits | 56.9% |
| Nano Banana Pro (staged GrsAI) | $0.0271 | 2 credits, conditional | 60.3% |

The revised migration keeps Nano Banana and FLUX at their existing 2 credits,
reduces Hailuo from 10 to 9 rather than 6, and retains all other model charges.
Recorded active generation costs clear this target under the fee assumption.
Clip Editor charges scale with duration; its per-second cost must be evaluated
against the duration-based debit, not as a fixed generation. Auto Short's
recorded composite cost and failed/retried steps need invoice-level validation.
These qualifications prevent claiming a verified all-cost 50% margin today.

## Non-FLUX candidates

Rates checked on fal's model pages, 2026-09-24. Calculations below assume ONE
billed megapixel, ONE image, and 1 Veyrnox credit. More megapixels cost more;
pin resolution and inspect actual charges before activation.

| Candidate | Provider cost per MP | Estimated contribution margin | Source |
|---|---:|---:|---|
| Sana v1.5 4.8B | $0.0100 | 68.5% | https://fal.ai/models/fal-ai/sana/v1.5/4.8b |
| Sana v1.5 1.6B | $0.0075 | 74.3% | https://fal.ai/models/fal-ai/sana/v1.5/1.6b |
| Sana Sprint | $0.0025 | 86.0% | https://fal.ai/models/fal-ai/sana/sprint |

Sana v1.5 4.8B is now integrated and staged inactive as an additional option
in migration 0119. The others remain candidates. None is claimed to be a
quality-equivalent FLUX replacement. Compare product shots, faces, text, hands and prompt adherence
before selection. Existing staged GrsAI Nano Banana Pro requires production
completion/refund validation and suitability assessment before activation.

Monthly pack value can match Higgsfield while this margin is maintained under
the assumptions. Exact generation-credit parity cannot also be promised for
every model at existing provider costs. Retain the 50% requirement and use
cheaper validated routes or higher generation-credit charges where necessary.
