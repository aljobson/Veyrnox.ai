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
