# ADR-0226: Mobile Oddlings: the moving preview on a character sheet

**Status:** Proposed 2026-10-20. Closes the "animated puppet previews" item that ADR-0158 left out.

## Context

The web gallery moves each of the 72 cast portraits: a small WebGL shader warps the 1024 by 1536 portrait (blink, breath,
nod, arm swing, weight shift) from hand-calibrated rigs (`oddlingPuppetRenderer.js`, `oddlingPuppetRigs.js`). It runs on
the visitor's device, makes no sound, calls no model and costs nothing. The phone showed a still picture and a line
saying previews were free on the web.

## Decision

- **Same renderer, not a rewrite.** `apps/mobile/scripts/sync-oddlings-puppet.mjs` wraps the web's renderer, rigs and
  feature rigs into `src/lib/oddlings/puppetScript.ts`, the way ADR-0158 does for the builder figure. A jest test runs
  it with `--check` and fails on drift.
- **A WebView runs it.** React Native has no WebGL, and no GL library may be added, so the sheet embeds a WebView
  (already a dependency, ADR-0158 slice 2). The page loads no network content: its content policy is
  `default-src 'none'; img-src data:`, navigation is refused, and the app hands it the portrait as a `data:` address.
- **The portrait comes from the cache.** It is downloaded once from the public site into the app cache, must be a WebP
  of at most 5 MB (checked by its header bytes) and is read from there afterwards. Only the 72 cast ids are accepted.
- **The still picture stays underneath.** The moving layer fades in on the first drawn frame. If WebGL is missing or a
  context is lost, the page says `failed` and the sheet keeps the still picture and says so.
- **Motion rules.** With "reduce motion" on, nothing downloads or moves until the person presses **Play preview**. Otherwise
  it plays by itself, with a **Pause preview** button always present. It pauses when the app goes to the background and
  when another screen covers the sheet. There is no audio track at all.
- **No server change, no flag, no credits.**

## What differs from the web

- The web preview also appears on gallery cards; the phone shows it on the character sheet only, so one WebView runs at
  a time (a scrolling list of 72 WebGL contexts would not be safe on a phone).
- The web pauses by scrolling out of view and by a hidden tab; the phone pauses by app state and screen focus.
- The web draws straight on a canvas in the page; the phone draws in a WebView that sits over the portrait.

## Not proved

`tsc` and Jest only (owner disk rule). The shader and the WebView were not run on a phone or a simulator, so frame rate,
memory on small phones and WebGL availability on every Android WebView are untested.
