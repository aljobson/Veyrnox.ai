# Free AI content: zero-fee ingest shortlist

Research date: 13 October 2026

## Admission rule

This shortlist includes only content that could cost Social Cinema £0 in licence fees. Hosting and bandwidth still have operational costs.

An item may enter ingest review only when Social Cinema has one of these:

1. An explicit CC0, CC BY, or approved CC BY-SA grant from the rights holder covering the complete audiovisual work.
2. A signed creator agreement granting Social Cinema the required hosting and streaming rights for £0.

Do not rely only on `PD-algorithm`, “copyright-free,” “free to watch,” a standard platform licence, or availability on a public website. The UK protects qualifying computer-generated works for 50 years, according to [UK government guidance](https://www.gov.uk/government/publications/report-and-impact-assessment-on-copyright-and-artificial-intelligence/report-on-copyright-and-artificial-intelligence).

## Green: first ingest-review candidates

These have an affirmative open licence, but still require content and component-rights review before publication.

| Candidate | Length / scale | Licence evidence | Proposed use | Required check |
| --- | --- | --- | --- | --- |
| [Late Afternoon Swans (CogVideoX)](https://commons.wikimedia.org/wiki/File:Late_Afternoon_Swans_(CogVideoX).webm) | 6.125 seconds, 720×480 | VulcanSphere applied CC0 1.0 | Published AI visual study | Published; preserve source revision `1147586006` and SHA-256 |
| [Painting With The Breeze (CogVideoX)](https://commons.wikimedia.org/wiki/File:Painting_With_The_Breeze_(CogVideoX).webm) | 6.125 seconds, 720×480 | VulcanSphere applied CC0 1.0 | Published AI visual study | Published; preserve source revision `1089212685` and SHA-256 |
| [Grey Haired Man in a Cosy Cafe (Veo 3)](https://commons.wikimedia.org/wiki/File:Grey_Haired_Man_in_a_Cosy_Cafe_(Veo_3).webm) | 7.999 seconds, 1280×720 | VulcanSphere applied CC0 1.0 | Published AI visual study | Published from silent derivative; preserve original and stream hashes and the Veo watermark |
| [Visual Kei Man Enjoys Lemonade (Veo 3)](https://commons.wikimedia.org/wiki/File:Visual_Kei_Man_Enjoys_Lemonade_(Veo_3).webm) | 7.999 seconds, 1280×720 | VulcanSphere applied CC0 1.0 | Published AI visual study | Published from silent derivative; preserve original and stream hashes and the Veo watermark |
| [GenState-AI](https://huggingface.co/datasets/Mh-Li/genstate-ai/blob/main/README.md) | 956 generated clips | Dataset card states CC BY 4.0 | Curated AI experiment reels | Confirm the licence covers each media file, retain attribution, moderate every selected clip |
| [DeepAction v1](https://huggingface.co/datasets/faridlab/deepaction_v1/blob/97ada4a1e5c7602c4a577f5602ebe25384fd6678/README.md) | 3,000+ mixed-source videos | AI-generated subset states CC BY 4.0 | Model comparison and motion reels | Import only AI-generated folders; exclude the Pexels-derived real-video subset |
| [Human Preferences for AI-Generated Video](https://huggingface.co/datasets/nusdufv/text-2-video-human-preferences-motion/blob/main/README.md) | 29,283 comparison labels across four video models | Dataset card states CC BY 4.0 and commercial use with attribution | Motion-quality showcase after confirming media access | Verify the licence covers underlying video files, not only annotations and metadata |
| [TA2.0 Animation Dataset](https://huggingface.co/datasets/neosapience/TA2.0_animation_dataset) | 11,255 avatar clips, about 30.3 hours | Dataset is Apache 2.0; speech sources use permissive CC licences | Multilingual avatar experiments | Generate per-clip audio attribution and verify character-image rights |

The green label means “worth auditing first,” not “publish automatically.” Dataset repository licences can apply differently to code, metadata, and underlying media. Preserve a dated licence snapshot and validate the actual files selected.

Cyberpunk Rainy Street and AI generated video clip – New creative video moved to blocked status after file-level inspection exposed generation-tier uncertainty through their visible Hailuo and D-ID watermarks.

## Amber: free after one confirmation

| Candidate | Current evidence | Missing evidence | Free path |
| --- | --- | --- | --- |
| [EXECUTE](https://commons.wikimedia.org/wiki/File:EXECUTE_--_dark_Sci-Fi_AI-short_film.webm) | 10:03 science-fiction short marked CC BY 3.0; filmmaker credited for writing, direction, and music | Wikimedia flags the imported YouTube licence as unreviewed; synthetic voices also need confirmation | Ask Vincent Chang Deng to confirm the licence and component rights in writing, with no fee, then ingest the Commons master or a supplied master |
| [First Canvas](https://vimeo.com/1115361822) | Ten-minute AI-assisted short whose Vimeo page states CC BY 3.0 | Third-party music rights and master delivery need confirmation | Obtain a £0 creator confirmation covering the film, music, streaming, promotion, and technical adaptations |
| [History of Earth: The Origin of Life](https://commons.wikimedia.org/wiki/File:History_of_Earth_E2_-_The_Origin_of_Life_-_The_First_Microbes_4k_-_see_how_life_on_Earth_was_born.webm) | 8:26 educational video marked CC BY 3.0 | Licence review is pending and Commons flags it for expert fact-checking | Obtain creator confirmation and factual review before considering it |
| Festival filmmakers | Creator owns the film | Festival permission does not transfer to Social Cinema | Offer the zero-fee Founding AI Filmmakers agreement and ingest only after signature and master delivery |

## Red: exclude from the free-streaming catalog

- Wikimedia files labelled only `PD-algorithm`, without an affirmative CC0 or Creative Commons grant from the person who arranged the creation.
- Works with unresolved Wikimedia deletion requests or licence-review warnings unless the creator independently confirms all rights.
- YouTube or Vimeo videos under their standard platform licence.
- Pixabay, Pexels, or other stock footage offered under terms that prohibit standalone redistribution.
- Creative Commons NonCommercial works, because an ad-supported, sponsored, or subscription service is commercial.
- Creative Commons NoDerivatives works, because encoding, captioning, dubbing, trailers, thumbnails, and edits can create adaptation issues.
- Festival screeners, award pages, and market catalogs without a direct creator grant.
- AI works using recognisable celebrities, cloned voices, trademarks, copyrighted characters, or uncleared music.

## Free catalog target

Build the first release from:

- 10–20 audited open clips assembled into curated reels.
- 5–10 directly licensed narrative shorts from creators who accept the £0 agreement.
- 2–4 themed programming blocks, such as science fiction, animation, surreal visuals, and multilingual avatars.

The creator agreement should grant hosting, on-demand streaming, scheduled streaming, public performance, promotion, transcoding, captions, thumbnails, and short trailers. It should be non-exclusive, worldwide where possible, last 12 months, and provide a simple takedown process. Creators keep ownership and can receive audience analytics, featured placement, and an optional revenue share without any guaranteed payment.

## Immediate sequence

1. Continue asset-level review of the four dataset candidates and record licence snapshots, hashes, attribution, and excluded components.
2. Send the zero-fee confirmation request to the creators of *EXECUTE* and *First Canvas*.
3. Recruit five festival filmmakers under the same £0 creator agreement.
4. Publish nothing until each selected asset has a complete rights record and component review.
