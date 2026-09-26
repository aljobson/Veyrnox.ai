# Wholesale price survey: every video and audio model, cheapest source — 26 September 2026

Question: what is the cheapest wholesale price we can buy each video and audio model at?

Companion files: `wholesale-survey-2026-09-26.json` (every row from every source, plus kie's
full 296-row video and audio rate card), `wholesale-survey-aggregators-2026-09-26.md` (the
13-aggregator tables with payment terms). Related: `syntx-competitor-analysis-2026-09-26.md`.

## Method and caveats

- Four parallel passes on 2026-09-26: fal.ai model pages, kie.ai's rate-card API, first-party
  developer pricing pages (Kling, MiniMax, Alibaba Model Studio, Google Vertex, OpenAI, Runway,
  Luma, xAI, ElevenLabs, Pika, Vidu, Hedra, HeyGen, Topaz), and 13 other aggregators. BytePlus
  ModelArk and kling.ai/dev/pricing were read the same morning.
- Clip costs are for a 5 second 16:9 clip unless the row says 6s or 8s. Where a vendor prices
  per second the 5s figure is per second times five. "na" is without audio, "a" is with.
- Only rows marked exact on the vendor's own page are used for the "cheapest" pick. Approximate
  rows and grey-channel rows are shown but not picked.
- Matching model names does not establish identical output. Aggregators often omit resolution
  and audio flags, and kie's per-video Kling 2.x rows do not state resolution.
- Promotions are shown separately and expire. MiniMax H3 Max promo ends 2026-09-30; BytePlus
  Seedance 2.0 Fast and Mini promos end 2026-10-07; Higgsfield API cashback ends 2026-09-30.
- Sora 2 and Sora 2 Pro were shut down by OpenAI on 2026-09-24. Every Sora row anywhere is
  historical. Kling has removed all pre-3.0 models from its own price list. MiniMax music is
  closed to new accounts. Suno has no official API at all.

## Payment terms that matter

| Source | Model | Minimum | Expiry | Notes |
|---|---|---|---|---|
| fal.ai | Postpaid, card | none | none | List price for almost everything. Kling and Veo at vendor list. |
| kie.ai | Prepaid credits, $0.005 each | $5 | never | 5% bonus at $500, 10% at $1,250. Failed jobs free. No official-sourcing statement; sells Suno. |
| BytePlus ModelArk | Postpaid, PAYG | none | n/a | Savings plans need $7,000 per month commitment for any discount, see below. |
| Kling direct | Prepaid packs | $700 for 5,000 units | 180 days, no rollover | 10% off from $3,780. 3.0-generation models only. |
| MiniMax direct | PAYG | none | n/a | Video packs $1,000 to $6,000 per month. |
| Alibaba Model Studio | PAYG | none | n/a | Singapore region, 50s free per model. |
| Google Vertex | PAYG | none | n/a | Only vendor publishing separate no-audio rates. |
| Runway API | Prepaid credits, $0.01 | none stated | none stated | Separate from app credits. |
| Luma API | PAYG Build plan | none | n/a | |
| Pika API | Prepaid | $10 per month membership | n/a | 5% platform fee included. |
| WaveSpeed | Prepaid | none | never | Tiers by single top-up size. |
| Atlas Cloud | Prepaid | none | 365 days | Markets "up to 68% off official". Below-list reseller. |
| Evolink | Prepaid | $10 | never | Labels each model Official or Beta channel. Veo and Grok are Beta. |
| PiAPI | Prepaid | none | not stated | Runs "connect your own Kling accounts" mode. Veo 40% under Google list. |

## Video: cheapest verified source per model

Cost is USD per 5s clip unless noted. "Us" is our recorded catalog cost on 2026-09-24. Floor
credits = ceil(cost / 0.01796), the 50% contribution rule from `50-percent-margin.md`.

| Model and unit | fal | kie | Direct | Other exact | Cheapest verified | Floor credits | Us today |
|---|---:|---:|---:|---|---|---:|---|
| Kling 2.1 Standard 720p | 0.28 (deprecated) | 0.125 | not listed | WaveSpeed 0.25, Together 0.18, MuAPI 0.225 | kie 0.125 | 7 | none |
| Kling 2.1 Pro 1080p | 0.49 (deprecated) | 0.25 | not listed | WaveSpeed 0.45, Together 0.32 | kie 0.25 | 14 | none |
| Kling 2.5 Turbo Pro | 0.35 | 0.21 | not listed | WaveSpeed 0.35 (std 0.21), Novita 0.35 | kie 0.21 | 12 | none |
| Kling 2.6 Pro na / a | 0.35 / 0.70 | 0.275 / 0.55 | not listed | WaveSpeed 0.35 / 0.70, PiAPI 0.33, Segmind 0.44 | kie 0.275 | 16 | kie 0.275, 17 cr |
| Kling 2.6 Standard na | n/a | n/a | not listed | WaveSpeed 0.21, PiAPI 0.20 | WaveSpeed 0.21 | 12 | none |
| Kling 3.0 720p na / a | 0.42 / 0.63 | 0.35 / 0.50 | 0.42 / 0.63 | WaveSpeed 0.42, Novita 0.42, Evolink 0.40 | kie 0.35 | 20 | none |
| Kling 3.0 1080p na / a | 0.56 / 0.84 | 0.45 / 0.675 | 0.56 / 0.84 | Novita 0.56, AI/ML 0.73 | kie 0.45 | 26 | fal 0.56, 34 cr |
| Kling 3.0 Turbo 720p / 1080p | n/a | 0.45 / 0.5625 | 0.56 / 0.70 | Evolink 0.53 | kie 0.45 | 26 | none |
| Kling O1 | 0.56 | n/a | not listed | WaveSpeed 0.42 std / 0.56 pro | WaveSpeed 0.42 | 24 | none |
| Kling motion control 5s | 0.56 | 0.275 (720p) / 0.45 | 0.63 / 0.84 | | kie 0.275 | 16 | none |
| Veo 3.1, 8s with audio | 3.20 (0.40/s) | 1.25 (720p) / 1.275 (1080p) | Vertex 3.20 (na 1.60) | WaveSpeed 3.20, PiAPI 1.92 (flag), Evolink 2.38 (Beta) | kie 1.25 | 70 | kie 1.25, 76 cr |
| Veo 3.1 Fast, 8s with audio | 1.20 | 0.30 / 0.325 | Vertex 0.80 (720p) / 0.96 | PiAPI 0.72 (flag), MuAPI 0.60, Evolink 0.32 (Beta) | kie 0.30 | 17 | kie 0.30, 19 cr |
| Veo 3.1 Lite, 8s with audio | 0.40 / 0.64 | 0.15 / 0.175 | Vertex 0.40 / 0.64 | WaveSpeed 0.40, MuAPI 0.30 | kie 0.15 | 9 | kie 0.15, 10 cr |
| Seedance 1.0 Pro Fast 720p / 1080p | 0.11 / 0.245 | n/a | BytePlus 0.10 / 0.24 | WaveSpeed 0.06 (res not stated), Runware 0.16 (1080p) | BytePlus 0.10 | 6 | none |
| Seedance 1.0 Pro 720p / 1080p | 0.27 / 0.62 | n/a | BytePlus 0.26 / 0.61 | WaveSpeed 0.30 / 0.60, Together 0.57 | BytePlus 0.26 | 15 | none |
| Seedance 1.5 Pro 720p na / a | 0.13 / 0.26 | 0.0875 / 0.175 | BytePlus 0.13 / 0.26 | WaveSpeed 0.26, MuAPI 0.34 | kie 0.0875 | 5 | none |
| Seedance 1.5 Pro 1080p na / a | 0.29 / 0.58 | 0.1875 / 0.375 | BytePlus 0.29 / 0.58 | | kie 0.1875 | 11 | none |
| Seedance 2.0 Mini 720p | 0.77 | 0.205 | BytePlus 0.38 list, 0.15 promo, 0.23 with resource pack | PiAPI 0.42, Atlas 0.12 (below list) | kie 0.205 steady; BytePlus pack 0.23 | 12 / 13 | none |
| Seedance 2.0 Fast 720p | 1.21 | 0.62 | BytePlus 0.60 list, 0.45 promo, 0.35 with resource pack | OpenRouter 0.454, PiAPI 0.48, Atlas 0.29 (below list), Evolink 0.75 | BytePlus pack 0.35 | 20 | OpenRouter 0.454, 28 cr |
| Seedance 2.0 Fast 480p | n/a | 0.295 | BytePlus 0.28 | PiAPI 0.24 | PiAPI 0.24, BytePlus 0.28 | 14 / 16 | none |
| Seedance 2.0 720p / 1080p | 1.52 / 3.41 | 1.025 / 2.55 | BytePlus 0.76 / 1.87; 0.47 / 1.04 with resource pack | Segmind 0.76 / 1.70, PiAPI 1.00 / 2.50, Evolink 1.00 / 2.49 | BytePlus pack 0.47 / 1.04 | 27 / 58 | none |
| Seedance 2.5 720p / 1080p | 2.37 / 5.82 | 1.575 / 3.95 | BytePlus 1.16 / 2.84; token package 0.69 / 1.55 | Segmind 1.19 / 2.94, WaveSpeed 1.80 / 4.50, Atlas 1.50 | BytePlus package 0.69 | 39 | none |
| Hailuo 02 Standard 768p, 6s | 0.27 | 0.15 | MiniMax 0.28 | WaveSpeed 0.28, Evolink 0.177 | kie 0.15 | 9 | kie 0.15, 9 cr |
| Hailuo 02 Pro 1080p, 6s | 0.48 | 0.285 | MiniMax 0.49 | WaveSpeed 0.49 | kie 0.285 | 16 | none |
| Hailuo 2.3 Standard 768p / 1080p, 6s | 0.28 / 0.49 | 0.15 / 0.25 | MiniMax 0.28 / 0.49 | Novita 0.28 / 0.49, Segmind 0.35 / 0.61 | kie 0.15 / 0.25 | 9 / 14 | none |
| Hailuo 2.3 Fast 768p / 1080p, 6s | n/a | n/a | MiniMax 0.19 / 0.33 | Novita 0.19 / 0.33, WaveSpeed 0.19 / 0.33 | MiniMax 0.19 | 11 | none |
| MiniMax H3 768p | 0.30 | 0.20 | MiniMax 0.40 | Runware 0.40, Evolink 0.38 | kie 0.20 | 12 | none |
| Wan 2.5 720p / 1080p | 0.50 / 0.75 | 0.30 / 0.50 | Alibaba 0.50 / 0.75 | Novita 0.50 / 0.75 | kie 0.30 / 0.50 | 17 / 28 | kie 0.30, 19 cr |
| Wan 2.6 720p / 1080p | 0.50 / 0.75 | 0.35 / 0.5225 | Alibaba 0.50 / 0.75 | Novita 0.50 / 0.75, Evolink 0.375 | kie 0.35 | 20 | none |
| Wan 2.6 Flash i2v 720p / 1080p | 0.25 / 0.375 | n/a | Alibaba 0.25 / 0.375 | | Alibaba or fal 0.25 | 14 | none |
| Wan 2.7 720p / 1080p | 0.50 / 0.75 | 0.40 / 0.60 | Alibaba 0.50 / 0.75 | Evolink 0.435 | kie 0.40 / 0.60 | 23 / 34 | none |
| Wan 3.0 720p / 1080p | n/a | 0.40 / 0.80 | Alibaba 0.50 / 1.00 (approx) | Runware 0.50 / 1.00 | kie 0.40 / 0.80 | 23 / 45 | none |
| Runway Gen-4 Turbo 720p / 1080p | not on fal | 0.06 / 0.15 | Runway 0.25 | WaveSpeed 0.50 | kie 0.06 (76% under Runway's own API, verify) | 4 | none |
| Runway Gen-4.5 | not on fal | n/a | Runway 0.60 | Runware 0.605 (approx) | Runway 0.60 | 34 | none |
| Runway Aleph 2.0 | not on fal | 0.55 | Runway 1.40 | | kie 0.55 | 31 | none |
| Luma Ray 3.2 720p / 1080p | 1.00 / 2.00 | n/a | Luma 0.30 / 1.20 | | Luma 0.30 | 17 | none |
| Grok Imagine video 720p / 1080p | 0.35 (v1) | 0.1125 / 0.20 | xAI 0.25 (res not split) | WaveSpeed 0.25, Evolink 0.10 (Beta) | kie 0.1125 | 7 | none |
| Grok Imagine 1.5 720p / 1080p | 0.70 / 1.25 | 0.1125 (preview, 720p) | xAI 0.70 / 1.25 | | kie 0.1125 (preview; verify) | 7 | none |
| Pika 2.5 720p / 1080p | 0.20 / 0.45 (2.2) | n/a | Pika 0.20 / 0.30 | | Pika 0.20 | 12 | none |
| Vidu Q3 Turbo 720p / 1080p | 0.30 / 0.70 (Q2) | n/a | Vidu 0.275 / 0.325 | | Vidu 0.275 | 16 | none |
| PixVerse V6 720p na / a | n/a | 0.18 / 0.24 | n/a | | kie 0.18 | 11 | none |
| LTX-2.3 1080p, 6s min | 0.36 | n/a | n/a | Runware LTX-2.5 Fast 0.45 (720p) | fal 0.36 | 21 | none |
| Hunyuan 1.5 480p | 0.375 | n/a | n/a | WaveSpeed from 0.10 | fal 0.375 | 21 | none |
| Topaz video upscale, 5s to 1080p | 0.10 | 0.20 (2x) | credits only | Evolink 0.275 | fal 0.10 | 6 | none (image row is separate) |
| Lip sync, 5s | Kling 0.07, LatentSync 0.20 | InfiniteTalk 0.075 (480p) / 0.30, Volcengine 0.20, Kling avatar 0.20 | Hedra 0.25 | | fal Kling lipsync 0.07 | 4 | LatentSync 0.20, 13 cr |
| Talking avatar from photo, 5s 720p | Kling v2 std 0.281 / pro 0.575 | Kling avatar 0.20 | Kling 0.28; HeyGen Avatar III $0.60 to $0.99 per minute (0.05 to 0.08 per 5s) | | kie 0.20 (photo avatar); HeyGen 0.08 (different product) | 12 | fal pro 0.562, 35 cr |

Rows that are cheap only through grey channels and should not be picked: Runway Gen-4 Turbo on
kie at 76% under Runway's own API price, Grok Imagine 1.5 "preview" on kie at one sixth of xAI's
rate, Veo on PiAPI and Evolink Beta, Atlas Cloud's 68% off Seedance. kie's Veo 3.1 at $1.25 per
8s is also 61% under Google's list, but ADR-0020 already adopted it and it has run in production
since 2026-09-24, so it is treated as our verified cost.

## Audio: cheapest verified source per model

| Model and unit | fal | kie | Direct | Other exact | Cheapest verified | Floor credits | Us today |
|---|---:|---:|---:|---|---|---:|---|
| ElevenLabs TTS Turbo / Flash 2.5, per 1k chars | 0.05 | 0.03 | 0.05 overage | WaveSpeed 0.05, MuAPI 0.05 | kie 0.03 | 2 | fal 0.05, 4 cr |
| ElevenLabs Multilingual v2, per 1k chars | 0.10 | 0.06 | 0.10 | WaveSpeed 0.10, Atlas 0.10 | kie 0.06 | 4 | none |
| ElevenLabs v3 / dialogue, per 1k chars | 0.10 | 0.07 | 0.10 | | kie 0.07 | 4 | fal 0.10, 7 cr |
| MiniMax Speech 2.6 HD, per 1k chars | 0.10 | n/a | 0.10 | WaveSpeed 0.10 | 0.10 everywhere | 6 | fal 0.10, 7 cr |
| MiniMax Speech 2.6 Turbo, per 1k chars | 0.06 | n/a | 0.06 | WaveSpeed 0.06 (speech-02 turbo 0.03) | WaveSpeed speech-02 turbo 0.03 | 2 | none |
| Budget TTS, per 1k chars | Inworld 0.01, Kokoro 0.02 | n/a | Vidu 0.01, Alibaba Qwen3 0.0115, OpenAI mini 0.012 | Novita 0.015 | fal Inworld 0.01 | 1 | fal Inworld recorded 0.02, 2 cr (list is 0.01, verify) |
| Sound effect, 10s | ElevenLabs 0.002/s = 0.02; MMAudio 0.001/s | n/a | ElevenLabs 0.12/min = 0.02 | Pika 0.0002/s = 0.002 | Pika 0.002; ElevenLabs 0.02 | 1 / 2 | fal ElevenLabs 0.02, 2 cr |
| Video to audio, 8s | MMAudio 0.008, ThinkSound 0.008 | n/a | n/a | WaveSpeed Kling v2a 0.035 per video | fal MMAudio 0.008 | 1 | fal MMAudio 0.008, 1 cr |
| Music, 3 min track | ACE-Step 0.036, Cassette 0.06, Lyria 2 0.60, ElevenLabs 1.80 (0.60/min), Stable Audio 0.20 per clip, MiniMax 0.035 | Suno 0.06 per request, 2 tracks (grey) | Google Lyria 3 0.04 per song, Lyria 3 Pro 0.08; ElevenLabs 0.45 (0.15/min); MiniMax 0.15 (closed to new accounts) | MuAPI Suno 0.09, 302.ai 0.10, Evolink 0.11, Atlas 0.13 (all grey) | ACE-Step 0.036; Lyria 3 0.04 per song | 3 | fal ACE-Step 1.5 0.036, 3 cr |
| Speech to text, per minute | fal 0.048, ElevenLabs 0.03 | n/a | OpenAI 0.006, ElevenLabs Scribe 0.0037 | Together Whisper 0.0015 | Together 0.0015 | 1 per 10 min | none |
| Voice clone, per voice | n/a | n/a | MiniMax 1.50 | Novita 1.50 | MiniMax 1.50 | n/a | none |

ElevenLabs Music is four times cheaper direct ($0.15 per minute) than on fal ($0.60 per minute).
ElevenLabs TTS is 40% cheaper on kie than direct or fal. Suno is grey everywhere because there
is no official API; kie's $0.06 for two tracks is the lowest grey price.

## BytePlus: savings plans, token packages and monthly packages

Superseded in detail by `byteplus-cost-levers-2026-09-26.md` (full-site crawl the same day). Two
corrections from that crawl: Seedance 2.0, 2.0 Fast and 2.0 Mini also have prepaid resource
packs at about 40% under list ($4.30, $3.30 and $2.10 per 1M tokens, $30 to $42 minimum,
three months), which makes BytePlus the cheapest verified source for every Seedance 2.x model
(2.0 Fast 720p $0.35, Mini $0.23, 2.0 $0.47, 2.5 $0.69 per 5s). And BytePlus's video terms
restrict "AI content creation tools" to end users generating for their own use, with four
mandatory controls; see the resale section there before building the adapter.

Read from docs.byteplus.com/en/docs/byteplus-platform/AI_Savings_Plans,
ai.byteplus.com/en/activity/seedance2-5 and byteplus.com/en/activity/ai-savingsplans.

**AI Savings Plans (committed spend).** Six or twelve month term, monthly commitment, discount
applied to pay-as-you-go usage up to the commitment, excess at list. Unused credit rolls over
up to 20% of the monthly amount. Tier 1, $10 to $7,000 per month, gets 0% off. Discounts start
at Tier 2:

| Monthly commitment | Category A, 6 / 12 mo | Category B, 6 / 12 mo | Category C |
|---|---|---|---|
| $7,000 to $15,000 | 16% / 18% | 30% / 32% | 0% |
| $15,000 to $45,000 | 18% / 20% | 33% / 35% | 0% |
| $45,000 to $90,000 | 20% / 22% | 37% / 39% | 0% |
| $90,000 to $150,000 | 23% / 25% | 42% / 44% | 0% |
| $150,000 to $450,000 | 26% / 28% | 48% / 50% | 0% |

Video models by category: Category B (the big discounts) holds Seedance 1.5 Pro with audio,
Seedance 1.0 Pro, Seedance 1.0 Pro Fast, OmniHuman, Seedream, BigTTS, ASR, voice cloning.
Category C (0% off) holds Seedance 2.5, Seedance 2.0 and Seedance 1.5 Pro without audio.
Seedance 2.0 Fast and Mini sit in an "independent discount structure" that is sales-only.
"No upfront" needs a sales whitelist; "all upfront" is only offered below $7,000 with no discount.
Resale of discounted capacity is prohibited in the terms. Not relevant to us at current spend,
and the models we would want (2.0, 2.5) get nothing from it anyway.

**Seedance 2.5 token packages (any account, small ticket).** $32 for 5M tokens, $64 for 10M,
$640 for 100M, valid three months, non-refundable, falls back to PAYG when exhausted. That is
$6.40 per million tokens against a list of $10.70 (480p/720p, no video input) and $11.70 (1080p),
so 40% to 45% off, or "up to 1:1.8" as the page puts it. Video-input jobs are already $6.40 list,
so they get nothing. Effective Seedance 2.5 5s cost with a package: 480p $0.31, 720p $0.69,
1080p $1.55. That makes BytePlus the cheapest verified Seedance 2.5 source by a wide margin
(kie $1.575, Segmind $1.19, fal $2.37 at 720p).

**Savings Plan monthly packages (retail).** $145, $720, $1,500 and $4,300 per month packages
that offset PAYG bills with built-in discounts of 3% to 6% on Category A and 8% to 11% on
Category B, valid one month, Seedance 2.0 excluded. First-purchase packages at $6.99, $24.99
and $49.99 give 29% to 31% off once. Too small to change a catalog decision, but the $145 tier
is a free 8% on Seedance 1.0 and 1.5 Pro with audio if we run ByteDance direct.

## What this means for our catalog

Current rows where a cheaper verified source exists:

| Our row | Cost today | Cheapest verified | Saving | Credits today, at floor |
|---|---:|---|---:|---|
| kling-3.0-i2v (fal pro 1080p na) | 0.56 | kie Kling 3.0 1080p na 0.45 | 20% | 34 to 26 |
| kling-avatar-v2 (fal pro) | 0.562 | kie Kling avatar 720p 0.20; fal v2 standard 0.281 | 50% to 64% | 35 to 12 or 16 |
| latentsync | 0.20 | fal Kling lipsync 0.07 | 65% | 13 to 4 |
| elevenlabs-tts-turbo (fal) | 0.05 | kie 0.03 | 40% | 4 to 2 |
| elevenlabs-dialogue v3 (fal) | 0.10 | kie 0.07 | 30% | 7 to 4 |
| minimax-speech-2.6-hd | 0.10 | 0.10, no cheaper source | 0% | 7 to 6 at the floor |
| inworld-tts | 0.02 recorded | fal list is 0.01 | 50% | 2 to 1, verify the recorded cost |
| wan-2.5-kie | 0.30 | 0.30, already cheapest | 0% | 19 to 17 at the floor |
| veo-3.1-fast-kie | 0.30 | 0.30, already cheapest | 0% | 19 to 17 |
| veo-3.1-kie | 1.25 | 1.25, already cheapest | 0% | 76 to 70 |
| seedance-2.0-fast (OpenRouter) | 0.454 | BytePlus resource pack 0.35 | 23% | 28 to 20 |

kie is already our cheapest verified source on Veo, Wan, Hailuo and Kling 2.6. The remaining
savings on existing rows are one Kling 3.0 route change, the avatar and lip-sync rows, and the
ElevenLabs TTS rows.

New rows that clear the 50% floor at a low credit count, in order of price:

| Candidate | Source | Cost | Floor credits | Price at $0.043 |
|---|---|---:|---:|---:|
| Seedance 1.5 Pro 720p, no audio | kie | 0.0875 | 5 | $0.215 |
| Seedance 1.0 Pro Fast 720p | BytePlus | 0.10 | 6 | $0.258 |
| Grok Imagine video 720p, audio | kie | 0.1125 | 7 | $0.301 |
| Kling 2.1 Standard 720p | kie | 0.125 | 7 | $0.301 |
| Hailuo 2.3 Standard 768p, 6s | kie | 0.15 | 9 | $0.387 |
| Seedance 1.5 Pro 720p, with audio | kie | 0.175 | 10 | $0.430 |
| PixVerse V6 720p | kie | 0.18 | 11 | $0.473 |
| Hailuo 2.3 Fast 768p, 6s | MiniMax or Novita | 0.19 | 11 | $0.473 |
| MiniMax H3 768p, audio | kie | 0.20 | 12 | $0.516 |
| Seedance 2.0 Mini 720p | kie | 0.205 | 12 | $0.516 |
| Pika 2.5 720p | Pika API | 0.20 | 12 | $0.516 |
| Kling 2.5 Turbo Pro | kie | 0.21 | 12 | $0.516 |
| Wan 2.6 Flash i2v 720p | fal or Alibaba | 0.25 | 14 | $0.602 |
| Luma Ray 3.2 720p | Luma API | 0.30 | 17 | $0.731 |
| Kling 3.0 720p, no audio | kie | 0.35 | 20 | $0.860 |
| Seedance 2.0 Fast 720p | BytePlus resource pack | 0.35 | 20 | $0.860 |
| Seedance 2.0 720p | BytePlus resource pack | 0.47 | 27 | $1.161 |
| Seedance 2.5 720p | BytePlus resource pack | 0.69 | 39 | $1.677 |

Against syntx's VIP rate ($0.027 per token, from the competitor analysis) the first four rows
land at 1.1 to 1.9 times their price, with our full 50% margin intact. That is the closest we
can get to them without either grey sourcing or giving up the margin policy.

## Adapter implications

- **kie** is already integrated and is the cheapest verified source for 17 of the video rows
  and the ElevenLabs TTS rows. Most of the new candidates above need no new adapter.
- **BytePlus ModelArk** is worth an adapter: with resource packs it is the cheapest verified source
  for every Seedance 2.x model and for Seedance 1.0 Pro Fast. Packs start at $30. The savings
  plans are irrelevant below $7,000 per month. Its video terms impose four end-user controls on
  apps like ours; see `byteplus-cost-levers-2026-09-26.md` before building.
- **Kling direct** stays a no. Same list price as fal, prepaid, expiring, and kie is under it.
- **Direct ElevenLabs** is only worth it for Music ($0.15 versus fal's $0.60 per minute).
- **Luma, Pika, Vidu** are cheapest direct and absent from kie and fal at those prices. Each is
  a small adapter; only build one if the model earns a catalog slot.
