# ADR-0067 amendment 18 (2026-11-14): chat prices at the dearest provider endpoint, 50% margin on every row

- **Status**: Proposed. The owner asked for every LLM to keep a 50% margin; they accept this by merging the change and
  approving the apply-migrations run for 0519.
- **Amends**: [ADR-0067](0067-chat-replies-are-jobs.md) amendment 2 (option prices) and
  [amendment 17](0067-amendment-17-long-messages.md) decision 3. A file of its own because ADR-0067 is at the 500-line limit.
- **Scope**: migration 0519 only. No code changes: every screen reads chat prices from the catalog.

## Context

Each chat price is flat and pays for a recorded worst case (`provider_cost_per_unit` and the `chat_*_extra_cost` columns),
priced at the margin floor `credits >= ceil(cost / 0.01796)`. $0.01796 of provider cost per Credit is what leaves half of a
Credit's selling price after payment fees ([docs/pricing/50-percent-margin.md](../pricing/50-percent-margin.md), ADR-0014 as
updated by ADR-0037), so the floor already is the 50% rule. The recorded rates came from OpenRouter's headline list on
2026-10-05. Two have since gone up (Gemini 3.8 Flash $0.75 -> $0.825 input, $3.75 -> $4.125 output; Llama 4 Maverick $0.19 ->
$0.35, $0.65 -> $1.00).

The headline rate is not the worst case. The adapter routes with only `provider: { data_collection: 'deny' }`: no provider
order and no price cap, so OpenRouter may serve a reply from any standard-tier endpoint of the model. Its endpoint list
(`GET /api/v1/models/<slug>/endpoints`, public) shows regional endpoints about 10% dearer than the headline (Bedrock
us-east-1 and eu-west-1, Vertex us and europe, Azure us and eu, Mistral eu and us).

## Decision

1. **The recorded rate is the dearest standard-tier endpoint** of the model, or the rate already recorded if that is higher.
   Opt-in tiers (flex, priority, fast, ultrafast) are left out: a request only gets one by asking for it.
2. **Every recorded worst case is recomputed at that rate** with the shapes already in force (base 0194/0196, Thinking 0197,
   capped Web search 0220, Images 0198, long text 0517), and **every price is the margin floor**, rounded up to whole Credits.
   No price is lowered in this change.
3. **Deep research is unchanged**: Sonnet's $0.0400 extra still covers the plan and four Mistral Small searches at +10%
   ($0.0362), and 7 Credits still cover a whole run with the write at the cap.

| Row | Input $/M (was) | Output $/M (was) | Base cost (was) | Base Credits | Thinking cost (was) | Thinking Credits |
|---|---|---|---|---|---|---|
| Claude Opus 5.5 | 4.40 (4.00) | 22.00 (20.00) | 0.1298 (0.1180) | **8 (7)** | 0.0902 (0.0820) | **6 (5)** |
| Claude Sonnet 5.5 | 2.20 (2.00) | 11.00 (10.00) | 0.0649 (0.0590) | 4 | 0.0451 (0.0410) | 3 |
| GPT-6.1 Sol | 2.20 (2.00) | 11.00 (10.00) | 0.0649 (0.0590) | 4 | 0.0451 (0.0410) | 3 |
| Grok 4.7 | 2.20 (2.00) | 6.60 (6.00) | 0.0497 (0.0452) | 3 | 0.0271 (0.0246) | 2 |
| Gemini 3.8 Flash | 0.825 (0.75) | 4.125 (3.75) | 0.0244 (0.0222) | 2 | 0.0169 (0.0154) | 1 |
| GPT-6 Luna | 0.11 (0.10) | 0.55 (0.50) | 0.0033 (0.0030) | 1 | 0.0023 (0.0021) | 1 |
| DeepSeek V4.1 Flash | 0.45 (0.30) | 1.80 (1.20) | 0.0115 (0.0077) | 1 | 0.0074 (0.0050) | 1 |
| Llama 4 Maverick | 0.35 (0.19) | 1.15 (0.65) | 0.0044 (0.0024) | 1 | - | - |
| Ministral 14B | 0.22 (0.20) | 0.22 (0.20) | 0.0023 (0.0021) | 1 | - | - |
| Mistral Small | 0.165 (0.15) | 0.66 (0.60) | 0.0022 (0.0020) | 1 | - | - |
| Editor AI edit (Gemini) | 0.825 (0.75) | 4.125 (3.75) | 0.0244 (0.0222) | 3 | - | - |

Web search, Images and long-text costs move by the same rates (figures in 0519); none of their Credits change.

## Consequences

- **One visible price change: Claude Opus 5.5.** A plain reply goes from 7 to 8 Credits, a Thinking reply from 12 to 14, and
  the amendment 17 example of a long Opus message from 9 to 10. At the headline rate Opus cleared 7 and 5; only the regional
  endpoints push it over.
- Every other row keeps its Credits, with a higher recorded cost, so its margin at the worst case is still at least 50%.
- Rows that could be cheaper: the editor AI edit row (3 Credits, floor 2) and DeepSeek V4.1 Flash, whose headline rate fell to
  $0.0507 / $0.2028 (it stays 1 Credit, the minimum). Neither is lowered.
- The routing could instead be capped (`provider.max_price` or a price-sorted order) so the headline rate is the worst case.
  That is an adapter change on the money path and is not part of this amendment.
- Rates drift. The next check reads the same endpoint list and recomputes with `scripts/test-chat-prices-margin.mjs`'s table.

## Checked

- `scripts/test-chat-prices-margin.mjs` (ledger-tests.yml, full replay): 0519 applied twice; every recorded cost at or above
  the worst case at the table's rates; every price at or above the floor; no price lower than before; only Opus changed;
  the CHECK refuses the old Opus Thinking price.
- `node scripts/check-catalog-update-guards.mjs`: the three UPDATEs assert their exact row counts.
