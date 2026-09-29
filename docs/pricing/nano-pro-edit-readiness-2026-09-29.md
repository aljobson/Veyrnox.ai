# Nano Banana Pro editing supplier assessment — 29 September 2026

Flux KIE 1K is now active in production after PR #391 and the approved migration
run 36561264447. Nano Banana Pro editing is the next supplier qualification
candidate; no edit-provider change is authorized by this assessment alone.

| Route | Price evidence | Current limitation |
| --- | --- | --- |
| Existing fal Pro Edit, one 2K reference-image edit | Repository catalogue baseline $0.15/image | Exposes seed; retain while qualifying alternatives |
| KIE Nano Banana Pro, 1K/2K | Public rate card re-read today: 18 credits, $0.09/image | Editing documented, but not implemented or live verified in Veyrnox; no seed in inspected request schema |
| GrsAI Nano Banana Pro, one reference-image edit, 2K setting | Live playground edit: 1,800 credits = $0.027027 at the purchased $5 / 333,000-credit rate | Supplier edit verified below; Veyrnox edit route remains unimplemented |

KIE's listed saving against the recorded fal baseline is 40%, or $0.06 per
image ($60 per 1,000 images). This is a candidate saving, not a negotiated
wholesale quote or proof of equivalent features. KIE 4K costs $0.12 and must
not be exposed under the proposed 2K price.

## Confirmed contract and implementation gap

KIE's official OpenAPI describes `model: nano-banana-pro` with `image_input`,
an array of up to eight image URLs (JPEG, PNG or WebP, maximum 30 MB per
image), plus prompt, aspect ratio, resolution and output format. No seed field
is documented. Our fal edit route supports one reference image, seed and fixed
2K output. Our KIE adapter explicitly rejects `image_url` for its existing
text-to-image route; the GrsAI capability likewise has no media input.

A safe implementation therefore needs a separate edit capability and catalogue
entry, with one required owner-scoped source image and fixed 2K output. Reuse
the gateway's owned R2 source lookup and signing; do not accept arbitrary
client media URLs or silently remove seed from the fal option. Do not broaden
the active text-to-image capability as a shortcut.

## Qualification order

1. Qualify a separate GrsAI edit route in Veyrnox using the verified supplier
   contract below. Keep it inactive until gateway and storage checks pass.
2. Retain KIE as an alternative candidate; its edit pricing is documented but
   its edit output has not been live tested here.
3. Verify source ownership, unsupported controls, debit/refund/replay, provider
   output and storage/download before a separate activation migration.

## Live supplier edit verification — 29 September 2026

One authorized paid edit was submitted through the logged-in official GrsAI
playground. No credential was created or exported, and no credits were purchased.

- Model: `nano-banana-pro`; image size `2K`; aspect ratio `auto`.
- Input: one synthetic ceramic-teapot JPEG, 1344 × 768, from the earlier Flux
  staging test. No customer image was used.
- Prompt: "Change only the ceramic teapot to cobalt blue. Preserve its shape,
  the linen cloth, window lighting and composition. No text."
- Task: `16-f339662c-4b1f-498b-8aae-a7c0bf2eb186`.
- Task log: **Success**, **41s**, **-1800 credits**. Balance: 324,000 → 322,200.
- Output: PNG, **2744 × 1568**, 1914820 bytes.
  SHA-256: `3ce05e4432322c4846ba5437b022103d4d159b288f6a66aff69ed8ea82436cc2`. Visual inspection confirmed the blue teapot and
  substantially preserved composition, cloth and lighting. This is one successful
  sample, not a reliability benchmark or proof of pixel-exact preservation.
- Account order history showed a $5 purchase; consumption history showed its
  333,000-credit grant. Billing also displayed that package conversion.
- Effective cost: `1800 × 5 / 333000 = $0.027027027` per edit, approximately
  $27.03 per 1,000. Against the repository's $0.15 fal baseline this is 81.98%
  lower; against KIE's listed $0.09 it is 69.97% lower. This comparison excludes
  platform storage/egress, retries and any taxes or payment fees.

The expanded official reference documents global base `https://grsaiapi.com`,
POST `/v1/draw/nano-banana`, with `model`, `prompt`, `urls` (reference images),
`aspectRatio`, `imageSize`, `webHook` and `shutProgress`. For polling, set
`webHook: "-1"` and POST `/v1/draw/result` with the returned `id`. The reference
lists 1K/2K/4K for Pro and says output URLs expire after two hours. No seed field
was documented. Use a separate one-owned-source, fixed-2K capability; the current
active text-to-image capability must remain unchanged.

This proves the supplier playground edit and billed charge. It does **not**
verify a Veyrnox API edit submission, owned-source signing, R2 ingestion,
ledger/refund handling, callback recovery or production readiness. No application,
catalogue, migration or deployment was changed by this verification.


## Sources

- KIE API contract: https://docs.kie.ai/market/google/pro-image-to-image
- Machine-readable contract: https://docs.kie.ai/market/google/pro-image-to-image.md
- KIE public rate card: https://kie.ai/pricing (read-only pricing API,
  `https://api.kie.ai/client/v1/model-pricing/page`, pages 1–6, read 29 September)
- GrsAI official reference: https://grsai.com/dashboard/documents/nano-banana
- Repository: `lib/modelCapabilities.js`, `lib/additionalModelCapabilities.js`,
  `packages/adapters/kie.js`, `packages/adapters/grsai.js` and
  `docs/pricing/wholesale-review-2026-09-28.md`.
