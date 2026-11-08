# Landing page craft pass, 2026-11-08

Skill: `charles-unreasonable-craft`. Scope: the marketing landing page
(`app/veyrnox/page.js` and its sections). Not touched on purpose: copy (the
`charles-unslop` session owns it), the nav and footer link forest, the
announcement bar, other pages. The `interface-craft` skill the brief names is
not installed on this machine, so `apple-design`, `emil-design-eng` and the
Disney principles stood in for it.

## Bar

Awwwards Site of the Day for the page; the weights are Design 40, Usability 30,
Creativity 20, Content 10. Local captures use the repo's own dev server with no
Supabase, so the catalog falls back to `tokens.js` and `/api/catalog` answers
503; those console lines are the environment, not the page.

## Audit (before)

Captured at 1440 and 390, dark, full page and by scroll position.

1. **The headline promises a receipt and the receipt is 900 px down.** The hero
   put a 9:16 film beside the headline and the working price slip below the
   film. The slip's one authored entrance (it prints out of a printer slot)
   played off screen. Worst note on the page.
2. **Two unrelated styles in the first screen.** A neon aqua text halo and two
   twinkling dots on the headline, beside a thermal-paper slip. The dots read
   as dust on the screen. The halo is the generic "AI glow".
3. **Rows of mixed shapes with no shared baseline.**
   - The price list: three group tiles at 4:3, 1:2 and 1:1, so the Video,
     Image and Audio headings sat 480 px apart and no list lined up.
   - The five feature cards: four portrait clips and one 4:3, so one card was a
     third of the height of its neighbours and the five price lines sat on five
     baselines.
4. **A visible bug in the template roller.** On the 1x1 tiles (128-144 px wide)
   the "Viral inspiration" disclosure and the "NEW" chip overlapped; the "N" was
   cut off.
5. **The page's thesis is static.** "Every credit leaves a line" shows a
   finished statement. The ledger is append-only; the slip could be too.
6. Left alone, logged for the owner: the Publish section is a wall of text
   with half the row empty; the template roller and the wall below it show the
   same templates twice; every section opens with the same `pt-28 sm:pt-36`
   (the criteria file asks for intentional rhythm); the 16:9 film is a 1252 px
   black frame whose content is about 360 px wide on a phone.

## Directions explored (rendered, `scratchpad/directions`)

| | Idea | Verdict |
|---|---|---|
| A | The receipt is the hero: slip under the headline in the first screen, film keeps its column, aqua becomes the printer's own light | **Chosen.** Keeps the brand and the owner's film rule; the metaphor is shown, not told. |
| B | The roll: one full-height paper strip carries the headline | Strongest poster, but a pale strip on a dark site breaks the theme, breaks "nothing covers the film", and has no phone answer. |
| C | The meter: a 380 px rolling price numeral | Best typography, but it shows the cheapest price and pushes the form below the fold again. |

## System

No new tokens. Everything uses the existing `vx-*` colour tokens, Archivo for
display, JetBrains Mono for prices and `--vx-ease-out`. Spacing stays on the
Tailwind 4 px scale; radii stay `rounded-2xl`. New classes: `.vx-slot::after`
(seam), `.vx-feed` / `.vx-feed-line` (statement), and `MediaTile`'s `ambient`
prop.

## What changed

- **Hero** (`_sections/hero.js`): headline, lead, then the live price slip in
  the left column; the promo film keeps its own column. The slip's Generate
  button is the one primary action, so the second "Start creating" pill is
  gone (the `home.hero.start` key is now unused; left in the catalogs so this
  branch does not collide with the copy session). The free-credits line and
  "See every price" sit under the slip.
- **Light with a source** (`veyrnox.css`): the printer slot has an aqua seam
  that comes on 40 ms before the paper moves, holds while it feeds and settles
  to standby (anticipation, follow-through). The paper feeds at a steady speed
  and eases only as it stops (1100 ms, was a 900 ms wipe that was 95% done in
  400 ms). The headline halo is now a faint 36 px lift and the dots are gone.
- **Statement prints in** (`footer.js`, `PrintOnView.js`): each line is added
  under the last as the slip scrolls into view, balance last. Lines are hidden
  only where script runs (`@media (scripting: enabled)`); reduced motion shows
  them all at once.
- **Shared frames** (`MediaTile` `ambient`, `hero.js`, `showcase.js`): clips
  keep their own shape (PR #817 made that a rule) inside one frame, and a
  blurred copy of the poster fills the bars. Cards 9:16, price-list tiles 1:1.
- **Roller** (`PresetCard.js`): on the roller the NEW flag moves into the
  caption, so nothing overlaps at 128 px.

## Verification

Captured with the skill's Chrome tooling against the local dev server:
1440 dark and light, 1024, 768 (taken, not read) and 390; stills by scroll
position; the hero print-out frame by frame at 12 fps; the statement sampled in
real time (opacity of each line every ~60 ms).

- Hero print-out: the aqua seam is lit by 167 ms, the paper starts leaving the
  slot at about 250 ms, and the slip is complete by about 1.3 s.
- Statement: hidden before it scrolls in, then one line every ~170 ms, balance
  last. With reduced motion every line is visible the moment it is flagged.
- Console: only dev-environment lines (no local Supabase, `/api/catalog` 503,
  the Reticle dev websocket). No hydration or React warnings.
- Measured on the 1440 first screen: headline ink starts at x=96, lead x=95,
  slip x=94. The 2 px is the display face's side bearing; left alone because
  the first glyph differs by language.
- Tests: 140 of 140 across 17 related files (landing, public-page consistency,
  theme and landmarks, amber rule, shelf, roller, wall, presets, product
  knowledge sync). `npm run lint`: 0 errors, 146 warnings, none in new code.
  `scripts/check-hard-wall.sh`: clean.
- **Not run:** the production `next build` (the machine's load average was
  40-250, so a build was impractical; the dev server compiled and served every
  changed file). Not checked: Safari and Firefox, a real phone, a screen
  reader, performance (LCP, INP), the 768 px capture by eye.

## Open for the owner

- The hero no longer has a "Start creating" pill; Generate on the slip is the
  one primary action. Restoring it is one line in `hero.js`.
- The headline halo and the two dots are gone (see audit 2). Revert is
  `.vx-title-glow` in `veyrnox.css`.
- `home.hero.start` is now an unused key in all eleven catalogs.
- Still open from the audit: Publish section composition, the roller and the
  wall showing the same templates twice, identical section padding, the 16:9
  film's black frame on a phone, the dull gray bars on the 4:3 music card.
