# Design goal criteria

End every UI prompt, plan or PR description with "The goal is met when…" and
paste the lines below that apply. A vague goal ("make it clean") lets the
agent guess; a measurable goal lets it check its own work before it says it is
finished. Every value here is read from the repo, so a check is a lookup, not a
taste call. If a value changes, change it in the token file first, then here.

Sources: `apps/mobile/src/theme.ts`, ADR-0264 (mobile design system v2),
`app/globals.css` (web tokens), `.21st/DESIGN.md`.

## How to use it

1. Name the screens or components the change touches.
2. Copy the matching "The goal is met when" lines from Layout, Visual
   and Accessibility, plus every state in the States table the screen can reach.
3. Add one screen-specific line (for example "the price shown equals
   `model_catalog.credits_5s`").
4. Do not call the work done until each line is checked, and say which lines
   you could not check (for example "Android not run").

## Layout and spacing

The goal is met when:

- No piece of information appears twice on one screen (a balance, a price, a
  title or a status is shown in one place).
- Mobile: every gap, padding and margin is a `ds.space` step
  (2/4/8/12/16/20/24/32/40/56), and the screen gutter is 20.
- Web: every gap is on the Tailwind 4 px scale, with no arbitrary `[13px]` values.
- Mobile radii come from the set 6/10/14/20/28/999 and web radii from
  `rounded-xl` (16), `rounded-2xl` (24) and `rounded-3xl` (32). An inner piece
  has a smaller radius than the card around it, never the same or larger.
- Light-mode shadows use `e1` or `e2` only. Dark and OLED mode have no shadow,
  so depth comes from `bgElevated1`, `bgElevated2` and `surface`.
- Rhythm is intentional: not every section has the same padding, and the page
  has one clear primary action (`.claude/rules/ecc/web/design-quality.md`).

## Colour, type and brand

The goal is met when:

- Mobile: no hex or `rgb()` literal outside `theme.ts`; every colour is a
  semantic token (`bg`, `surface`, `textPrimary`, `accent`, `danger`…).
- Web: every colour is a `vx` token class (`bg-vx-base`, `text-vx-fg`,
  `text-vx-accent`…), and both themes are checked.
- Amber (`money` / `warning`) appears only on money and credit amounts. Aqua
  (`accent`) marks actions. `danger` marks errors and destructive actions only.
- Text on its background is at least 4.5:1 (3:1 for large text and for icons
  and borders that carry meaning), in light, dark and OLED, and for each of
  the five mobile accents.
- Fonts: web uses Inter (body), Archivo (display) and JetBrains Mono (small
  labels) and nothing else. Mobile uses only the selected Typeface pair
  (studio, editorial or technical). Mobile text uses a `type` step, with no
  numeric `fontSize` on the screen.
- No weight 800 or 900 in new mobile code (ADR-0264).
- No model or provider is shown failing in marketing visuals; say the refund
  promise in words.
- Nothing on a customer-facing surface uses wallet or on-chain wording
  (`scripts/check-hard-wall.sh`).

## Ease of use and accessibility

The goal is met when:

- Every tappable control is at least 44 pt (mobile) or 44 CSS px (web touch).
  A visually small mobile button gets `hitSlop` to reach 44. Primary buttons
  are 52.
- At the largest in-app text size (XL, ×1.25) and at OS scaling 1.5 nothing is
  clipped, overlapped or pushed off-screen, and the primary button is still
  visible without horizontal scroll.
- Every control has an accessible name, and every status change (loading
  finished, error shown, saved) is announced, not only coloured.
- Every focusable web element shows a visible focus ring and can be reached
  and used from the keyboard.
- With reduced motion on, press scaling, confetti and looping animation are
  off and the screen still makes sense.
- Layout holds at 375 px wide and at 1280 px wide with no horizontal page
  scroll.

## States

Every screen that loads, submits or lists something handles each row it can
reach. "Done when" is the check; the last column is what the repo already has,
so reuse it before building another.

| State | Done when | Existing piece to reuse |
| --- | --- | --- |
| Empty | Before any data, the screen says what belongs here and offers one action that fills it. It is not a blank list. | Projects empty state (`.21st/DESIGN.md`) |
| Loading | A placeholder with the final layout shows within 100 ms, so the page does not jump when data arrives. | `app/veyrnox/loading.js` |
| Error | The message says what failed and what to do next, has a retry, and shows no stack trace, DB message or vendor payload. Error codes stay `kebab_case`. | |
| No internet | The screen shows an offline notice and keeps already-loaded content readable. Actions that need the network say so instead of failing silently. | `OfflineBanner.tsx` |
| Slow network | After about 3 s a progress cue shows what is happening (step, count or percent), not only a spinner. Long jobs show the job state. | `JobWatcher.js`, job polling |
| Service outage | One banner, driven by `/api/status`, on web and in the app. | `ServiceStatusBanner.js`, `ServiceBanner.tsx` |
| No search results | The query is echoed back, with a clear-filters action and two or more suggestions. It is not a dead end. | |
| Permission denied | It says why (not signed in, not an administrator, plan, MFA needed) and gives one way back or forward. A 403 is not shown as one generic message. | |
| Session expired | The user's unsent input is kept, the screen asks them to sign in again, and returns them to the same place afterwards. | `/api/auth/session`, `veyrnox.theme.return` pattern |
| Form validation | Each error is shown next to its field as soon as the field is left, in words, with `danger` colour plus text. The submit button is never the only place an error appears. | |
| Success | It confirms what happened (and the Credits spent, if any), then shows the next step. Celebrations are one-time milestones, not on every result (ADR-0264). | Mobile completion celebration |

Blank cells are states with no shared component yet; check each screen by hand.

## Money screens

The goal is met when:

- Every price and balance is read from the catalog or the API. No price is
  computed in the app layer.
- Before a Credit spend, the user sees the exact cost; after it, the new
  balance. A failed submit shows that the Credits were returned.
- A paid action cannot be double-submitted: the button is disabled while the
  request runs and the request carries an idempotency key.

## Proof to report

When you finish, list for each line one of: checked (how), not applicable, or
not checked (why). Typical proof: the iOS simulator at the largest text size,
the Browser pane at 375 px and 1280 px in both themes, `npx tsc --noEmit`,
`npm test`, and the mobile guard tests under `apps/mobile/__tests__`.
