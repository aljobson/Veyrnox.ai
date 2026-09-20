# ADR-0012 — TTS provider selection

Status: **proposed** — 2026-09-11

## Context

ADR-0011 dropped `cosyvoice-2` from the catalog because CosyVoice is not
served on fal. The audio surface of Veyrnox.ai is empty as a result.

## Options

1. **ElevenLabs** — best-in-class quality, cloneable voices, streaming, EU
   region. Higher unit cost. Long-form pricing structure needs modelling.
2. **MiniMax Speech (fal-served)** — same provider we already use for
   video (H3); keeps the "one provider, one bill" invariant clean.
3. **OpenAI TTS-1 / TTS-1-hd** — cheap, good quality, no cloning, no EU
   residency claim.
4. **Qwen3-TTS (fal-served)** — cheap, credible quality, EU-hostable.

## Trade-offs

TBD — needs latency + margin + EU residency data.

## Recommendation

_None yet — requires research pass._

## Decision

_To be completed by Al._

> **Drift note, 2026-09-20 (audit).** This decision is still open, but TTS is
> live in production: `supabase/0036` seeded `inworld-tts` and `supabase/0044`
> activated it. Inworld is not among the four options weighed above, so the
> shipped state does not correspond to any branch of this ADR.
>
> Deliberately not resolved here — picking a provider is the owner's call and
> writing one in would misrepresent a decision that was never made. Either
> record Inworld as the decision with its reasoning, or supersede this ADR.
