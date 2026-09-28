# Kie speech route readiness, 2026-09-28

The September 26 survey identified potential supplier savings for ElevenLabs
Turbo and dialogue. Neither is currently qualified to replace its fal route.
These are readiness findings, not a change to pricing or active catalog rows.

## Turbo: funded retry still fails

Migration 0107 already stages `elevenlabs-tts-turbo-kie` inactive, with an
adapter branch, capability record and verification-script case. Do not add
another staged row. ADR-0020 and PR #289 recorded an earlier failing speech
row, but the exact earlier task result was not available in the inspected
tracked files.

The owner supplied a local API credential and authorized one verification,
then confirmed funding and authorized one retry. Both used the existing
adapter through `scripts/verify-kie-endpoints.mjs`, with the Rachel voice and
its existing bounded speech sample:

| Task ID | Outcome | Provider-reported credits consumed |
|---|---|---:|
| `81c96e3bcbd54304bc1f6918d6559f99` | Failed, code 500 | 0.0 |
| `47d7e7d5fc0acf8d2c322e1f623db59c` | Failed, code 500 after funding | 0.0 |

Authenticated `recordInfo` returned `Internal Error, Please try again later.`
for both tasks. The reported zero consumption is task-record evidence, not
an independent dashboard reconciliation. Neither returned usable audio.
Funding did not resolve the failure; the generic error does not identify a
root cause or prove that the adapter is wrong. No automatic retry was made.

Before these submissions, 26 adapter/capability tests and the free Turbo
verification plan passed. These checks establish local request behavior,
not upstream availability, voice parity or successful-job billing.

**Decision:** keep the existing fal Turbo route active and the kie twin
inactive. Give kie support the task IDs for investigation before further
paid retries or activation. No support message was sent by this review.

## Dialogue: cheaper quote does not establish a compatible replacement

The current fal route uses `lib/dialogue.js` to map up to four speaker names,
in order of first appearance, to **Aria, Roger, Sarah and George**. It preserves
speaker reuse and continuation lines. Its capability record also offers
optional `seed`. The entire source script is capped at 1,000 characters.

Kie's current documentation describes:

- Model `elevenlabs/text-to-dialogue-v3` through the existing market-task API.
- `input.dialogue`, an array of `{text, voice}` objects; the total text limit
  is 5,000 characters. Veyrnox would still need its lower priced-unit cap.
- Optional `stability` with values 0, 0.5 or 1, and optional `language_code`.
- No documented `seed` field in the request contract inspected.

The voice description says names or IDs are accepted, and an array example
uses names. However, the expanded voice enum and request code example use
IDs. The listed voices contain **Aria - Sultry Villain**, ID
`TC0Zp7WVFzhA8zpTlRqV`; that display name does not prove it is the same voice
as fal's stock Aria. Roger, Sarah and George were not present in the expanded
voice list inspected on September 28.

| Requirement | Readiness |
|---|---|
| Multi-speaker request structure | Documented; mapping can preserve script structure |
| Existing four voice identities | Not established; description and enum conflict |
| Existing optional seed control | Not documented on kie |
| $0.07 / 1,000 characters | Retained survey quote; not verified by a successful job |
| Output, storage and refund behavior | Not tested for this endpoint |

**Decision:** do not stage or advertise this as a drop-in swap yet. Do not
silently map users' speakers to different voices or ignore their seed. No
paid dialogue task was submitted and no new catalog migration was created.

Resolve the voice contract with kie and confirm whether the existing voice
identities and seed behavior are available. If different voices are the only
supported option, assess a separately named offering with its own capability
record rather than replacing the current route. A subsequent implementation
must keep it inactive until provider output, billed cost and the normal
completion/refund paths have been verified.

The retained price comparison remains $0.10 versus $0.07 per 1,000 characters
(30% potential supplier saving). That arithmetic is not evidence of equivalent
outputs or activation readiness. Do not reduce customer prices on this basis
alone. Kling 3.0 remains the next independent supplier candidate to assess.

## Sources

- [Kie Turbo request documentation](https://docs.kie.ai/market/elevenlabs/text-to-speech-turbo-2-5)
- [Kie dialogue request documentation](https://docs.kie.ai/market/elevenlabs/text-to-dialogue-v3), expanded voice enum inspected September 28
- [Kie pricing](https://kie.ai/pricing), retained September 26 survey
- [Original inactive staging, PR #278](https://github.com/aljobson/Veyrnox.ai/pull/278)
- [Earlier failing speech note, PR #289](https://github.com/aljobson/Veyrnox.ai/pull/289)
- `lib/dialogue.js`, `lib/modelCapabilities.js`, `lib/additionalModelCapabilities.js`
- Authenticated task records for the two IDs above; credentials and raw task payloads are not committed
