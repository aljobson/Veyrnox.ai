# ADR-0012 — TTS provider selection

Status: **proposed** — 2026-09-11. The decision is still open, but text-to-speech is live in production; see the drift notes at the end.

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
>
> **Drift note, 2026-10-03.** Still open. The live catalogue now carries four
> text-to-speech models: `inworld-tts`, `elevenlabs-tts-turbo`,
> `elevenlabs-dialogue` and `minimax-speech-2.6-hd`. ElevenLabs and MiniMax are
> options 1 and 2 above; no decision between them was recorded here.
>
> **Staged, not decided, 2026-10-09.** The owner asked about speech in a voice
> the user describes in words; none of the four live models takes a voice
> description. `supabase/0235` stages `qwen-3-tts-voice-design`
> (`fal-ai/qwen-3-tts/voice-design/1.7b`) **inactive** so that can be judged:
> the voice-design form of option 4, served on fal at $0.09 per 1000 characters
> (read 2026-10-09), priced at 6 credits. VoxCPM2, the model first asked about,
> is hosted by no provider (fal, kie, Replicate and Hugging Face checked
> 2026-10-09) and would need our own GPU. The row takes words only and no
> reference audio, so it is not the voice cloning the Acceptable Use page
> forbids.
>
> This records what was staged and why. Whether to switch it on, and whether
> it settles the choice above, is the owner's call and is not made here.
> Before any activation: one live 1000-character generation, to confirm the
> audio is not cut short and what fal bills (see the header of 0235).
