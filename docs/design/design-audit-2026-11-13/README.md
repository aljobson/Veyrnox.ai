# Design audit and first fix pass, 2026-11-13

Scope: the public site, the signed-in web app and the mobile app, judged
against `docs/design-goal-criteria.md`, `docs/motion-guidelines.md` and
ADR-0264. Three read-only audits (public site, signed-in web app, mobile)
plus a look at the live site at 1440 px and 375 px. About 70 findings; this
file records what was changed in this pass, what was left, and the calls
that are the owner's.

## What the live site showed

- The example statement named a model failing ("Sana v1.5 4.8B failed,
  refund"). That is the thing the owner had cut from the landing film.
- On a phone the analytics consent banner covered 32% of the first screen
  and hid the price slip.
- The closing panel ended on a blurred aqua blob, the generic glow the
  2026-11-08 pass took off the headline.
- Publish was two paragraphs with the right half of the row empty.
- Every section opened with the same padding.
- Template cards print two lines of the raw prompt ("TASK Replace the
  performer…", "Use <<<video_1>>> as the source video…"). Left as it is:
  see Owner calls.

## Changed in this pass

### Public site

| Change | Where |
| --- | --- |
| The statement's refund line no longer names a model or says "failed": `home.ledger.failed` became `home.ledger.refund` ("Automatic refund") in all 11 catalogs | `_sections/footer.js`, `lib/i18n/messages/*.mjs` |
| Closing panel: the blob is gone; a small slip (sign-up credit, balance) prints beside the headline on wide screens | `_sections/footer.js` |
| The price list prints line by line when it scrolls into view, like the statement | `_sections/showcase.js` |
| Hero slip: chips, select and length toggle are 44 px on touch; Generate looks disabled when it is; the printer seam re-lights when the model or length changes | `_components/PriceSlip.js` |
| Publish: heading left, text right, on the statement's grid, under a perforation instead of a hairline | `app/veyrnox/page.js` |
| Rhythm: templates to price list is tighter (one story), the statement gets more air, the FAQ less | `_sections/showcase.js`, `_sections/footer.js` |
| FAQ: the open row's mark turns aqua | `_sections/footer.js` |
| Footer and legal links are 44 px tall on touch | `_sections/footer.js` |
| Consent banner on a phone: the two buttons sit side by side, equal size; 258 px became 190 px (32% to 23% of an 812 px screen) | `components/PostHogManager.jsx` |
| Pricing and 404 primary buttons use the action colour, as every other primary does | `pricing/page.js`, `app/not-found.js` |
| Colour literals became tokens; the tile focus ring matches the tile's radius; press is 0.97 over 120 ms and the stagger 30 ms, as the motion guidelines say | `veyrnox.css` |

### Feature hues on the web

The mobile app already has iris, sky and rose beside mint
(`apps/mobile/src/theme.ts`, `accentPairs`). The web had aqua and amber
only, so every feature wore the same colour. The same three hues are now
web tokens (`--vx-hue-iris`, `--vx-hue-sky`, `--vx-hue-rose`; classes
`text-vx-hue-*`, `bg-vx-hue-*`), defined for dark, light, system, print and
the paper palette. Contrast on the panel and on the base is 7.8:1 or more in
dark and 5.2:1 or more in light and on paper.

Rule, added to `docs/design-goal-criteria.md`: a hue names a feature (its
icon or kicker). It never marks an action (aqua) or a money amount (amber).

## Second pass

Five reviews, each loading design skills, then fix batches whose diffs a
second agent reviewed. Skills used: `impeccable`, `design-taste-frontend`,
`charles-unslop`, `design-review`, `emil-design-eng`,
`make-interfaces-feel-better`, `accessibility-audit`,
`web-design-guidelines`, `ui-ux-pro-max`, `charles-polish`,
`apple-design-hig`, `ios-design-review`, `find-animation-opportunities`,
`improve-animations`, `motion-foundations`, `animate-expo`,
`animation-vocabulary`, `21st-ui-review` (its checklist by hand: the `21st`
command-line tool is not installed) and read-only 21st searches.

### Found on the live site and fixed

| Finding | Fix |
| --- | --- |
| Pricing, models, templates, tools, about, guides, developers and publish had no footer: they stopped on black with no legal links | Each renders `FooterForest` (`flush`, so the page's own bottom padding is not doubled) |
| The Arabic home page was 11,439 px wide in a 1,440 px window: the skip link sat at `left: -9999px`, and in a right-to-left page overflow to the left scrolls | The skip link is lifted off the top with a transform (`app/globals.css`) |
| The home page sent about 115 KB of prompt text to the browser for a carousel that prints none of it, and printed each prompt in full (up to 19,000 characters) under a two-line clamp | The carousel gets no prompts; the wall prints 180 characters, hidden from the link's name |
| The template wall was CSS columns: one tile in the last column, a 700 by 400 px hole | A grid of one shared 4:5 frame (`ambient`), two even rows; nothing is cropped |
| 63 classes used two colour names the theme never defined (`border-vx-border-boost`, `bg-vx-panel-raised`), so outlines fell back to near-white grey and "raised" surfaces were clear; 12 more used three names that do not exist | Two tokens added, the 12 renamed, and a test now fails on a colour class with no token |

### Public site

- Video, Image and Audio headings wear iris, sky and rose on the home price
  list and on /models, the mapping the mobile app uses.
- The five clips come straight after the hero, before the film, so a phone
  shows output in its second screen.
- Price rows: the dotted leader starts at the name; the unit line sits under
  the row (home, /models, template cards).
- The headline glow is gone (`.vx-title-glow` keeps the class a test pins).
- Slips keep a darker edge on a light page.
- The price list's lines stay visible to a keyboard: they are links, and were
  focusable while still invisible (a regression from the first pass).
- Reduced motion also stops the tile hover lift and the press scale.
- The Publish arrow, the pricing table and the hero cards use logical
  (start/end) classes; the carousel scrolls the right way in Arabic and its
  arrows mirror.

### Menus, sign-in and consent

- The mobile, language and models menus close when keyboard focus leaves.
- The language and account menus and Create's option chips grow from their
  control (scale 0.95, 160 ms); the carousel arrows scroll smoothly unless
  reduced motion is on.
- The password toggle said "Show" with a key that means a television show
  in ten languages; it has its own key now. The editor's track control used
  the same key.
- The consent and storage notice is first in the tab order, the page keeps
  room under it, and it steps aside while the sign-in dialog is open (on a
  375 by 667 screen it covered the dialog's submit button).
- Contrast in the light theme: carousel price on its black caption (1.8:1
  at worst, now 5:1), two model-menu tags, two success notices.
- The active nav item is a quiet pill, not the action fill.
- Primary buttons that gave no press response now do: Sign up, the sign-in
  submit, the Clip Editor's create, subscription checkout, the daily check-in.

### Signed-in web app

First batch (12 items): Publish buttons use the accent ink (black on the
light-theme accent was 4.0:1); a failed status read on Credits says so
instead of "queued"; one Library skeleton instead of three layout jumps;
Retry and Sign in on error states; the chat reply is announced once, not
re-read while it streams; notices moved off raw amber; an empty Library
with Vey and example prompts; a clock and Vey while a job runs.

Then: the four start cards wear a feature hue on the icon (create aqua,
chat sky, film iris, smart cut rose); the "ready" toast prints what the job
cost as a receipt line, from the job API; a finished result prints into
its frame; the press scale is 0.97 everywhere.

### Mobile

First batch (14 items): a guard for off-scale spacing and radii on 35
files, and the values it caught; banners off amber; one press hook that
respects reduced motion; the 20 pt gutter on four tabs; error, retry and
no-results states; a real pull-to-refresh; selection haptics; hue badges on
Home.

## Owner calls

1. **Raw prompts on the landing template wall: done.** The landing wall no
   longer prints a prompt excerpt (it was machine instructions such as "TASK
   Replace the performer…"). The template page still shows the exact prompt.
2. **The same eight templates twice on the home page**: the carousel, then
   the wall. A test requires the carousel there, so it stays.
3. **The fixed contact button on phones** covers a price row and body text
   (`SiteChrome.js`). It is mounted on every page, including signed-in pages
   that have no footer, so hiding it on phones would remove the only support
   link there. Needs a contact entry in the phone menu first, then it can hide.
4. **Dark on the web, light on mobile.** The web says dark is the brand; the
   app starts light on every cold launch and ignores a saved theme
   (`theme.ts`). Deliberate in code, in no ADR.
5. **"Veyrnox" without ".ai"** appears more often than "Veyrnox.ai" in
   copy (public web 64 to 45, mobile 45 to 12). It is the other product's
   name. Needs a naming rule before a find-and-replace.
6. **What a hue means.** Kinds are settled (video iris, image sky, audio
   rose). Start cards use one hue each, so sky is both Chat and images, and
   rose is both Smart Cut or Instruments and audio. Either accept that, or
   make every start aqua and keep hue for kinds only.
7. **Free credits and the showcase.** Every template on the landing wall
   costs 64 to 170 credits against a 10-credit grant, and no home-page price
   is given in money. Ideas from the visitor walkthrough: a slip line that
   shows what the free credit covers, a video chip the grant affords, an
   approximate pack value on the slip. All need new copy in 11 languages.
8. **The commercial-use answer in the FAQ** reads weaker than section 4 of
   the Terms. Legal wording.
9. **"premium" in amber** (`PremiumTag.js`): the file says deliberate; the
   criteria say amber is for amounts.
10. **The landing film's poster frames** are a lone "EDIT" and a lone
    "Generate 17 cr" in a black frame. Needs a new asset.

## Left for a later pass

Public site: /pricing tables as a receipt; page heroes on /pricing, /models
and /tools are one template with an empty right half; pack cards as slips;
tile captions repeat "priced up front"; a "Viral inspiration" pill on every
image; the marketing skeleton does not match the landing hero; footers on
detail pages (a model, a template, a guide).

Signed-in web app: "Try again" on a failed generation (it resubmits a paid
action, so it wants its own change and test); twelve Music dialogs and
thirteen other hand-rolled dialogs have no shared focus trap or entrance;
the top-up receipt is a second, hex-coloured paper; `shadow-2xl` in 48
places; refund amounts in aqua; the Create cost card shows the balance
twice; job status words differ from mobile ("RUNNING / DONE" against
"Creating / Ready").

Mobile: 665 off-scale spacing and radius values in 187 files outside the
guard; legacy weight 800 and one hex literal on `features/*`, `mcp.tsx`,
`editor/new.tsx`; Home "Recent" is text buttons; one icon for several
things on Create, Home and Account; the service banner may sit under the
status bar on the tabs route; the banners need real offline and warning
icons (new assets).

## Proof

Checked in a browser on a local build: home at 1440 px and 375 px, dark and
light for the closing panel; /models, /pricing, the 404 and the signed-out
/app home at 1440 px. Checked on the live site: missing footers, the Arabic
page width, the consent banner's size before and after the layout change.
The right-to-left skip-link fix was proven on a simulated right-to-left
page, because locales are off locally.

Not checked by eye: any signed-in state (balance, Create while generating,
Library, Credits, toasts), the other ten languages, tablet widths, and the
mobile app on a simulator or device. Mobile changes rest on jest, the type
check and code review only.
