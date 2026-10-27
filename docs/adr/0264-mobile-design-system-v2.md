# ADR-0264: Mobile design system v2, phase 1

Date: 2026-10-27
Status: Implemented; checked on the iOS simulator. Android and the full-screen confetti are not yet checked on a device.

## Decision and scope

Use semantic tokens and the typed primitives in `apps/mobile/src/components/ui` for the first-impression screens and Appearance. Preserve all existing `Palette`, `space`, `radius`, `type`, `fonts`, and theme helper exports for unmigrated screens. No dependency, plugin, native configuration, or web changes are included.

## Palette

| Token | Dark | Light |
| --- | --- | --- |
| bg | #0a0a0b | #ffffff |
| bgElevated1 | #141416 | #f6f6f7 |
| bgElevated2 | #1c1c1f | #ffffff |
| surface | #202024 | #f0f0f2 |
| surfacePressed | #2a2a2f | #e6e6ea |
| borderSubtle | #26262a | #e4e4e7 |
| borderStrong | #3e3e44 | #a8a8b0 |
| textPrimary | #f2f2f3 | #0a0a0b |
| textSecondary | #a1a1aa | #52525b |
| textTertiary | #8b8b94 | #6b6b73 |
| success | #4ade80 | #15803d |
| warning / money | #e4a93c | #8a5a00 |
| danger | #ff5c47 | #c4241a |
| scrim | rgba(0,0,0,0.56) | rgba(10,10,11,0.40) |
| onMedia | #ffffff | #ffffff |
| mediaShade | rgba(0,0,0,0.72) | rgba(0,0,0,0.72) |

OLED uses dark chrome and overrides bg to #000000, bgElevated1 to #0e0e10, bgElevated2 to #17171a, surface to #1c1c1f and borderSubtle to #222226. Legacy `surface` maps to bgElevated1; legacy background/border/text/body/muted map to bg/borderSubtle/textPrimary/textSecondary/textTertiary. Legacy accentInk/accentSoft/money map to onAccent/accentSubtle/warning. Studio keeps the dark palette and the selected accent.

## Accents and contrast

Pressed steps multiply each sRGB channel by 0.8 and round to the nearest integer. They are fixed tokens, not a runtime opacity overlay. Subtle accent uses alpha 0.14 in dark/OLED and 0.10 in light. Contrast below uses WCAG relative luminance; each normal onAccent/accent pair exceeds 4.5 and each accent/bg pair exceeds 3.

| Accent | Scheme | Accent | On accent | Pressed | Ink contrast | Background contrast |
| --- | --- | --- | --- | --- | ---: | ---: |
| mint | dark | `#3ee6c4` | `#06231f` | `#32b89d` | 10.51 | 12.55 |
| mint | light | `#0b7a66` | `#ffffff` | `#096252` | 5.26 | 5.26 |
| iris | dark | `#a99cff` | `#140b3d` | `#877dcc` | 7.76 | 8.37 |
| iris | light | `#5a46d6` | `#ffffff` | `#4838ab` | 6.40 | 6.40 |
| sky | dark | `#6cb4ff` | `#03203f` | `#5690cc` | 7.49 | 9.06 |
| sky | light | `#1d5fc9` | `#ffffff` | `#174ca1` | 5.94 | 5.94 |
| rose | dark | `#ff86b8` | `#3a0619` | `#cc6b93` | 7.67 | 8.82 |
| rose | light | `#b8235f` | `#ffffff` | `#931c4c` | 6.10 | 6.10 |
| mono | dark | `#f2f2f3` | `#0a0a0b` | `#c2c2c2` | 17.69 | 17.69 |
| mono | light | `#0a0a0b` | `#ffffff` | `#080809` | 19.79 | 19.79 |

Secondary text on background: dark 7.72:1, light 7.73:1. Brand Google colours remain named tokens in theme.ts; its multicolour mark is never tinted. Apple uses the native branded button where available, BLACK in light and WHITE in dark/OLED, with the OAuth wordmark fallback elsewhere.

## Typography, layout and motion

| Step | Size / line | Tracking | Face / weight |
| --- | --- | --- | --- |
| display | 34 / 40 | -0.6 | Display bold |
| title1 | 28 / 34 | -0.4 | Display bold |
| title2 | 22 / 28 | -0.2 | Display semibold intent |
| title3 | 18 / 24 | -0.1 | Text 600 |
| body | 16 / 22 | 0 | Text 400 |
| bodyStrong | 16 / 22 | 0 | Text 600 |
| callout | 15 / 20 | 0 | Text 400 |
| footnote | 13 / 18 | 0 | Text 400 |
| caption | 12 / 16 | 0.1 | Text 500 |
| micro | 11 / 14 | 0.2 | Text 600 |

Text size multiplies sizes and line heights by S=0.9, M=1, L=1.12, XL=1.25; OS scaling stays enabled, capped at 1.5 for headings. Studio uses Archivo display plus system body. Editorial uses Instrument Serif 400 plus Inter 400/500/600. Technical uses Space Grotesk 500/700 plus Inter. Root startup requests only the chosen family plus Archivo for the wordmark; Appearance loads the other samples on demand. Text falls back to system until its family appears in the loaded-font context, including after a failed load. A font context invalidates mounted text after loading, without importing the font loader into every primitive.

Font-weight clarification: the supplied Editorial font has only weight 400; its display text therefore uses 400. Technical title2 uses the explicitly supplied 500 rather than synthesizing an unavailable 600; Studio loads the existing Archivo 600 asset for title2. These are explicit deviations from the generic title2 semibold description. No v2 component uses weight 800/900; Archivo 800 remains available to the existing wordmark.

`ds.space` is 2/4/8/12/16/20/24/32/40/56, gutter 20; radii are 6/10/14/20/28/999. Elevation is light-only: e1 `0 1px 2px rgba(0,0,0,.06)` and e2 `0 4px 12px rgba(0,0,0,.08), 0 1px 3px rgba(0,0,0,.06)`. Dark and OLED have no shadow. Motion durations are 120/200/280/360ms, with a 0.98 spring press scale. Reduced motion disables press scaling and confetti and keeps Vey in a still cheer pose. Buttons have 52/44/32 point minimum heights; the small visual button adds hit slop to reach 44 points.

## Appearance persistence and transitions

SecureStore keys are `veyrnox.theme`, `.accent`, `.typeface`, `.textSize`, with synchronous parsing and safe defaults. Apply is the shared mutation entry point. Accent, typeface, text size and entering/leaving OLED reload on every platform because module-captured legacy values cannot be replaced in place. Android reloads on any changed setting; no-op settings never reload. iOS light/dark/system changes update native Appearance, legacy DynamicColorIOS values, and v2 cached light/dark StyleSheets via useColorScheme. Module-scope style factories build a sheet lazily for each scheme/accent/typeface/text-size key and reuse it thereafter, including pending previews. This replaces the eager 180-sheet expansion per factory at startup. The pending Appearance context previews settings before Apply. The existing `veyrnox.theme.return` slot restores the route after reload.

The installed RN 0.88 API accepts `unspecified` rather than null to restore system appearance. This implementation follows the installed API. Legacy spacing and typography exports remain byte-for-byte unchanged.

Flow clarification: Start originally has no Skip action or destination, so its existing Library exit remains tertiary. Vibe retains the original automatic advance on its choice-only steps; pinned primary CTAs remain on steps that already require explicit continuation. Adding a new Skip destination or making auto-advance wait for a CTA would violate the frozen instruction to preserve handlers and navigation. These are explicit deviations from applying the generic footer wording to every step.

## Consent and completion celebrations

On sign-in, both native and fallback provider callbacks check consent and busy state. The screen handlers also check a synchronous running ref so two taps before a React render cannot start two requests. The blocked native button is wrapped in a disabled accessible button and hidden from its parent's accessibility subtree.

Email retains its original gating: busy state for providers, captcha plus busy state for email submission. It has no consent checkbox or consent condition. Sign-in retains consent gating at both the provider-button callback and screen handler.

Large celebrations require a new completion observed unfinished by this phone or a local submission ID. Three generation POST sites record submission IDs, local expiry at now + 24 hours, and a last-50 bound in SecureStore. The owner marker exists solely to distinguish a normal restart from account change. Sign-out/account change clears submission evidence; milestone flags contain only per-phone booleans. Server creation timestamps do not establish eligibility.

Home verifies asset access; the result screen sets the accessible output before dispatching. Shared job deduplication covers both paths. The host acknowledges the native Modal onShow event before milestone flags are persisted, resolves completion on dismissal/timeout, and clears queued events on navigation/account change/unmount. First creation and first video are one-time milestones; onboarding shares the first-creation claim. If the first creation is also video, that single celebration consumes both milestones. Later completions retain the small cheer.

Rating eligibility functions remain unchanged. An eligible result waits for celebration completion, or the existing 2000ms delay for a small result. The job poll remains in the original useEffect keyed by api, id and attempt, with abort on unmount. Focus cleanup cancels only the rating continuation, without restarting polling or resetting unfinished evidence on refocus. claimReviewAsk runs inside the completion callback immediately before navigation; leaving before the celebration ends does not consume the ask.

## Migration and verification

New or touched screens use `src/components/ui` and tokens; no hex literals outside theme.ts. Out-of-scope screens are unchanged in this phase and pick up the chosen accent through the legacy mapping. The guard test checks every phase-1 file for literal colours, numeric font sizes, pictographs and uppercase transforms; the Link guard audits every TSX file in src for styles that `Link asChild` would drop. Pure tests cover defaults, OLED, legacy mapping, contrast, font scaling, transition reloads, local expiry, milestone deduplication and rating cancellation. Interaction tests bypass disabled visuals to exercise the actual Apple callbacks and screen handlers. A regression test covers the pending Appearance preview in both directions (light applied with a dark draft, and dark applied with a light draft).

Proof: `cd apps/mobile && npx tsc --noEmit && npx jest --ci && node scripts/gen-en-registry.mjs --check` passes (217 suites, 3,927 tests). On the iOS simulator, against the local mock server: sign-in, Home, the tab bar and header, Appearance (Apply to OLED + Iris and back, with the preview confined to the preview card), and the first-video celebration (scrim, Vey cheer then clap, confetti, success text).

Not yet verified: Android; the full-screen 2.6 s confetti on a device (both milestones had already fired on the test simulator); release-build tap latency.

Phase 2 migrates the remaining screens (publish, create, editor, chat, cinema and the rest) onto the same primitives.
