# Wholesale aggregator pricing — video + audio (excl. fal.ai, kie.ai) — collected 2026-09-26

Method: WebFetch of each aggregator's pricing/model/billing pages, WebSearch fallback where pages were JS-rendered. Confidence: **exact** = number read from the aggregator's own page; **approximate** = from a search snippet of the aggregator's page, an aggregator blog, or a dated third-party comparison (named); **not found** = no price obtainable. Derived 5s costs are `per-second × 5` or the listed 5s clip price; where the model's minimum is 4/6/8s I say so. Prices are list prices before any promo unless noted.

Market note surfaced repeatedly in sources (eggstriker, atlascloud): OpenAI's deprecation schedule removes the Videos API / `sora-2` / `sora-2-pro` on **2026-09-24**, i.e. two days before this survey. Treat every Sora 2 row as historical — verify before catalog use.

## Payment terms by aggregator

| Aggregator | Pre/postpaid | Min top-up | Credit expiry | Official-API sourcing statement | Source |
|---|---|---|---|---|---|
| WaveSpeed | Prepaid PAYG; $1 free trial | none stated; tiers by single top-up (Silver <$1k, Gold $1k–4,999, Ultra ≥$5k) | Never expires; non-refundable | Not stated. No Suno/Midjourney listed; Sora 2 = OpenAI list ($0.10/s) | wavespeed.ai/pricing, /docs/account-levels, /docs/refund-policy |
| Replicate | Prepaid credit **or** postpaid monthly arrears | none stated | none stated | Sora 2 page: BYO OpenAI key billed by OpenAI; Veo page cites Gemini docs | replicate.com/docs/topics/billing |
| Novita | Prepaid (Stripe), auto top-up | >$10 | Not stated; $100 sandbox credits valid 90d (search) | Not stated | docs.novita.ai/guides/payment-methods |
| PiAPI | Prepaid credits; $0.50 free | $0 | Not stated; bonus 3%>$650, 5%>$2,700, 7%>$5,400, 9%>$10,800 | Two modes: PPU (pooled) and **HYA "connect your own Kling accounts" $10/seat/mo** — HYA is by definition unofficial. Suno page self-labels "(unofficial)"; Midjourney was PPU (unofficial); both + Sora 2 now discontinued | piapi.ai/docs/billings, piapi.ai/kling-api, piapi.ai/suno-v5, piapi.ai/midjourney-api, piapi.ai/sora-2 |
| AI/ML API | PAYG prepaid (plans exist) | $20 (max $20k) | PAYG: never; Production/Scale plans: end of period. 2,000,000 credits = $1 | Not stated | help.aimlapi.com/article/36…, help.aimlapi.com/article/25-plans |
| Segmind | Prepaid credits (PAYG from $10) + subs $39–$599/mo | $10 | Subscription credits expire each period; add-on packs valid 90 days (search snippet of segmind terms) | Not stated | segmind.com/pricing |
| MuAPI | Prepaid wallet (Stripe) | none stated | Never expire; non-refundable | Not stated; sells Suno at $0.09/gen (unofficial) | muapi.ai/docs/pricing, muapi.ai/docs/credits |
| Atlas Cloud | Prepaid; auto top-up; 402 when empty | none stated | **Purchased credits expire 365 days**; bonus shorter | Markets "up to 68% off official"; sells Suno Chirp (unofficial) | atlascloud.ai/docs/billing/credits |
| Evolink | Prepaid PAYG | $10 | Purchased never expire; promo credits do; failed gens not billed | "We buy capacity at volume rates"; labels **Official vs Beta channel per model** (Veo 3.1 = Beta, Grok = Beta/Preview). Sells Suno + Midjourney (unofficial) | evolink.ai/pricing |
| 302.ai | PAYG balance | not found | not found | Not stated; sells Suno V5 $0.10/gen (unofficial) | 302.ai/pricing, 302.ai/product/detail/2462 |
| Higgsfield API (open.higgsfield.ai) | Prepaid USD balance | $5 | **Funds expire 1 year**; failed requests auto-refunded | Resells Kling/Seedance/Wan/MiniMax/LTX/Grok/PixVerse; not stated | higgsfield.ai/blog/higgsfield-api, help-center "what-is-the-higgsfield-api" |
| Runware | Prepaid; $2 free (business email) | $20 (help centre) vs "no minimum spend" (docs) — conflict | Never expires | "Managed inference" from named providers | help.runware.ai, runware.ai/docs/platform/pricing |
| Together AI | Fully prepaid | $5 | No expiry currently | Not stated | docs.together.ai/docs/billing |

## Price table (video)

Cols: 5s/720p and 5s/1080p = derived cost for a 5-second clip; "a" = with audio, "na" = no audio.

| Aggregator | Model | Unit | USD | 5s 720p | 5s 1080p | Source | Conf. |
|---|---|---|---|---|---|---|---|
| WaveSpeed | Kling 2.6 Std | per 5s video | 0.21 (na) | 0.21 na / ~0.42 a | no res tier | wavespeed.ai/collections/kling | exact (audio ×2 inferred from Pro page) |
| WaveSpeed | Kling 2.6 Pro | per 5s | 0.35 na / 0.70 a; 10s ×2 | 0.35 / 0.70 | no res tier | wavespeed.ai/models/kwaivgi/kling-v2.6-pro/image-to-video | exact |
| WaveSpeed | Kling 2.5 Turbo Std / Pro | per 5s | 0.21 / 0.35 | same | — | /collections/kling | exact |
| WaveSpeed | Kling 2.1 Std / Pro / Master | per video (5s) | 0.25 / 0.45 / 1.30 (i2v) | same | — | /collections/kling | exact |
| WaveSpeed | Kling 3.0 Std | per 5s | 0.42 na / 0.63 a ($0.084/s; sound ×1.5) | 0.42 / 0.63 | no res tier | /models/kwaivgi/kling-v3.0-std/text-to-video | exact |
| WaveSpeed | Kling 3.0 Pro / 4K | per 5s | 0.56 / 2.10 (na) | 0.56 | — | /collections/kling | exact |
| WaveSpeed | Kling O1 (std / pro) | per video | 0.42 / 0.56 | same | — | /collections/kling | exact |
| WaveSpeed | Veo 3.1 | per s | 0.20 na / 0.40 a (720p=1080p); 4K 0.40/0.60 | 1.00 / 2.00 | 1.00 / 2.00 | /models/google/veo3.1/text-to-video | exact |
| WaveSpeed | Veo 3.1 Fast | per s | 0.10 na / 0.15 a (720p=1080p) | 0.50 / 0.75 | 0.50 / 0.75 | /models/google/veo3.1-fast/text-to-video | exact |
| WaveSpeed | Veo 3.1 Lite | per s | 0.05 (720p) / 0.08 (1080p), audio incl. | 0.25 | 0.40 | /models/google/veo3.1-lite/text-to-video | exact |
| WaveSpeed | Seedance 1.0 Pro | per gen (5s) | 0.15 480p / 0.30 720p / 0.60 1080p; Fast 0.06 | 0.30 | 0.60 | /collections/bytedance | exact |
| WaveSpeed | Seedance 1.5 Pro | per gen | 0.26; Fast 0.20 | 0.26 | n/s | /collections/bytedance | exact |
| WaveSpeed | Seedance 2.0 | per gen | from 0.54 (10% promo, list 0.60); blog: 720p 5s 1.20 std / 0.80 fast | ~1.20 | n/s | /collections/bytedance; blog-seedance-2-0-pricing-credits | approx |
| WaveSpeed | Seedance 2.0 Fast / Mini | per gen | from 0.50 / 0.60 | ~0.80 (fast 720p) | — | /collections/bytedance | approx |
| WaveSpeed | Seedance 2.5 | per 5s | 0.90 480p (0.81 promo) / 1.80 720p / 4.50 1080p / 9.00 4K; Turbo 720p ≈0.20/s | 1.80 | 4.50 | wavespeed.ai/seedance-2-5-api | exact |
| WaveSpeed | Hailuo 02 std / pro / fast | per gen (6s) | 0.28 (768p) / 0.49–0.50 (1080p) / 0.10 | 0.28 (6s) | 0.49 (6s) | /collections/minimax | exact |
| WaveSpeed | Hailuo 2.3 std / pro / fast / fast-pro | per gen (6s) | 0.28 / 0.49 / 0.19 / 0.33 | 0.28 (6s, 768p) | 0.49 (6s) | /collections/minimax | exact |
| WaveSpeed | Wan 2.5 | per clip | 1.50 for 10s 1080p w/ audio (=0.15/s) | n/s | ~0.75 | wavespeed blog "introducing-alibaba-wan-2-5" | approx |
| WaveSpeed | Wan 2.6 / Wan 2.7 | per run | from 0.50 | ~0.50 | n/s | /models/alibaba/wan-2.6/text-to-video; /wan-2.7/image-to-video | approx |
| WaveSpeed | Sora 2 | per s | 0.10 (720p only) | 0.50 (min 4s) | n/a | /models/openai/sora-2/text-to-video | exact |
| WaveSpeed | Sora 2 Pro | per s | 0.30 720p / 0.50 1080p | 1.50 | 2.50 | /models/openai/sora-2/image-to-video-pro | exact |
| WaveSpeed | Runway Gen4 Turbo / Gen4 Aleph | per video / per s | 0.50 / 0.18 | 0.50 | n/s | wavespeed blog posts (search) | approx; Gen-4.5 not found |
| WaveSpeed | Grok Imagine Video | per s | 0.05 | 0.25 | n/s | wavespeed blog grok-imagine comparison | approx |
| WaveSpeed | LTX-2 Pro / Fast | per s / per run | 0.06 (1080p) / from 0.04 | — | 0.30 | /models/lightricks/ltx-2-pro/image-to-video | approx |
| WaveSpeed | Hunyuan Video 1.5 | per run | from 0.10 | ~0.10 | n/s | /models/wavespeed-ai/hunyuan-video-1.5/text-to-video | approx |
| Replicate | Wan 2.1 i2v 480p / 720p | per s output | 0.09 / 0.25 | 1.25 | n/a | replicate.com/pricing | exact |
| Replicate | Veo 3.1 | per s | 0.75 (audio incl.) | 3.75 (min 4s) | 3.75 | search snippet | approx |
| Replicate | Veo 3.1 Fast | per s | 0.10 720p / 0.12 1080p / 0.30 4K | 0.50 | 0.60 | search snippet (attribution to Replicate uncertain) | approx |
| Replicate | Seedance 2.5 | per s | 0.1028 480p / 0.2312 720p | 1.16 | n/l | cellcog.ai seedance-2-5-pricing (2026-08-22) | approx |
| Replicate | Seedance 2.0 | per s | 0.1512 480p / 0.3024 720p / 0.685 1080p; Fast 720p 0.1452 (fal parity) | 1.51 (fast 0.73) | 3.43 | poyo.ai comparison (undated); genrates says 0.08/s 480p — conflict | approx |
| Replicate | Sora 2 | per s | 0.10 ($1.00/10s) | 0.50 | n/s | poyo.ai sora-2-api-pricing | approx |
| Replicate | LTX-2 | per s | 0.04 (1080p, audio) | — | 0.20 | genrates.com | approx |
| Novita | Kling 3.0 Std | per s | 0.084 na / 0.126 a | 0.42 / 0.63 | no res tier | novita.ai/pricing | exact |
| Novita | Kling 3.0 Pro | per s | 0.112 na / 0.168 a | 0.56 / 0.84 | no res tier | novita.ai/pricing | exact |
| Novita | Kling 2.5 Turbo (t2v/i2v) | per clip | 0.35 / 5s 1080p; 0.70 / 10s | — | 0.35 | blogs.novita.ai kling-v2-5-turbo | approx |
| Novita | Hailuo 2.3 std | per video | 0.28 (768p 6s) / 0.56 (768p 10s) / 0.49 (1080p 6s) | 0.28 (6s) | 0.49 (6s) | novita.ai/pricing | exact |
| Novita | Hailuo 2.3 Fast | per video | 0.19 (768p 6s) / 0.32 (768p 10s) / 0.33 (1080p 6s) | 0.19 (6s) | 0.33 (6s) | novita.ai/pricing | exact |
| Novita | Wan 2.5 | per video | 5s: 0.25 480p / 0.50 720p / 0.75 1080p; 10s ×2 | 0.50 | 0.75 | novita.ai/pricing | exact |
| Novita | Wan 2.6 | per video | 5s: 0.50 720p / 0.75 1080p; 10s ×2; 15s ×3 | 0.50 | 0.75 | novita.ai/pricing | exact |
| Novita | Seedance 1.5 Pro (online) | per s | 480p 0.012 na / 0.024 a; 720p 0.026 na / 0.052 a; flex = half | 0.13 na / 0.26 a | n/l | blogs.novita.ai seedance-v1-5-pro (June 2026) | approx |
| PiAPI | Kling 3.0 / 3.0 Omni | per s | 0.10–0.20 / 0.10–0.15 | 0.50–1.00 | — | piapi.ai/kling-api | approx (range) |
| PiAPI | Kling 2.6 Std / Pro | per 5s | 0.20 / 0.33 | 0.20 / 0.33 | — | piapi.ai/kling-2-6 | exact |
| PiAPI | Kling 2.5 / 2.1 Master / O1 | per 5s | 0.20–0.33 / 0.96 / 0.39–1.04 | — | — | piapi.ai/kling-api | approx |
| PiAPI | Veo 3.1 | per s | 0.12 na / 0.24 a (**40% below Google list**) | 0.60 / 1.20 | — | piapi.ai/veo-3-1 | exact — sourcing flag |
| PiAPI | Veo 3.1 Fast | per s | 0.06 na / 0.09 a (below Google list) | 0.30 / 0.45 | — | piapi.ai/veo-3-1 | exact — sourcing flag |
| PiAPI | Seedance 2.0 | per s | 0.10 480p / 0.20 720p / 0.50 1080p | 1.00 | 2.50 | piapi.ai/seedance-2-0 | exact |
| PiAPI | Seedance 2.0 Fast / Mini | per s | fast 0.048/0.096; mini 0.042/0.084 (480p/720p) | 0.48 / 0.42 | — | piapi.ai/seedance-2-0 | exact ("less-restriction" variants +10% — flag: face-reference bypass implies non-official channel) |
| PiAPI | Hailuo 2.3 / 2.3 Fast | per video | 0.23–0.45 / 0.16–0.26 | — | — | piapi.ai/hailuo-02 | approx (range) |
| PiAPI | Wan 2.6 / Wan 2.5 | per s | 0.08–0.12 / TBA | — | — | piapi.ai/wan/wan-2-5 | approx / not found |
| AI/ML API | Kling 3.0 Pro i2v | per s | 0.1456 (variable; 0.065 @480p) | 0.73 | — | aimlapi.com/models/klingai-video-v3-pro-image-to-video | exact |
| AI/ML API | Kling 2.6 Pro t2v | per s | 0.091 (audio incl.) | 0.455 | — | aimlapi.com/models/kling-2-6-pro-text-to-video | exact |
| AI/ML API | Kling 2.5 Turbo Pro t2v | per s | 0.091 | 0.455 | — | search snippet | approx |
| AI/ML API | Veo 3.1 Fast / Lite | per s | 0.13 / 0.104 (variable) | 0.65 / 0.52 | — | aimlapi.com/models/veo-3-1-fast-text-to-video, /veo-3-1-lite | exact |
| AI/ML API | Seedance 2.0 / 2.0 Fast | per s | 0.09243–1.014 / 0.07436–0.16003 by res | ~0.80 (fast 720p) | — | aimlapi.com/models/bytedance-seedance-2-0-fast | exact (range) |
| AI/ML API | Hailuo 2.3 | per 10s | 0.728 (=0.0728/s) | 0.44 (6s) | — | aimlapi.com/models/hailuo-2-3 | exact |
| AI/ML API | Sora 2 | per s | 0.13 | 0.65 | — | search snippet aimlapi.com/models/sora-2-text-to-video | approx |
| Segmind | Kling 2.6 Pro | per gen | 5s 0.4375 na / 0.875 a; 10s ×2 | 0.44 / 0.88 | no res tier | segmind.com/models/kling-2.6/pricing | exact |
| Segmind | Veo 3.1 | per gen | 4s 0.80/1.60; 6s 1.20/2.40; 8s 1.60/3.20 (=0.20/0.40 per s, Google list) | 1.00/2.00 equiv | same | segmind.com/models/veo-3.1/pricing | exact |
| Segmind | Seedance 2.0 | per s | ~0.07 480p / ~0.152 720p / 0.34 1080p; audio free | 0.76 | 1.70 | segmind.com/models/seedance-2.0/pricing | exact |
| Segmind | Seedance 2.5 | per s | 0.1065 480p / 0.2389 720p / 0.5876 1080p; audio free | 1.19 | 2.94 | segmind.com/models/seedance-2.5/pricing | exact |
| Segmind | Seedance 1.5 Pro | per 1M output tokens | 1.20 na / 2.40 a | not derivable | — | segmind.com/models/seedance-1.5-pro/pricing | exact (token unit) |
| Segmind | Hailuo 2.3 | per gen | 0.35 (768p 6s) / 0.70 (768p 10s) / 0.61 (1080p 6s) | 0.35 (6s) | 0.61 (6s) | segmind.com/models/hailuo-2.3/pricing | exact |
| Segmind | Sora 2 | per gen | 4s 0.572 / 8s 1.144 / 12s 1.716 (0.143/s) | 0.72 equiv | — | segmind.com/models/sora-2/pricing | exact |
| MuAPI | Kling 3.0 Std/Pro; 4K; Turbo | per gen | 0.72 / 2.00 per 5s / 0.56–0.70 | 0.72 | — | muapi.ai/pricing | exact — but muapi.ai/kling-3-pricing claims Std 0.14/5s, Pro 0.28/5s, 4K 0.56/5s: **internal conflict** |
| MuAPI | Kling 2.6 Pro / 2.5 Turbo Pro / 2.5 Turbo Std / 2.1 Master / 2.1 Pro / 2.1 Std / O1 | per gen (page mislabels "/second") | 0.90 / 0.45 / 0.28 / 1.20 / 0.40 / 0.225 / 0.72 | as listed | — | muapi.ai/providers/kling | approx (unit label wrong) |
| MuAPI | Veo 3.1 Lite / Fast / Standard | per gen | 0.30 / 0.60 / 2.50 | as listed | — | muapi.ai/pricing | exact |
| MuAPI | Seedance 1.5 Pro / Fast | per gen | 0.34 / 0.26 | 0.34 | — | muapi.ai/pricing | exact |
| MuAPI | Hailuo 02 ("Minimax-2") std / pro | per gen | 0.30 t2v, 0.15 i2v / 0.60 | 0.30 | 0.60 | muapi.ai/pricing | exact |
| MuAPI | Vidu Q1 | per gen | 0.40 | 0.40 | — | muapi.ai/pricing | exact |
| Atlas Cloud | Kling 3.0 Std / Pro | per s | 0.071 / 0.095 (~30% below official); another snippet "from 0.126" | 0.36 / 0.48 | — | atlascloud.ai/models/kling-v3 (search snippet) | approx (conflict) |
| Atlas Cloud | Veo 3.1 (Lite) | per s | from 0.05 (also "0.03" cited) | 0.25 | — | atlascloud.ai/models/veo-3.1 | approx |
| Atlas Cloud | Seedance 2.0 Mini | per s | 0.0113 480p / 0.0242 720p / 0.0435 1080p-SR (official list 0.0352/0.0756/0.1361) | 0.12 | 0.22 | atlascloud.ai/models/explore/seedance-2-lowest-price | exact |
| Atlas Cloud | Seedance 2.0 Fast | per s | 0.0270 480p / 0.0581 720p / 0.1307 1080p (list 0.0563/0.1209/0.2722) | 0.29 | 0.65 | same | exact |
| Atlas Cloud | Seedance 2.5 | per s | 0.14 480p / 0.30 720p / ~0.59 1080p | 1.50 | 2.95 | cellcog.ai (2026-08-22) | approx |
| Atlas Cloud | MiniMax H3 | per s | 0.13 | 0.65 | — | atlascloud blog minimax-h3-api-pricing | approx |
| Evolink | Kling 3.0 | per output s | 0.080 (720p na); ×1.5 sound, ×1.334 1080p, ×2.0 1080p+sound, ×5 4K | 0.40 na / 0.60 a | 0.53 na / 0.80 a | evolink.ai/pricing, evolink.ai/kling-3 | exact (multipliers via search) |
| Evolink | Kling 3.0 Turbo / O3 / O1 (edit) | per s | 0.106 / 0.080 / 0.100 (input s) | 0.53 / 0.40 | — | evolink.ai/pricing | exact |
| Evolink | Seedance 2.5 | per input+output s | 0.084 (480p, lowest tier); cellcog: 0.136/0.293/0.528 (480/720/1080p) | ~1.47 | ~2.64 | evolink.ai/pricing; cellcog | approx (conflict) |
| Evolink | Seedance 2.0 | per s | 0.093 480p / 0.199 720p / 0.497 1080p / 1.013 4K; audio free | 1.00 | 2.49 | evolink.ai/seedance-2-0 | exact |
| Evolink | Seedance 2.0 Fast | per s | 0.070 480p / 0.149 720p (25% promo to 2026-10-06) | 0.75 | n/a | evolink.ai/seedance-2-0 | exact |
| Evolink | Seedance 2.0 Mini / 1.5 Pro / 1.0 Pro Fast | per s (480p) | 0.012 / 0.013 / 0.006 | — | — | evolink.ai/pricing | exact (480p only) |
| Evolink | Veo 3.1 Pro / Fast | per video (720p 8s) | 2.383 (~0.30/s) / 0.318 (~0.04/s) — **Beta channel** | 1.49 / 0.20 equiv | — | evolink.ai/pricing | exact — sourcing flag |
| Evolink | Sora 2 | per output s | 0.085 (below OpenAI list 0.10) | 0.43 | — | evolink.ai/pricing | exact — sourcing flag |
| Evolink | Hailuo 02 / 2.3 | per video | 0.080 (512p 6s) / 0.177 (768p 6s) | 0.177 (6s) | — | evolink.ai/pricing | exact |
| Evolink | Wan 2.5 / 2.6 / 2.7 | per s | 0.038 (480p) / 0.075 (720p) / 0.087 (720p) | — / 0.375 / 0.435 | — | evolink.ai/pricing | exact |
| Evolink | Grok Imagine 1.5 / 1.0 | per s (480p) | 0.056 (Preview) / 0.020 (Beta) | — | — | evolink.ai/pricing | exact — sourcing flag |
| Evolink | MiniMax H3 | per s | 0.076 (768p) | 0.38 | — | evolink.ai/pricing | exact |
| Evolink | Topaz Video Upscale | per input s | 0.055 | 0.275 | — | evolink.ai/pricing | exact |
| 302.ai | MiniMax H3 Max / Wan 3.0 / Wan 3.0 Prime | per s (from) | 0.06 / 0.05 / 0.075 | 0.30 / 0.25 / 0.375 | — | 302.ai/pricing | exact (starting) |
| Higgsfield API | Kling 2.5 / 2.6 / 3.0 | per s | 0.042 / 0.07 / 0.112 (list); console shows Kling 3.0 0.0462 (45% off) | 0.21 / 0.35 / 0.56 | — | higgsfield.ai/blog/higgsfield-api; open.higgsfield.ai | approx (blog vs console conflict) |
| Higgsfield API | Seedance 2.5 | per s | 0.0738 (blog) vs "from 0.144, 30% off" (console) | 0.37–0.72 | — | same | approx (conflict) |
| Higgsfield API | Wan 3.0 / Wan 3.0 Prime / MiniMax H3 / LTX 2.5 Pro / LTX 2.5 Fast / PixVerse 6 | per s | 0.20 / from 0.0476 / 0.13 / 0.17 / from 0.09 / 0.115 | — | — | same | approx |
| Runware | Seedance 2.5 | per s | 0.1025 (480p) | — | — | runware.ai/pricing | exact |
| Runware | Wan 3.0 / 3.0 Prime | per s | 0.05/0.10/0.20 (480/720/1080p) / 0.068 (480p) | 0.50 | 1.00 | runware.ai/docs/platform/pricing; /pricing | exact |
| Runware | LTX-2.5 Fast / Pro | per s (720p) | 0.09 / 0.12 | 0.45 / 0.60 | — | runware.ai/pricing | exact |
| Runware | MiniMax H3 / H3 Fast / H3 Max / H3 Max Turbo | per s | 0.08 (768p) / 0.046 / 0.025 (50% off) / 0.0125 (50% off) | 0.40 | — | runware.ai/pricing | exact |
| Runware | Veo 3.1 Lite / Kling 3.0 | per s | 0.05 (1080p) / 0.112 (na) | 0.56 | 0.25 | search snippet | approx |
| Runware | Veo 3.1 / Veo 3.1 Fast / Kling 3.0 Pro / Seedance 2.0 Fast / Runway Gen-4.5 / Hailuo 2.3 / Wan 2.7 / LTX-2.5 Pro | per clip (unit ambiguous) | 1.60 / 0.60 / 0.672 / 0.485 / 0.605 / 0.49 / 0.708 / 0.72 | — | — | runware.ai/collections/best-video-models | approx |
| Runware | Vidu Q2 Turbo / LTX-2 / Seedance 1.0 Pro Fast / Hailuo 2.3 Fast / Kling 2.1 Master / Seedance 1.0 Lite / Hailuo 02 / Vidu Q1 | per 5s clip | 0.11 (720p) / 0.15 (1080p) / 0.16 (1080p) / 0.32 / 0.92 / 0.14 / 0.43 / 0.275 | as listed | — | runware.ai/video-generation-api; blog (2025-07) | approx |
| Together AI | Seedance 2.5 / 2.0 | "per video" (label) | 0.115 / 0.16 | — | — | together.ai/pricing; together.ai/models/seedance-2-5 | exact label but **implausible as per-video** (matches official per-second) — flag |
| Together AI | Kling 2.1 Std / Pro / Master; Kling 1.6 Std | per video | 0.18 / 0.32 / 0.92 / 0.19 | as listed | — | together.ai/pricing | exact |
| Together AI | Seedance 1.0 Lite / Pro; Hailuo 02; MiniMax 01 Director; Sora 2; Vidu Q1; Veo 2.0; PixVerse v5 | per video | 0.14 / 0.57 / 0.49 / 0.28 / 0.80 / 0.22 / 2.50 / 0.30 | as listed | — | together.ai/pricing | exact |

## Price table (audio)

| Aggregator | Model | Unit | USD | Source | Conf. |
|---|---|---|---|---|---|
| WaveSpeed | ElevenLabs v3 / Multilingual v2 | per 1k chars | 0.10 | wavespeed.ai/collections/text-to-speech | exact |
| WaveSpeed | ElevenLabs Turbo v2 / v2.5 / Flash v2.5 | per 1k chars | 0.05 | same | exact |
| WaveSpeed | ElevenLabs Music | per s | 0.01 ($0.60/min) | wavespeed.ai/models/elevenlabs/music | exact |
| WaveSpeed | MiniMax Speech 2.8 HD / 2.6 Turbo / 02 HD / 02 Turbo / 2.5 Turbo | per 1k chars | 0.10 / 0.06 / 0.05 / 0.03 / 0.04 | /models/minimax/speech-2.8-hd; /collections/text-to-speech | exact |
| WaveSpeed | ACE-Step (prompt-to-audio) | per s audio | 0.0002 | /models/wavespeed-ai/ace-step/prompt-to-audio | exact |
| WaveSpeed | MMAudio v2 | per s | 0.001 | /models/wavespeed-ai/mmaudio-v2 | exact |
| WaveSpeed | Stable Audio 3 | per gen | 0.0206 | /docs/docs-api/stability-ai/stability-ai-stable-audio-3-text-to-audio | approx |
| WaveSpeed | Kling video-to-audio / text-to-audio | per video | 0.035 | /collections/kling | exact |
| Replicate | MiniMax speech-02-hd / speech-2.8-hd | per 1k chars | 0.05 / 0.10 | blog snippets | approx |
| Replicate | ElevenLabs TTS (multilingual / flash-turbo) | per 1k chars | 0.10 / 0.05 | search snippet | approx |
| Replicate | OpenAI Whisper | per run | ~0.0013 (769 runs/$1) | replicate.com/openai/whisper (snippet) | approx |
| Novita | TTS (generic) / Fish Audio TTS | per 1M chars | 15 (=0.015/1k) | novita.ai/pricing | exact |
| Novita | MiniMax voice clone | per voice | 1.50 | novita.ai/pricing | exact |
| MuAPI | Suno create / extend | per gen | 0.09 — **unofficial** | muapi.ai/pricing | exact |
| MuAPI | ElevenLabs TTS Turbo 2.5 | per 1k chars | 0.05 | muapi.ai/comparison/elevenlabs-tts-turbo-2-5 | exact |
| Atlas Cloud | ElevenLabs v3 TTS | per 1k chars | 0.10 | atlascloud.ai/models/elevenlabs/v3/text-to-speech | exact |
| Atlas Cloud | Suno Chirp V6 | per gen | from 0.132 — **unofficial** | atlascloud.ai/models/suno-chirp | approx |
| Evolink | Suno (v4–v5 "-beta") | per song | 0.111 (8 credits); catalog: 0.118 per 2 tracks — **unofficial** | evolink.ai/blog/suno-api-pricing; evolink.ai/models | exact |
| Evolink | Doubao Seed Audio 1.0 | per s | 0.003 | evolink.ai/models | exact |
| 302.ai | Suno V5 | per gen | 0.10 — **unofficial** | 302.ai/product/detail/2462 (snippet) | approx |
| AI/ML API | MiniMax Speech 2.8 HD / Turbo | listed "per 1M tokens" 130 / 78 (likely = $0.13 / $0.078 per 1k chars) | aimlapi.com/models | approx |
| Together AI | Whisper Large v3 / (streaming) | per audio min | 0.0015 / 0.0035 | together.ai/pricing | exact |

## Unofficial-sourcing flags

- **Suno**: no official Suno API exists (confirmed by multiple sources). Every seller is unofficial: MuAPI $0.09, 302.ai $0.10, Evolink $0.111 (models literally suffixed `-beta`), Atlas Cloud $0.132. PiAPI self-labelled "Suno V5 API (unofficial)" and has discontinued it; RapidAPI historical $0.02.
- **Midjourney**: no official API. PiAPI discontinued PPU access (was unofficial); Evolink sells Midjourney V7/V8.1 per-request from $0.0375/$0.075 — unofficial.
- **PiAPI Veo 3.1** at $0.12/$0.24 per s (Fast $0.06/$0.09) is 40% under Google's list ($0.20/$0.40; Fast $0.10/$0.15) — sourcing unclear; PiAPI also runs HYA "connect your own Kling accounts" mode, and "less-restriction" Seedance variants with face reference.
- **Evolink** explicitly marks Veo 3.1 (Pro + Fast) and Grok Imagine as "Beta"/"Preview" channel vs "Official" for Kling/Seedance/Wan/Sora/Hailuo; Evolink Sora 2 $0.085/s is under OpenAI list.
- **Atlas Cloud** markets "up to 68% off official pricing" on Seedance 2.0 and ~30% off Kling 3.0 — consistent with volume/reseller sourcing, not necessarily unofficial, but below list.
- **Higgsfield** console shows 30–45% discounts vs its own list.
- Sora 2: PiAPI discontinued; Atlas Cloud notes OpenAI removing the API 2026-09-24.

## Could not be priced, and why

- **Replicate**: Kling 2.6/3.0/O1, Hailuo 02/2.3, Seedance 1.x, Wan 2.5, Sora 2 Pro, Luma Ray, Runway Gen-4, Topaz, MiniMax speech, ElevenLabs v3, Whisper, Stable Audio 2.5, MMAudio, ACE-Step — the "This model costs…" block is JS-rendered; neither the model page nor `/llms.txt` exposes it, and the public `/pricing` page only rendered Wan 2.1. Only third-party trackers gave numbers (marked approximate).
- **Novita**: Seedance 2.x, Veo, Sora, Kling 2.6/2.1 not on the rendered `/pricing` table; `/models/video` and docs API-reference URLs 404/redirect. Regular credit expiry not stated.
- **PiAPI**: Sora 2, Suno, Midjourney discontinued; Wan 2.5 "TBA"; Hailuo/Kling 3.0 only as ranges; 10s and audio breakdowns not shown; Luma not fetched.
- **AI/ML API**: `/models` list shows nonsensical "per 1M tokens" figures for video/TTS; Sora 2 Pro, Wan 2.6/2.7, ElevenLabs, Kling 2.1 pages not fetched; Seedance 2.0 Mini shows "$4.55/gen" (suspect).
- **Segmind**: Kling 2.6 Std, Kling 3.0, Wan 2.5, Seedance 2.0 Mini pricing pages 404; Seedance 1.5 Pro priced per token (not derivable); catalog page hides prices.
- **MuAPI**: pricing page paginated client-side (14 pages); Sora, Wan, Runway, Luma, Grok, LTX, Hunyuan, Topaz, Whisper, Stable Audio not reachable; `/api/v1/models` returns ids without prices; Kling 3.0 numbers conflict between two of its own pages.
- **Atlas Cloud**: model pages (Kling, Veo, Seedance 2.5, Hailuo, Wan, Sora) truncated at fetch; `/pricing/models/list` is an empty user-built list; Suno/Veo only via search snippets.
- **Evolink**: no ElevenLabs, MiniMax speech, Whisper, Runway, Luma, Pika, Vidu, LTX, Hunyuan, Kling 2.x in catalog; Seedance 2.5 per-resolution unclear (lowest tier only).
- **302.ai**: Chinese JS pricing page; only three video "starting" prices plus Suno; Kling/Veo/Seedance/ElevenLabs/Whisper and billing terms not extractable (product-detail page exceeded fetch size).
- **Higgsfield**: `open.higgsfield.ai/pricing` table renders empty; blog vs console figures conflict (Seedance 2.5 $0.0738 vs $0.144/s; Seedance 2.0 "$0.9332/s" implausible).
- **Runware**: "381 priced models" but page shows a sample; Kling 2.6/2.5, Veo 3.1 standard per-second, Sora, Pika, Luma, Hunyuan, Topaz, audio models absent; collection prices' unit ambiguous.
- **Together AI**: no TTS/music/SFX; "per video" label for Seedance 2.x almost certainly per second.
- **WaveSpeed**: Vidu Q3, Luma Ray, Topaz, Whisper, ElevenLabs SFX, Runway Gen-4.5, Kling 2.1 t2v std/pro not surfaced; Wan 2.5–2.7 only as "from $0.50/run"; Seedance 2.0 per-resolution table lives in the playground, not the page.
- **Everywhere**: Pika (only direct-provider $0.05/s via buildmvpfast), Luma Ray 2/3, Runway Gen-4.5, Hunyuan (beyond WaveSpeed), MiniMax 3.0 (only "H3" family), Kling 2.6/3.0 resolution tiers (most aggregators price per second without a 720p/1080p split — so 720p and 1080p 5s costs are identical unless a tier is shown).
