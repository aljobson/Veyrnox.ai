# ADR-0176: Mobile Character panel in Create (parity plan P2)

**Status:** Proposed 2026-10-19. Builds on ADR-0153 and ADR-0175 (camera, voice, length), and on the Oddlings builder
(ADR-0158, PR #1348, not yet merged: this branch contains it).

## Context

The web Create page has a Character panel for image models: grouped traits become words in the prompt. The planning
session decided the phone gets it as one shared module, reusing the Oddlings data, not a second copy.

## Decision

- `components/CharacterPanel.tsx` is a switch plus the Oddlings builder's own `CategoryList` and `PickSheet`, with
  Randomize styling and Clear. Choices go through the Oddlings `changePick`, so contradictory picks are settled the
  way the web settles them. Nothing is copied from the web or from the Oddlings screens.
- The prompt sent is `buildCharacterPrompt(prompt, picks)` (Oddlings port of `character.js`, with its drift test)
  and then, if the camera is on, the Cinema camera sentence. The same order as the web. The person's words are cut
  to fit 2000 characters, never the character or the camera. The model and the price do not change.
- Shown for image models that take `prompt`. The saved draft keeps the switch and the choices (unknown options are
  dropped when read back); a draft from before reads back with the panel off.
- The Oddlings "send to Create" link still passes a finished prompt as before; it does not fill this panel.

## Not in this slice

The live figure preview (a WebView in the Oddlings builder) and the Oddling name, voice and show fields. Both stay on
the Oddlings screens.

## Not proved

`tsc` and Jest only (owner disk rule). Not seen on a phone. Merge order: #1348 first, then this, or this carries
the Oddlings files in its diff.
