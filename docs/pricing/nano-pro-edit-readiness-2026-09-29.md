# Nano Banana Pro editing supplier assessment — 29 September 2026

Flux KIE 1K is now active in production after PR #391 and the approved migration
run 36561264447. Nano Banana Pro editing is the next supplier qualification
candidate; no edit-provider change is authorized by this assessment alone.

| Route | Price evidence | Current limitation |
| --- | --- | --- |
| Existing fal Pro Edit, one 2K reference-image edit | Repository catalogue baseline $0.15/image | Exposes seed; retain while qualifying alternatives |
| KIE Nano Banana Pro, 1K/2K | Public rate card re-read today: 18 credits, $0.09/image | Editing documented, but not implemented or live verified in Veyrnox; no seed in inspected request schema |
| GrsAI Nano Banana Pro | Existing text-to-image route recorded $0.0271/image | This is not a verified editing quote; input contract, actual editing charge and output need verification |

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

1. Establish GrsAI's current editing request contract and editing charge first,
   since the existing generation route may beat KIE. The publicly readable
   official page confirms image upload but did not expose the full parameter
   table through the reader. Existing text-to-image billing is insufficient.
2. If GrsAI cannot be qualified, KIE has a documented edit contract and a funded
   local credential. Implement a separately labelled no-seed 2K edit route,
   initially inactive; confirm the actual charged cost with one synthetic
   source image before proposing a price or activation.
3. Verify source ownership, unsupported controls, debit/refund/replay, provider
   output and storage/download before a separate activation migration.

No supplier messages, new credential creation, paid edit tests, credit purchases
or catalogue changes were made in this assessment. The local credential folder
contains KIE and staging R2 configurations; no local GrsAI credential file was
found there. Do not copy production Worker secrets into logs or documentation.

## Sources

- KIE API contract: https://docs.kie.ai/market/google/pro-image-to-image
- Machine-readable contract: https://docs.kie.ai/market/google/pro-image-to-image.md
- KIE public rate card: https://kie.ai/pricing (read-only pricing API,
  `https://api.kie.ai/client/v1/model-pricing/page`, pages 1–6, read 29 September)
- GrsAI official reference: https://grsai.com/dashboard/documents/nano-banana
- Repository: `lib/modelCapabilities.js`, `lib/additionalModelCapabilities.js`,
  `packages/adapters/kie.js`, `packages/adapters/grsai.js` and
  `docs/pricing/wholesale-review-2026-09-28.md`.
