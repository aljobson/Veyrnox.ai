# ElevenLabs Music direct readiness — 2026-09-28

## Decision

Do not implement or activate a direct Music route on the strength of the public
price alone. Obtain written confirmation of Veyrnox’s permitted platform use
and an applicable commercial quote first. No paid generation, subscription,
sales message or production change was made during this assessment.

## Current offering and economics

The production catalog was queried read-only. Its ElevenLabs rows are fal
Dialogue v3, Sound Effects v2 and Turbo speech, plus the inactive kie Turbo
twin. There is no ElevenLabs Music row. Direct Music would therefore be a new
offering, not a replacement of an existing Veyrnox route.

[ElevenAPI pricing](https://elevenlabs.io/pricing/api), checked September 28,
lists Music at $0.15/minute excluding taxes. Against the September 26 survey’s
retained fal quote of $0.60/minute, this is a theoretical 75% supplier reduction:
$0.45 versus $1.80 for three minutes. The fal quote was not reverified in this
assessment. These are list-price comparisons, not a verified Veyrnox cost.
The pricing FAQ also calls Music billing per generation; confirm duration
rounding and minimum charges before defining a priced catalog unit.

## Platform rights

The [model-specific terms](https://elevenlabs.io/eleven-music-model-specific-terms)
(last updated May 26, 2026) prohibit reseller rights across self-serve plans and
list custom rights for enterprise plans. Their reseller definition includes
certain aggregators offering models with minimal integration. Veyrnox’s model
selection appears relevant to that definition; obtain the vendor’s written
classification instead of assuming ordinary API access grants platform rights.
Music-library rights are also custom at enterprise level. This does not assess
or change existing fal speech or sound-effects agreements.

The [Music Terms](https://elevenlabs.io/music-terms) restrict artist/song
references and certain inputs, and allow use-case-dependent pricing. Account
and output rights must cover the proposed customer workflows before launch.

## API implementation findings

The [compose endpoint](https://elevenlabs.io/docs/api-reference/music/compose)
accepts POST /v1/music authenticated with xi-api-key and returns audio bytes,
with an optional song-id response header. It is not a task-ID-and-output-URL
contract like the current asynchronous provider adapters.

A prompt-based first version should explicitly pin model, format and duration.
The documented duration range is 3–600 seconds, with prompt length up to 4,100
characters. Seed is not supported together with prompt; instrumental control
is. Request timeouts, uncertain completion after disconnect, bounded audio
storage, duplicate submission and refund behavior need a deliberate design.
Do not automatically retry a timed-out paid request without established
provider idempotency or recovery semantics.

## Vendor inquiry draft — not sent

Veyrnox.ai is a credit-metered consumer platform offering several image, video
and audio models. We are considering ElevenLabs Music as a named option, with
private output storage, playback and customer downloads. Please confirm:

1. Which agreement permits this platform use, including any reseller or
   bundled-service classification and branding requirements?
2. What rights can our customers receive for downloads, commercial videos,
   music distribution and retained outputs after subscription changes?
3. What price, minimum commitment, billing duration rounding, taxes and
   concurrency limits apply to us? Does the public $0.15/minute rate apply?
4. Which supported model version and API route should we pin, and how can we
   recover a completed generation after a timeout without duplicate billing?

## Engineering sequence after commercial qualification

Record the written answer and quote, then design the direct audio completion
path and bounded storage. Stage a separate inactive catalog row with its own
capability record. Verify measured duration, successful-job billing, output,
refunds and duplicate handling in staging before proposing activation through
the protected production migration workflow. No current customer price should
change on the basis of this assessment.
