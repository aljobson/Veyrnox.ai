# ADR-0177: Mobile Vey as the web's animated character

**Status:** Proposed 2026-10-19. Follows ADR-0159 (Vey as the chat entry).

## Context

ADR-0159 gave the phone a Vey button, but it was the plain brand "V" in a circle. The web's Vey is a character:
a heart-shaped robot with a head, two arms with hands, legs and a glowing core, whose head nods and arms move
(`app/veyrnox/_components/VeyCharacter.jsx`). The owner asked for the mascot's head and arms to move.

## Decision

- **The web artwork, as seven pictures.** The character's parts (base with legs and shadow, left arm, right arm,
  body, glowing core, head, eyes) were drawn from the web's own paths and rendered, one picture each, on the same
  160 x 170 canvas so they line up when stacked (`assets/vey/*.png`, 136 KB in all). No SVG library is needed, so
  there is **no new dependency and no native rebuild**.
- **It moves.** The head nods, the left arm sways and the right arm waves, the body bobs, the core pulses and the
  eyes blink, each about the same pivot the web uses (neck, shoulders, middle). It uses React Native's own
  `Animated` on the native thread. With **Reduce Motion** on, Vey stands still, and it follows the setting if it is
  changed while the app runs.
- **A picture, not a control.** The character is hidden from screen readers; the button around it keeps its label,
  hint and "Move Vey to the other side" action from ADR-0159.
- **Larger.** Vey is 72 points wide (about 77 high) instead of a 56 point circle, so its arms are visible. The
  exported `VEY_CLEARANCE` grows with it (from 88 to 109 points), and every list that already pads by it follows.
- Placement, hiding with the keyboard and on Cinema, and the stored side are unchanged.

## Not done

- **The "jump onto the i" movement.** The owner mentioned Vey jumping onto the "i" of the wordmark and landing on
  the whole "i". That needs a decision on where it plays (the header logo, the web, or somewhere else) and is not
  built here.
- Other poses from the web (walking, thinking, listening, pointing at things): the phone shows the idle pose
  with a wave.
- A tap or chat state reaction (for example thinking while a reply streams).

## Not proved

- VoiceOver and TalkBack ignoring the picture; Reduce Motion on a device (the code reads the setting; it was not
  toggled in the simulator); Android; a real phone, including battery use of a loop that runs on every tab.
- How the layers look on other screen densities: they are 3x pictures.

## Consequences

Seven picture files added to the app bundle. No new dependency, route, flag or server call. No new strings.
