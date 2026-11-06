# Motion guidelines

Rules for every transition in the web app (`app/`, `components/`) and the mobile
app (`apps/mobile`). They are measurable on purpose: a reviewer checks a number,
not a feeling. Existing tokens: web `--vx-ease-out` in `app/globals.css`, mobile
`ds.motion` in `apps/mobile/src/theme.ts`. If a value here changes, change the
token first, then this file.

Add these lines to the "The goal is met when…" list for any change that moves
something on screen.

## Easing

| Use | Curve |
|---|---|
| Entrances (something appears) | ease-out. Web: `var(--vx-ease-out)`, `cubic-bezier(0.23, 1, 0.32, 1)` |
| Exits (something leaves) | ease-in |
| Movement that stays on screen (reorder, slide, resize) | ease-in-out |
| Everyday UI transitions | No springs and no bounce. Springs are for drag release only |
| Held or handheld gestures (drag, scrub, pinch) | No tween. The element follows the finger 1:1, then settles on release |

## Durations

| Element | Duration |
|---|---|
| Button press | 120 ms (`ds.motion.press`) |
| State change (toggle, colour, icon swap) | 200 ms (`ds.motion.state`) |
| Dropdown, menu, popover | 150 to 250 ms |
| Entrance of a panel or screen section | 280 ms (`ds.motion.enter`) |
| Sheet | 360 ms (`ds.motion.sheet`) |
| Any exit | About 20% shorter than its entrance (a 250 ms entrance exits in 200 ms) |

## Scale and origin

- Buttons scale to **0.97** on press and return on release.
  Today `ds.motion.pressScale` is 0.98: change the token to 0.97 in a
  separate, reviewed PR before relying on this line.
- Popovers, menus and tooltips start at **scale 0.95** and animate to 1.
- Origin is the trigger, not the centre. Enter from the trigger, exit back to the
  trigger. Web: set `transform-origin` from the trigger's position. Do not fade
  into the centre of the screen.
- Modals with no trigger are the one case that may scale from the centre.

## Lists and staggers

- Stagger list rows by **30 ms** each. Cap the total at about 300 ms (stop
  staggering after row 10) so a long list does not feel slow.
- Stagger detail content so it settles after its container: container first,
  then its details, 30 ms apart.
- The new state comes in while the old state leaves, as one crossfade. Never
  leave an empty frame between them.

## Movement and feedback

- Objects that travel across the screen follow an **arc**, not a straight line
  (offset the control point of the path, or animate x and y on different curves).
- Moving knobs (switch thumb, slider handle) stretch by **12%** along the
  direction of travel while they move, then return to 1.
- Confirm success with one **pulse**: a single scale up and back (1 to 1.06 to 1)
  on the element that succeeded. No looping.
- Icon swaps crossfade with scale and blur together (for example scale 0.8 to 1
  and blur 4 px to 0). Never swap instantly or fade alone.
- Reveals and colour changes use **mass**: they ease in and settle, they do not
  snap.

## Drag and shared elements

- Past a drag boundary, the element **rubber-bands**: resistance grows with
  distance, and it returns on release.
- An object that appears in two places (thumbnail to detail, card to sheet) moves
  as **one object** instead of two fading copies.
  - Web: use a library with shared layout IDs and give both places the same ID.
  - Mobile: React Native `Animated` has no shared-layout-ID API, so matching IDs
    alone does nothing. Measure the source bounds, render an overlay copy at those
    bounds, animate it to the target bounds, then swap in the real element and
    remove the overlay.

## Reduced motion

When the system asks for reduced motion (`prefers-reduced-motion: reduce` on web,
the reduce-motion setting on mobile), turn off all nonessential spatial motion:
translation (slides), resizing, shared-element travel, scale, stagger, arcs,
stretch, pulse and rubber-banding. Update immediately, or use a plain opacity
change of 150 ms or less, so state changes are still visible.

## The goal is met when

- Every entrance uses ease-out, every exit ease-in, every on-screen move
  ease-in-out.
- No everyday transition uses a spring or overshoot.
- Each duration is on the table above, and each exit is about 20% shorter than
  its entrance.
- Buttons scale to 0.97 on press; popovers start at 0.95.
- Popovers and menus enter from and exit to their trigger.
- List rows stagger at 30 ms, capped at about 300 ms in total.
- Success shows exactly one pulse.
- With reduced motion on, nothing slides, resizes or travels (no translation,
  resize, shared-element travel, scale, stagger, arc, stretch, pulse or
  rubber-band) and every state change is still visible.
