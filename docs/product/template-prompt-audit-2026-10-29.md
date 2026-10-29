# Template prompt and source-capability audit — 29 October 2026

This is the completion ledger for every public Veyrnox video template and the
additional source libraries named by the owner: Higgsfield, Syntx, CapCut,
Buzzy.now and LipSync.video. Exact means byte-for-byte source text tied to the
same source media record. A title match, a rewritten description or a prompt
inferred from the preview is not exact.

## Public Veyrnox template result

The live gallery contains 230 unique media-backed templates. All 230 generation
prompts are `veyrnox-adaptation`; an exact source prompt is separate read-only
provenance and is never silently substituted into generation.

| Source population | Templates | Exact source text | Gap |
|---|---:|---:|---:|
| Higgsfield Genjutsu | 56 | 56 | 43 promptless records and 1 truncated record removed |
| Other Higgsfield previews | 90 | 0 | no prompt capture tied to those media IDs |
| Syntx Trends | 57 | 57 | `keyboard-duo-swap` removed because its prompt is unavailable |
| CapCut | 6 | 0 | source pages/previews recorded; no exact prompt capture |
| Mixkit/Pexels birthday footage | 12 | 0 | stock footage, not a prompt-bearing source recipe |
| Veyrnox-generated preview | 1 | 0 source prompt | the Veyrnox generation prompt remains the runnable prompt |
| Historical source not proven | 8 | 0 | must not be attributed by title similarity |
| **Total** | **230** | **113** | **117 independent adaptations** |

The API exposes one of two statuses for every public row:

- `exact`: 113 complete captured prompts;
- `adaptation-only`: 117 previews without a matched exact prompt record.

On 29 October 2026, 45 media-backed templates were removed from the gallery,
API, search, sitemap and direct template routes: the one `exact-truncated` row
and all 44 `unavailable` rows. Their immutable source records and local media
remain retained as non-public audit evidence; they are not generation options.

Every exact prompt also has `sourcePromptRunnable: false`. This is deliberate:
the public templates use an image-to-video model and do not supply the source
video and ordered reference assets assumed by the source prompt.

## Exact-text and duplicate checks

- The 57 available Syntx prompts still match the current 378-record public API
  byte-for-byte. Two duplicate prompt pairs are source-authentic and retained:
  `who-was-that-business` / `curtain-reveal`, and
  `event-character-swap` / `rap-takeover`.
- The 57 available Genjutsu prompts match the locked capture. A later walk of
  1,500 current community-feed rows relocated 48 of the original media IDs;
  all 48 retained the same prompt/null status and exact text. The moving feed
  did not relocate the other 52, so they remain captured evidence rather than
  newly verified records.
- The 1,272 addressable Veyrnox generation recipes contain no exact or
  whitespace-normalized duplicate runnable prompts.
- All 230 public preview videos and posters remain byte-unique.

## Capability result

The staged Kling O1 reference contract accepts one 3–10 second MP4 and one or
two ordered reference pictures when `MULTI_REFERENCE_ENABLED=true`. It limits
the prompt to 2,000 characters, produces 5 or 10 seconds, and does not retain
audio. The catalog row is inactive and absent from production.

The exact prompt corpus currently contains these incompatibilities:

| Constraint | Exact prompts affected |
|---|---:|
| More than 2,000 characters | 66 |
| More than two explicit image references | 11 |
| Audio, music, voice, dialogue or lip-sync requirement | 59 |
| Source input contract not wired into the public template | 113 |

Syntx additionally has 27 matched source videos longer than ten seconds. In the
48 currently relocated Genjutsu records, 44 source videos exceed ten seconds
and 16 use more than two actual reference assets. Exact text alone therefore
cannot reproduce the preview through the staged two-picture route.

## CapCut, Buzzy.now and LipSync.video

CapCut accounts for six public gallery previews. Two retain immutable
`inspirationKey` URLs and four retain the source editor URL, but none has an
exact prompt record. They stay `adaptation-only` until a prompt can be tied to
the same source media.

Buzzy.now is now an explicit audit source. Its public home page currently shows
the Seedance 2.5 Viral Pack entries Another World, Movie Rewriting, Camera
movements, Alpine portal, 50 Assets, VFX Motion Control, Art in Motion, Retake
the Shot, UGC Ads, One-shotted VLOG and UGC VLOG. No Veyrnox public template is
currently tied to a Buzzy media identifier, and the public cards inspected did
not disclose exact prompts. No attribution or prompt is added by name alone.

LipSync.video is also explicit audit scope. Veyrnox has 21 separately tracked
creative-feature examples in `creativeFeatures.js`, each linked to its public
LipSync.video page and exact example media. They are feature references, not
members of the 230-template gallery, and do not contain captured source
prompts. They must not be counted as fixed template prompts until a prompt-bearing
source record exists.

The eight historical unattributed wall previews may belong to one of the newly
named sources, but no media-ID evidence currently proves that. They remain
unattributed rather than being guessed as Buzzy or LipSync.video.

## Work order and acceptance

1. Keep the 43 null Genjutsu records removed unless the same immutable media ID
   publishes complete text. Never reconstruct them from the video.
2. Recover the 90 older Higgsfield prompts through immutable media IDs or mark
   each permanently unavailable.
3. Keep `keyboard-duo-swap` removed unless its Syntx media ID returns a prompt.
4. Capture CapCut, Buzzy and LipSync.video prompts only from a prompt-bearing
   source record tied to the same media. Record source URL, media ID, capture
   time and SHA-256.
5. Activate Kling O1 only after the ADR-0301 staging, billing and refund proof.
   Route only contracts that fit two pictures, 2,000 characters, ten seconds
   and no retained audio.
6. For longer or richer contracts, add a qualified provider route or keep the
   exact prompt read-only. Never truncate it into a different runnable prompt.
7. A future audit passes only when all 230 API rows are `exact` or
   `adaptation-only`, exact text hashes remain stable, source-media hashes
   remain unique, and removed source-gap records stay outside public routes.
