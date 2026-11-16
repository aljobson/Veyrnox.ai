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
