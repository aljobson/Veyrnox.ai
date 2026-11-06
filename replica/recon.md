# Recon map: Kling AI template recreation (iOS)

Scope: the public template-video loop: discover a video template, inspect its prompt, choose Recreate, assign a source video plus picture references, edit the prompt and hand the recipe to generation.
For: Veyrnox.ai creators on web and mobile; adapted to Veyrnox models, credits, rights checks and Library.
Date: 2026-11-06

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Kling 4.0 public user guide | https://kling.ai/quickstart/kling-4-model-user-guide | Omni Reference, numbered assets, video recreation/editing, prompt roles, keyframes and published limits. |
| 2 | Apple App Store listing | https://apps.apple.com/us/app/kling-ai-ai-image-video-maker/id6738049229 | Public feature inventory: video, image, community, Clone & Try, extension and multi-reference inputs. |
| 3 | Kling public app shell | https://kling.ai/app/ | Public top-level IA: Explore, Assets, Omni, Generate, Canvas and All Tools. |
| 4 | Kling terms of service | https://ppg.kwai-pro.com/doodle/aDqchCbz.html | Prohibits reverse engineering, automated collection and unauthorised commercial use; therefore this recon uses public documentation only. |
| 5 | Kuaishou multi-image announcement | https://ir.kuaishou.com/news-releases/news-release-details/kuaishou-kling-ai-unveils-multi-image-reference-feature-further/ | First-party evidence for multi-image consistency and subject/reference blending. |
| 6 | fal Kling O1 reference schema | https://fal.ai/models/fal-ai/kling-video/o1/video-to-video/reference/api | Veyrnox provider contract: source video, ordered image URLs, bounded prompt and duration. |
| 7 | fal Kling O1 pricing | https://fal.ai/models/fal-ai/kling-video/o1/video-to-video/reference | Provider price evidence used by Veyrnox ADR-0301. |

## Core loop

A creator finds a motion/look worth reusing, opens its editable prompt, assigns their own video and picture references to explicit roles, then generates a personalised version.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Explore | public app home → Explore | Discover community and template work | feed, categories, preview cards, Clone/Try action | loading, filled, signed-out |
| S02 | AI templates | public app → templates/All Tools | Browse reusable concepts | video cards, category tabs, preview, prompt summary | filled, filtered |
| S03 | Template detail | open a template card | Inspect the example and recipe | video player, prompt, model/settings, Recreate | preview-ready, copy-only, unavailable model |
| S04 | Recreate recipe | Recreate on S03 | Assign the meaning of references and edit the derived prompt | source-video role, Image1 role, Image2 role, editable prompt, Copy, Studio CTA | model checking, ready, unavailable, handoff error |
| S05 | Generation Studio | Recreate in Studio | Attach inputs, confirm rights and generation settings | source video picker, ordered image picker, prompt, duration, credits, Generate | empty, partially filled, ready, uploading, error |
| S06 | Job progress | Generate on S05 | Track provider work | queued/running status, cost, cancel/retry rules | queued, running, failed/refunded, complete |
| S07 | Result | completed job | Review and continue from the output | player, download, continue/edit, Library provenance | complete, expired link, refunded failure |
| S08 | Assets/Library | app navigation | Reuse owned references and outputs | media grid, type filters, picker | empty, filled, permission denied |

## Flows

```
F01 Recreate a template video with references
    S01 -> S02 -> S03 -> S04 -> S05 -> S06 -> S07
    happy path clicks: 7, plus three file choices and rights confirmation
    edge: reference model unavailable, video outside 3–10 s, fewer than two pictures, rights not confirmed, provider failure/refund

F02 Copy and adapt a template prompt
    S03 -> S04
    happy path clicks: 2
    edge: source prompt exceeds the selected model limit; derived prompt is bounded and remains editable

F03 Start from owned Library media
    S03 -> S04 -> S05 -> S08 -> S05 -> S06
    happy path clicks: 7
    edge: expired asset, wrong media type, more references than the model permits

F04 Continue a completed recreation
    S07 -> S05 -> S06 -> S07
    happy path clicks: 3
    edge: original local file must be reattached after reload

F05 Inspect without spending
    S02 -> S03 -> S04
    happy path clicks: 2
    edge: model unavailable; prompt remains copyable but generation stays disabled
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| TemplateVideoCard | portrait, landscape, generated-on-Veyrnox | loading, playing, saved | S01, S02 |
| FilmPlayer | poster, inline video | paused, playing, error | S03, S07 |
| PromptEditor | exact source, Veyrnox adaptation, recreate recipe | editable, read-only, too long, copied | S03, S04, S05 |
| ReferenceRoleList | source video, Image1, Image2 | complete, incomplete | S04, S05 |
| OrderedMediaPicker | upload, Library | empty, converting, selected, over limit, invalid | S05, S08 |
| RecreateCTA | available, unavailable | checking, ready, opening, handoff error | S04 |
| RightsConfirmation | uploads, Library assets | unchecked, confirmed, blocked | S05 |
| CreditQuote | 5 s, 10 s | fallback, live, insufficient balance | S05 |
| JobStatus | queued, running, complete, failed | polling, stale, refunded | S06, S07 |

## Inferred data model

```
Template         id, title, category, preview_asset, base_prompt, model_id,
                 duration, source_aspect, prompt_origin, publishable
                 evidence: S02–S04, public guide, existing Veyrnox template catalog
                 confidence: high

RecreateRecipe   template_id, model_id, derived_prompt, duration,
                 reference_roles[{slot, order, purpose}]
                 evidence: Kling guide numbered assets; Veyrnox ADR-0301
                 confidence: high

Reference        kind(video|image), slot, order, origin(upload|asset),
                 asset_id/source_key, label, media_facts, consent
                 evidence: S05/S08 and existing Veyrnox generation contract
                 confidence: high

Generation       id, recipe/template provenance, prompt, references, duration,
                 credits, status, refund_reason, output_asset
                 evidence: S05–S07 and existing Veyrnox job model
                 confidence: high
```

Relationships: Template 1-n RecreateRecipe; RecreateRecipe 1-3 ordered Reference roles for this model; Generation belongs to one user and optionally one template provenance; completed Generation produces one or more Library assets.

## Feature matrix

See `features.csv`. Must: 14, should: 6, could: 4, skip: 4.

## Out of scope (cannot or should not be cloned)

- Kling-owned template videos, community media, names, marks and proprietary prompt text.
- Kling's private APIs, model weights, ranking signals, user graph and account data.
- Any automated extraction or logged-in account inspection prohibited by Kling's terms.
- Claiming output parity with Kling 4.0; Veyrnox uses its own available providers and discloses the selected model.

## Size

Screens 8, flows 5, entities 4. Hard parts: lawful preview sourcing, ordered multi-reference fidelity, and safe provider activation with debit/refund proof. Size: L.
