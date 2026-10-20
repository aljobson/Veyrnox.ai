# ADR-0230: Mobile Oddlings: "Animate this portrait"

**Status:** Proposed 2026-10-20. Closes the "animate this portrait" item that ADR-0158 left out.

## Context

On the web, a cast character has an **Animate** action: it opens Create on an image-to-video model with the portrait
loaded as the start image and the character's opening move written into the prompt
(`buildOddlingAnimationPrompt`, `animationModel`). The phone's character sheet had Make a portrait and Make a short
(ADR-0158) but no way to turn a cast portrait into a clip.

## Decision

- **No new path.** The sheet gains an **Animate this portrait** card that opens `/create/[modelId]` with the web's
  prompt, `duration=5` and a new parameter `startOddling=<cast id>`. Create fills the model's image slot from that
  parameter through the same file slot (`SourcePicker`) as a picked photo: same type, size and upload checks, same
  stored AI agreement, same `source_keys` request.
- **Model and words are the web's.** `animationModel` is ported: an open (not gated) video model that the app can drive,
  whose only required file is the image and that can be bought at five seconds; `kling-3.0-i2v` when open, otherwise
  the first that fits. The prompt is word for word the web's, for every character and opening move (a test runs the web
  file and compares). The card has the web's eight opening moves.
- **Price first.** The button shows the catalog's price for five seconds (`estimateCredits`, never computed in the
  app); Create shows it again. Nothing is charged until Generate is pressed in Create. Offline, nothing opens.
- **The portrait is loaded by Create, not by the sheet.** `startOddling` is accepted only if it is one of the 72 cast
  ids. Create downloads the public portrait into the cache, checks it is a WebP of at most 5 MB (header bytes), and
  hands it to the image slot. If it cannot, Create says so and the person can choose an image themselves. If the model
  has no image slot, the parameter is ignored.
- **Library files (ADR-0190).** A cast portrait is a public site file, not one of the person's creations, so it uses the
  upload path above, as the web does. A portrait the person made themselves already has the Library choice on the same
  slot. A passport made in the builder has no portrait until Create makes one.
- **No server change, no flag, no migration.**

## What differs from the web

- The web animates from the gallery card and the character page; the phone has it on the character sheet only.
- The web fetches the portrait in the Create page itself; the phone does the same inside Create's screen (not in the
  sheet), so a slow download never blocks the sheet.
- The web offers the action only for characters with a calibrated portrait; all 72 have one, so the phone has no
  exception list.

## Not proved

`tsc` and Jest only (owner disk rule). Not run on a phone or against a real server: that the live catalog has a model
that fits, and that the upload and request succeed with the cached portrait, are only tested through their pure parts.
