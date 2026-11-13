# Video template recipes

The community registry retains 841 rows and publishes 749 complete exact
prompt/video pairs. Seventy rows are hidden: 27 without captured community text,
42 with unavailable text and one truncated record. `PRESETS` drives the gallery,
mobile presets API, search and sitemap. The homepage wall has 14 retained cards.
`ALL_TEMPLATES` has 1,791 addressable recipes, including 1,036 independent effect
concepts and six reference recipes that are unchanged and have no gallery video.

Each community prompt is joined from its source record at registration time.
`prompt` and `sourcePrompt` equal the published exact text, with both origins
set to `community-source-exact`. The only transformation is the existing
platform-word stripping. Raw captured text stays SHA-256 locked. All authored
adaptation and negative-prompt text was removed from community data modules;
only hashes remain in the removal fixture. Names, categories, guidance, steps,
models, credits, duration, previews and posters of existing rows are unchanged.

Compatibility flags are informational by owner decision: 285 public exact
prompts are compatible and 464 incompatible with the audited source contract.
400 contain explicit numbered reference slots the app cannot fill. The broader
audit counts 424 prompts with image/video requirements. The exact text is still
handed to the selected model; no missing reference is silently substituted.
No prompt exceeds the assigned model's verified 30,000-character limit.
No model, pricing, upload requirement, consent or limit logic changes here.

Template detail, Create, Film Studio, chat draft and native Create preserve
unedited source bytes, including trailing newlines. Create keeps prior trimming
for other text. Film/chat drafts and recovered chat messages cannot distinguish
edits, so those paths preserve nonempty text without trimming. Existing chat
caps reject overlong text whole. The preview remains inspiration, never a
substitute for the person's required upload. Ten-second recipes keep the same
price multiplication and generation duration.

The 300-record stage retains 299 pairs, 598 prepared assets and 100 compatible / 199
incompatible exact prompts. Its previous generated adaptations are removed.
The prepared Syntx batch publishes 63 exact prompts and 126 prepared assets.
Compatibility-first Seedance guidance routes all accepted rows to Fast;
source model/version labels remain separate from routing. Dark Couture is rejected.

Source evidence and the four baseline duplicate exceptions are documented in
[the template audit](template-prompt-audit-2026-10-29.md),
[the Syntx audit](syntx-template-prompt-audit-2026-10-29.md), and
[showcase provenance](showcase-clips.md). Raw source records are never inferred
from a title, description or video. Media for hidden templates remains historical
evidence, including the previously approved Frozen In Motion preview.

Amendment 1 adds 28 accepted same-record pairs from 30 prepared category-fill
records. ANIME, ADS and YOUR PHOTO now meet the ten-template minimum; all
twelve content categories are covered by a fixed-list regression test. KIDS
BIRTHDAY remains an explicit exclusion pending an owner decision, with twelve
hidden promptless rows and no gallery filter. Current per-category counts and
the rejected incomplete records are recorded in the generated template audit.
