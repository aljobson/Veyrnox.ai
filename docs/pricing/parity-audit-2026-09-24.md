# Veyrnox / Higgsfield parity audit — 24 September 2026

Exact-parity counterfactual, superseded for rollout by the 50% margin requirement in 50-percent-margin.md. No production prices changed. Costs are recorded catalog costs, not a fresh provider invoice audit.

[Higgsfield source](https://higgsfield.ai/pricing). Full tier assumptions are in higgsfield-2026-09-24.json.

Fee scenario: 8% of pre-tax pack price + $0.3 per purchase. This is an assumption, not the verified Stripe account fee. Tax-base differences, FX, storage, retries, support and refunds are excluded.

Annual scenarios assume a full annual purchase and all monthly credits used. One-off packs at these rates would be a different commercial offer.

| Model / unit | Active | Current → target credits | Cost | Monthly Ultra revenue | Monthly contribution | Annual Ultra contribution | Qualification |
|---|---|---:|---:|---:|---:|---:|---|
| one Nano Banana image (kie) | yes | 2 → 1 | $0.0200 | $0.0430 | $0.0195 | $0.0104 | base-model |
| one Nano Banana Pro 2K image (kie) | yes | 6 → 2 | $0.0900 | $0.0860 | -$0.0111 | -$0.0293 | specified-tier |
| one Nano Banana Pro 2K image (grsai) | NO | 2 → 2 | $0.0271 | $0.0860 | $0.0518 | $0.0336 | staged |
| one FLUX.2 Pro image (fal) | yes | 2 → 1 | $0.0300 | $0.0430 | $0.0095 | $0.0004 | base-model |
| one Seedream image (fal) | yes | 2 → 1 | $0.0300 | $0.0430 | $0.0095 | $0.0004 | unconfirmed-version |
| 5s Wan 2.5 720p (kie) | yes | 19 → 7 | $0.3000 | $0.3010 | -$0.0238 | -$0.0875 | specified-tier |
| 5s Kling 2.6 without audio (kie) | yes | 17 → 5 | $0.2750 | $0.2150 | -$0.0777 | -$0.1232 | specified-tier |
| 5s Kling 3.0 1080p (fal) | yes | 34 → 8 | $0.5600 | $0.3440 | -$0.2443 | -$0.3172 | unconfirmed-mode |
| 6s Hailuo 02 768p (kie) | yes | 10 → 6 | $0.1500 | $0.2580 | $0.0868 | $0.0321 | specified-tier |
| 5s Seedance 2.0 Fast 720p (openrouter) | yes | 28 → 12 | $0.4536 | $0.5160 | $0.0199 | -$0.0894 | specified-tier |
| 8s Veo 3.1 Fast 720p (kie) | yes | 19 → 32 | $0.3000 | $1.3760 | $0.9627 | $0.6713 | extrapolated-duration |
| 8s Veo 3.1 720p (kie) | yes | 76 → 80 | $1.2500 | $3.4400 | $1.9068 | $1.1781 | extrapolated-duration |

## Models without a verified comparator

- ElevenLabs Sound Effects v2: 2 credits, recorded cost $0.0200 per priced unit. Keep existing charge pending a matching tier.
- ACE-Step 1.5 (music): 3 credits, recorded cost $0.0360 per priced unit. Keep existing charge pending a matching tier.
- Inworld TTS (speech): 2 credits, recorded cost $0.0200 per priced unit. Keep existing charge pending a matching tier.
- ACE-Step (music/SFX): 1 credits, recorded cost $0.0100 per priced unit. Keep existing charge pending a matching tier.
- Nano Banana Pro Edit: 10 credits, recorded cost $0.1500 per priced unit. Keep existing charge pending a matching tier.
- ElevenLabs TTS Turbo 2.5 (speech): 4 credits, recorded cost $0.0500 per priced unit. Keep existing charge pending a matching tier.
- MiniMax Speech 2.6 HD (speech): 7 credits, recorded cost $0.1000 per priced unit. Keep existing charge pending a matching tier.
- MMAudio v2 (sound effects): 1 credits, recorded cost $0.0080 per priced unit. Keep existing charge pending a matching tier.
- Bria Background Removal: 3 credits, recorded cost $0.0400 per priced unit. Keep existing charge pending a matching tier.
- Topaz Upscale 2x (up to 6 MP): 5 credits, recorded cost $0.0800 per priced unit. Keep existing charge pending a matching tier.
- Bria Expand: 3 credits, recorded cost $0.0400 per priced unit. Keep existing charge pending a matching tier.
- LatentSync lip sync (video + speech, up to 40s): 13 credits, recorded cost $0.2000 per priced unit. Keep existing charge pending a matching tier.
- Kling AI Avatar v2 (photo + speech, up to 10s): 35 credits, recorded cost $0.5620 per priced unit. Keep existing charge pending a matching tier.
- Auto Short (32s): 110 credits, recorded cost $0.7000 per priced unit. Keep existing charge pending a matching tier.
- ElevenLabs Dialogue v3 (up to 4 voices): 7 credits, recorded cost $0.1000 per priced unit. Keep existing charge pending a matching tier.
- Clip Editor (trim, join, add audio; up to 60s): 1 credits, recorded cost $0.0010 per second. Keep existing charge pending a matching tier.
- Veo 3.1 Lite (8s): 10 credits, recorded cost $0.1500 per priced unit. Keep existing charge pending a matching tier.

## Proposed monthly-price equivalent packs

| Pack | Price, excluding tax | Credits |
|---|---:|---:|
| starter-monthly equivalent, one-off | $19 | 270 |
| plus-monthly equivalent, one-off | $59 | 1200 |
| ultra-monthly equivalent, one-off | $129 | 3000 |

Keep paid credits non-expiring. These are proposed one-off equivalents, not implemented subscriptions. Annual billing, free-generation pools and unlimited promotions are outside this proposal.
