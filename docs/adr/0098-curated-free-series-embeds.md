# ADR-0098 — Curated free series use official provider embeds

Status: accepted by the owner on 13 October 2026.

## Context

Social Cinema needs complete AI-made series that viewers can watch free. Public
availability does not grant Veyrnox permission to download, copy or re-host a
creator's video. Re-hosting therefore waits for a written creator licence or
partnership.

YouTube permits a site to present an embeddable public video through its
official iframe player, subject to the YouTube API Services terms and player
requirements. The source video remains on YouTube and the creator can remove it
or disable embedding.

## Decision

Veyrnox may curate a complete free-to-watch series through the official
YouTube privacy-enhanced iframe player when all of these conditions hold:

- the source is the creator's public upload and embedding is enabled;
- Veyrnox keeps the creator and YouTube source visible;
- viewing is free and is not counted toward Cinema Pass or credit limits;
- Veyrnox does not download, cache, alter or provide offline playback of the
  audiovisual content;
- the official player controls, branding and advertising remain available;
- removal or disabled embedding removes availability without a local fallback.

One compilation may be presented as its named episodes when the creator has
published explicit chapter boundaries. The player receives those start and end
times; Veyrnox does not split or store the source file.

The first title under this decision is *Mission Pandora: The Last Pilot*: one
official 34:36 compilation with 17 named chapters. Each chapter becomes an
episode route and the full source remains the creator's one YouTube upload.

## Security and privacy

The Content Security Policy adds only `https://www.youtube-nocookie.com` to
`frame-src` and `https://i.ytimg.com` to `img-src`. YouTube receives the HTTP
referrer required for embedded playback. The player uses a 16:9 responsive
frame larger than the provider's minimum size.

The Privacy Policy explains embedded-player data processing and links Google's
Privacy Policy. The Terms link the YouTube Terms of Service. External episodes
do not invoke Veyrnox voting, comments, story polls, unlocks or playback-meter
heartbeats, because they are not Veyrnox-hosted catalogue rows.

## Consequences

The catalog can offer a real complete series immediately without asserting
redistribution rights Veyrnox does not have. Playback depends on YouTube and on
the creator keeping the upload public and embeddable. Re-hosting, editing,
paywalling or removing provider attribution still requires a separate written
licence.

Additional providers or media hosts require another documented decision and a
narrow CSP change.
