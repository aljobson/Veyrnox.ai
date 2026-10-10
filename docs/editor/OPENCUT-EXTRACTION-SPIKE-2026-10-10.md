# OpenCut Classic extraction spike: results (ADR-0080)

**Status:** Done 2026-10-10 · scratch only · **nothing adopted, nothing in this repo changed except these docs**
**Question (from slice 0b):** if we replace OpenCut Classic's WebAssembly time module with our own TypeScript, do its tests still pass,
and does the rest of the app still compile?
**Answer: yes.** The port matched the real WebAssembly on every comparison, the tests behave identically, and the whole app type-checks
exactly as before. The one failure mode I found is that **the real WebAssembly package is the fragile part**, not the replacement.

## What was done

Cloned `opencut-app/opencut-classic` at `cf5e79e` (MIT, archived 2026-05-17) into a scratch folder, installed it with Bun 1.3.14 and ran
it there. Wrote a TypeScript port of its Rust `time` crate (`rust/crates/time`, 855 lines of Rust, about 11 KB of TypeScript), mapped the
`opencut-wasm` import to it with a one-line path alias, and **physically removed the real package from `node_modules`** so nothing could
fall back to it. The port covers the 10 time symbols the editor uses and the 7 related ones; the 10 GPU-compositor symbols are stubs that
throw, because every renderer in the app is the Canvas 2D one.

## Evidence

| Check | Result |
|---|---|
| **Their full test suite, as shipped (real WebAssembly)** | 170 pass, **5 fail, 5 errors** in 31 files. Four files cannot even load: the real package fails to start under this Bun (`__wbindgen_start is not a function`). The fifth is an upstream bug (a test imports `isActionWithOptionalArgs`, which no longer exists) |
| **Same suite, my port, real package removed** | **205 pass**, 5 fail, 1 error in 31 files. The four files that could not load now run (35 more tests) |
| The remaining failures, real WebAssembly versus my port | **The same 4 tests fail in both.** Causes: no browser canvas for text measurement, two mask tests with mismatched values, and a test that passes 2.5 to a helper that requires whole ticks. None involve my port |
| **Port against the real WebAssembly, side by side** | **0 mismatches in about 72,600 random and edge-case calls** across all 20 function groups (seeded, repeatable): seconds and ticks, frame rounding and flooring, frame alignment, last frame, snapped seek, add, sub, min, max, clamp, and timecode format, parse and guess (including odd input such as signs, spaces, unicode digits and out-of-range numbers). Where both sides refuse bad input (for example min greater than max) they refuse in the same cases |
| **Type-check of the whole app (648 files)** | **49 errors with the real package, 49 with my port, the identical 49** (unrelated: missing test-runner types, changelog, storage migrations). Swapping the module adds and removes none |
| Retime tests, `ripple`, `speed`, the scene exporter | Retime's 2 test files pass on the port. Ripple, speed and the exporter have no tests; they compile unchanged against the port. Not executed |

## Findings worth knowing

1. **The real WebAssembly crashes on extreme input and then stays broken.** On a frame rate of 1 frame per 136 years, and on a few odd
   timecode strings, the real code hits a Rust panic; the module then fails every later call until it is reloaded. The TypeScript port
   returns "no answer" in those cases and keeps working. For an editor, that is strictly safer.
2. **Their own tests do not run cleanly with the shipped package** under a current Bun, so adopting the package as-is would have meant
   debugging the loader. The port removes that.
3. **Limits of the port:** exact for whole ticks below 2^53 (about 2.4 million years at 120,000 ticks a second), which is far beyond any
   project; 64-bit overflow cases are not reproduced (the real code traps, mine returns "no answer"). Rates must be whole-tick
   (the same rule as the original: 23.976 and 29.97 work, 7/3 does not).
4. **Code-quality caveat:** a green test suite here means the time maths and the logic with tests behave; there are only 30 test files for
   648 source files. The spike did not exercise the interface, the renderer on real footage, or the exporter.

## What it means for the plan

- **The WebAssembly is not a blocker.** It is a time-arithmetic library plus an optional GPU compositor; the first is replaced by about
  a hundred lines we can own and test against a recorded reference; the second is not used by default.
- **Recommendation stands, with a firmer basis:** adopt a snapshot into a pure `lib/editor/` module (time, timeline model, commands,
  ripple, retime, renderer, exporter) behind our own UI, with the MIT notice kept. Take the **port and its comparison harness** with it,
  so the recorded behaviour is the regression test.
- **Still the owner's decision.** The port is derived from MIT code and is **not committed**. It and the harness are saved outside the
  repo in `~/Documents/GitHub/veyrnox-opencut-spike/` (with the licence text) and can be moved in on a go-ahead.

## Not done

The interface, masks and effects on the Canvas path, the video frame cache on real footage, npm dependency licences, and any security
review of the OpenCut code (nothing from it runs in this repo). The 5 baseline failures were not fixed; they are upstream.
