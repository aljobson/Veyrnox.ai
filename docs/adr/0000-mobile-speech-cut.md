# ADR-0000: Speech analysis and reviewable phone cuts

Status: Implementation draft; OFF, migrations unapplied, acceptance proof blocked.
Host assigns the permanent ADR number. Frozen plan SHA256:
`d0c177d18d2993fa9e52d99d7036e0630b698ae9af153f1c78e84f07a87b6c18`.

## Decision and rollout

Speech Cut sends the whole source to transcription, then plans cuts deterministically
on the phone. It accepts only `{source:{type:'job',jobId}}` for an owned, stored
Library/generated video or audio job. Project assets (`assetSource`, `p-`) and local
files (`f-`, `e-`) are excluded. There is no upload or extracted-range path.

Server `SPEECH_CUT_ENABLED` and phone `EXPO_PUBLIC_EDITOR_SPEECH_CUT_ENABLED` require
exact `true`. Both Worker environments ship `false`; no editor runtime flag changes.
The phone also requires a successful quote. The inactive catalog row is
`elevenlabs-scribe-v2`, provider `fal`, endpoint
`fal-ai/elevenlabs/speech-to-text/scribe-v2`. The schema's modality column is text
without an enumerated CHECK, so the row uses `audio-to-text`; cost_unit is
`per_generation`, billing_seconds NULL, matching the staged catalog precedents.
No activation, deployment, live request, or migration application is part of this work.
A server-only `SPEECH_CUT_WEBHOOK_SECRET` of at least 32 characters is required before
submission; it belongs in Worker secrets, never public/build configuration.
The standalone flag raises the public-var budget from 69 to 70. With the recorded
50-secret baseline plus this new secret, that is 121 of 128 text bindings; the
owner must check the actual live secret count before any deployment.

## Price and reusable results

The proposed flat price is **2 credits for a whole source of 0.5–60 seconds**.
At the documented $0.008/min rate, worst-case provider cost is $0.008 and the
ADR-0037 update to ADR-0014 gives `ceil(0.008/0.01796) = 1` credit as the floor.
Two is a proposal, not an enabled price. Flat pricing avoids estimates from edits
or partial ranges; the catalog alone determines the quoted and atomically checked
price. A changed price returns `price_changed` with the new catalog amount before
debit and requires another user action.

Completed analyses are reused free for 30 days from attempt creation, with exact
owner, source job, stored SHA256 and schema version. Attempts remain independent;
the cache points to the newest completion via upsert. Admissions serialize per
user (stronger than per-source serialization, also enforcing the three-open cap).
A different key for an in-flight source joins it without a second debit or submit.
Every accepted key has a content-free receipt referencing the financial job;
receipts remain after analysis expiry. Replaying a failed/refunded key cannot buy
again. Replaying an expired key returns `result_expired`; the phone's next explicit
start uses a new key. Quote, polling and replay use read quota. Generation quota
is evaluated only for new paid work, inside the admission transaction.

## Trusted source measurement

`get_user_asset` authorizes access; the speech resolver additionally rejects deleted
accounts/jobs, missing/expired/held assets and binds the returned object to its SHA256.
A server-minted five-minute presigned URL is used only for bounded reads. The resulting
probe is persisted against the asset FK and fingerprint. Admission trusts that probe,
never client duration; the client value must match within 0.25 seconds.

Supported MIME/container combinations: non-fragmented MP4 (`video/mp4`), MOV
(`video/quicktime`), M4A (`audio/mp4`, `audio/x-m4a`), fixed-frame WAV
(`audio/wav`, `audio/x-wav`), and MPEG Layer III MP3 (`audio/mpeg`). The existing
mediaLength parsers fail closed on ambiguous sample tables, fragmented containers
and unsupported audio encodings. Reads have a combined 5 MiB cap and a 15-second
budget, using exact bounded ranges and no redirects. WAV uses a 64 KiB header cap;
MP4-family uses the existing 4 MiB movie-box cap and 64 top-level-box limit.
MP3 requires counting all frames, so only entire MP3s fitting 5 MiB are supported.
This is a proposed deviation from a header-only MP3 probe: the existing parser
explicitly rejects a partial MP3 and does not trust Xing/VBRI duration hints.
Unsupported/unreadable sources and sources longer than 60 seconds fail before debit.

## Settlement, uncertainty and cleanup

The request uses `ledger_debit`; settlement/refund RPCs lock the job. Completion
stores only the validated version-1 contract and transitions SUBMITTED to STORED.
Failure and its `ledger_refund` are one transaction. Confirmed refunds alone produce
`refunded:true`. Empty speech produces a typed no-speech failure and refund; it does
not propose deleting an entire silent clip.

A definitive submit rejection refunds. Once transport starts, an ambiguous result
or lost database acknowledgment is held, never resubmitted or immediately refunded.
A signed callback can recover a DEBITED job through a per-job, domain-separated HMAC
correlation token in its callback URL; signature/tenant verification is still mandatory.
Accepted handles use the normal provider-id lookup. Terminal attempts ignore late
successes. Tokens are consumed logically by the terminal attempt state; they are
not a substitute for fal signature verification.

The speech sweep covers DEBITED, SUBMITTED and unsettled failed attempts after
15 minutes, updates analysis status and refunds in the same transaction. It runs
before the existing generic sweep; the generic sweep excludes speech jobs.
The 0414 indefinite unknown-submit hold is deliberately inapplicable: a bounded
60-second transcription has at most $0.008 exposure and no long-running render spend.
A callback and sweep serialize on the same job lock; whichever settles first wins.

Source deletion/expiry removes probes and analyses via asset foreign keys. A BEFORE
DELETE trigger closes/refunds queued attempts, then cascading deletion erases content.
Account erasure deletes analyses/probes using the users.deleted_at trigger; existing
account-erasure admission refuses unsettled jobs. Cache rows cascade with analyses.
The explicit sweep removes content older than 30 days. Reads recheck source existence,
ownership, fingerprint, holds and expiry even before the retention sweep runs.
Financial jobs and content-free request tombstones are retained. No browser grants,
policies or default-privileges allowlist entries are added. Library readers, wins
creation counts and creation push enqueue exclude speech analyses.

## Privacy, languages and planning

Speech webhook deduplication stores only request id, bounded status and byte size.
Transcript normalization happens in memory; no transcript or signed/provider URL is
logged. fal's opt-in sanitized submission mode suppresses upstream bodies and error
messages; existing callers keep their previous logging behavior. Owner responses
are no-store and project a bounded contract. Phone results/keys remain in memory,
clear on account changes, and never use file-backed appCache storage. Polling stops
after three minutes or unmount; the account is checked on every request.

Language normalization supports en/es/zh/hi/ar/fr/pt/ru/ja/de/ko, including provider
ISO-639-3 aliases. Unknown languages become `und`; silence timing still works,
retake suggestions are disabled. This is a supported code vocabulary, **not a claim
that all eleven languages have been tested against the provider**.

Silence proposals use word gaps >=0.75s, 120ms padding, overlap merging and shortest
gap reinsertion to meet ten sections, with a sixty-second output cap. A word stretched
over a pause is never split. Retakes first form utterances at 0.45s gaps or sentence
punctuation, then compare ordered utterances within eight seconds. At least four
tokens are required; normalized prefix restarts or >=0.8 ordered-token similarity
propose the earlier occurrence. Chinese/Japanese and unspaced Korean use characters.
Two-token repetitions such as “had had” are excluded. This cannot establish intent,
correctness or delivery quality; every removal has a checkbox and requires Apply.

The selected audio/video clip (otherwise the first video) is previewed in source
seconds. The resulting immutable timeline is committed through the editor's normal
history once; Apply rechecks project, account and editRevision. Cuts ripple later
clips on the selected lane, preserving other lanes, as the editor's lane-ripple
operation does. Reverse/rate are mapped in source time. Final timelines must fit
ten video/audio sections and sixty seconds.

## Outstanding evidence and structural deviations

- SQL is split into 0451 (new schema/lifecycle) and 0452 (existing readers/push/sweep)
  to keep new files under 500 lines. Neither migration has been applied. The local
  checkout already contains Plan A's 0450. `gh pr list` could not reach GitHub;
  open PRs were checked through the GitHub connector. A fresh origin/main fetch
  and final number reservation remain for the host.
- Existing app translation catalogs/review JSON exceed 500 lines. New strings use
  that established format, with generated English and length-review metadata;
  this needs an exception to the literal all-files-under-500 rule. New modules
  and the modified editor screen stay below 500 lines.
- New test authoring is blocked by the supplied ARTEMIS prerequisite: its diagnostic
  tool requires approval that this session cannot obtain, and ADB cannot start a
  listener in the sandbox. No device-verified interaction claim is made.
- The full agreed proof is blocked because the mandatory shared build-slot lock is
  outside writable roots. No independent lock or unlocked full-suite run substitutes
  for it. No local test database is configured, and applying migrations is forbidden.
- The requested new regression/acceptance suites, per-language word fixtures,
  concurrent admissions, day-31 replay and ledger invariants remain unverified and
  must be completed before this draft can be accepted.
- Live 15/60s latency, signed failure delivery, music-only, multiple speakers,
  additional languages/codecs and actual account billing remain unprobed. The owner
  must decide price/reuse window and whether retakes belong in the first release.
