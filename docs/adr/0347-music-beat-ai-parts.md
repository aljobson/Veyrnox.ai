# ADR-0347 — Beat editor AI parts

Status: Implemented behind the absent `beatAi` runtime key; host SQL, browser and Worker qualification required before activation.

The editor quotes before Send and displays the SQL response's `total_credits`,
balance and balance after. A quote owns one `beat-ai.<uuid>` key. Before Send,
the request and placement snapshot must be saved on this device; retry reuses
the key. Reload/resume never submits automatically. Deterministic track, region
and asset IDs make placement replay safe. A pending receipt is retired only
after a durable local save of its placed document. Two alternates are one undo
step. Only the first playable alternate is audible. Stem outputs are both
active. Source muting happens only when playable results are placed.

`ace-step-loop` uses the existing ACE-Step 1.5 endpoint and paid-plan gate.
Migration 0549 copies every catalog column explicitly, changing only identity,
name and activation. Its price is a copied placeholder, **pending owner price
decision D6 (staging probe + fal bill)**. It remains inactive. No provider probe,
price decision, flag flip, or migration application is authorized by this work.

**Amendment 1 (2026-11-16, D6).** One STAGING probe (request
`01a1e610-b245-7621-9afc-86f6f974dcac`, one 60 s loop on `fal-ai/ace-step-1.5`) billed
more than the $0.036 that the copied price of 3 Credits assumed. The owner set the
price at 5 Credits a part, so one Generate (two Alternates) costs 10. Migration 0554
sets `credits_5s = 5` and switches `ace-step-loop` on. The editor surface still needs
`MUSIC_RUNTIME_FLAGS.beatAi`.
The public catalog, cached projection, model picker and fallback tokens exclude
it; the price watch skips this private alias. Existing endpoint capabilities and
unit-rate metadata apply. No new dependency, Worker binding, CSP host or route.

Generate uses project BPM, optional key and the current cycle, capped at 60 s.
A cycle shorter than 10 s requests 10 s and trims placement using region length.
Stems, targeted stems, Extend and Replace reuse the existing routes and SQL
prices. All paid source actions require the current song version. Replace uses
one non-reversed pass, cycle intersection and source offset, bounded to 1–30 s.
The editor never commits a replacement as the current Music version.

Document version stays 4. New `stem` and `target` assets carry parent song and
version lineage plus an owned request and part/kind. Song generation, Extend
and Replace retain `song` references. Mixdown lineage includes these parents;
D7 rights attestation remains required only for `take` assets.

Held assets cannot play or export. One cache transition removes both decoded
directions, marks a permanent hold and fences in-flight loads. A discovered
hold stops playback. A first-load held alternate without metadata is not placed;
it remains in Music for later review. Every download and library save rechecks
the signing endpoints immediately before delivery, including cached/rendered WAVs.
Each stem checks only its track’s used assets; a mix checks its used assets in
the chosen range. Checks have no confirmation cache and at most four requests
in flight. Each library-save POST is checked too; any failure stops the run. Holds and failed
availability checks discard prepared exports and fail closed. Other missing
sounds retain the existing explicitly acknowledged export behavior.

The existing stem archive and targeted-stem signing RPCs now refuse held assets.
The four source/dispatch context readers refuse held sources after existing
replay checks. Submit bodies insert a share-lock/hold check after replay, before
any debit or dispatch, so a hold committed during source inspection is observed.
A concurrent hold update waits for admitted work's lock. This is source admission
protection, **not a claim that Music audio outputs are content-scanned**. Existing
accepted keys still replay without another debit.

Frozen-order deviations and unresolved qualification:

- 0549–0552 split the prescribed replacements into files below 500 lines. SQL
  bodies preserve money/replay logic; review diffs are saved separately. The
  private admission helper retains its existing restricted ACL.
- Real take lanes are phase 9. Phase 7 uses two adjacent tracks, with the second
  playable alternate muted.
- A1 cannot literally equal a catalog row for every operation: pair quotes are
  two units and targeted stems use existing SQL duration tiers. The UI copies
  `total_credits` without price arithmetic; existing pricing is unchanged.
- Repository ZIP fixtures validate ZIP signatures, not real Mureka member names.
  Extraction accepts exactly two audio members, exactly one basename beginning
  with `vocal`; ambiguous layouts fail permanently. Real-provider qualification
  is pending and no provider call is made by these tests.
- Migration/ADR numbers were checked against local refs; live GitHub enumeration
  was unavailable. Recheck before integration. No commit or PR is created here.

The goal is met when all required host proof passes, source-hold interleavings
and replay are verified, 375 px and 1280 px sheets are checked in both themes,
and the owner approves D6, migration application and a staging-first flag flip.

**Amendment 2 (2026-11-20, native N8; touches money routes).** No new flag is
introduced. Generation quotes check `musicBeatAiEnabled()` immediately after
JSON decoding, before parsing or an RPC, when the body selects `ace-step-loop`.
With the flag off the response is 404 `beat_ai_unavailable`, with no quote row.

For submission, only while Beat AI is off, the service-role select first resolves
the authenticated user's internal id, then reads that user's quote by its already
validated UUID (`model_id,consumed_at`, limit one). An own, unconsumed beat quote
gets 503 `beat_ai_unavailable`, `Retry-After: 60`, before `music_submit_pair`.
This is deliberately retryable: the read can race an original transaction that
has not yet committed. The web and phone keep the receipt and idempotency key.
Consumed quotes continue to the atomic replay RPC without a new debit. Other
models and foreign/missing quote ids continue unchanged; ownership is not
revealed. A failed select logs no vendor error text. A `beat-ai.` idempotency key fails
closed with 502 `temporarily_unavailable`; any other key continues to the RPC, so
ordinary Create never depends on this read. Residual risk: a beat quote minted
while on (five-minute expiry) and sent under another key during a flip and a read
failure. With Beat AI on, neither select runs. Responses are no-store.

The phone probes with exactly `{"model_id":"ace-step-loop"}`. A 400 means on;
a 404 or `_unavailable` code means off; a 401 means signed out; a transport error
means offline; any other response (including 2xx) fails closed. The probe is per
editor mount and account, never shared across accounts. The incomplete body
cannot create a quote. The phone uses the existing API owner fence for every
request, and fences async state, placement and receipt retirement by editor mount
and authentication generation.

Phone receipts include the original server quote and persist before submission,
under owner + beat namespaces. One key per quote is reused after ambiguous
failures, 401, rate-limit Retry-After, or flag changes. Relaunch recovery only GETs;
unacknowledged requests show the original price before an explicit retry. AI
results use shared deterministic placement ids and the N2 history/store path;
retirement follows flush and verification of the saved document. Magic success
candidates remain durable until a layer is saved or the person discards results.

Native parity gaps agreed for N8: Split stems remains disabled with web-editor
copy because React Native lacks the ZIP loader's streaming decompression APIs.
Target stem remains available.

Repository configuration at this amendment: `wrangler.jsonc` sets `beatAi: true`
and `magicBar: false` for production and staging (the live Worker was not read).
With that configuration the guards take their on branch and add no reads, the
probe reports on, and a phone build containing N8 can quote and charge for
Generate, Target stem, Extend and Replace. The phone Magic Bar is built but off
(`MAGIC_BAR_ON_PHONE`): `magicBar` has no API-visible state and its quotes use the
public `ace-step-1.5` Create model, which the guard does not cover. Magic layers are owner-scoped sidecar files, at most four; playback
is explicitly unavailable in this slice. AI audio track playback depends on
N6/N7; audio tracks show no drum kit picker in the native mixer. Source
operations use an additive audio-region picker until region selection lands.
Native metadata decoding is not device-qualified by this work order. Encoded
size, header/channel/duration and PCM admission precede decoding; one decoder
runs at a time and temporary files/contexts are cleaned up. The native adapter
requires a valid bounded range response for header inspection (including when
signing supplied size); a server without range support fails closed.
