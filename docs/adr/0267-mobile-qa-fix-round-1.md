# ADR-0267: Mobile QA fix round 1

Status: Implemented; independently reviewed; rechecked on the iOS simulator.

Date: 2026-10-27

## Scope and evidence

Addresses the mobile QA findings against `ceee7ad21` (phase 2c, PR #1688),
including the subsequent host inspection corrections.
The source findings were rechecked against this base, including Part A and
Part B QA-004/005/007/010–014 of the 2026-10-27 QA report. This is source and
automated-test evidence, not a new simulator or VoiceOver pass.

Before choosing this number, the GitHub connector read `main`'s `docs/adr`
directory (highest number 0266) and the open pull-request collection (empty).
The local `origin/main` ADR inventory also ends at 0266.

## Decisions and finding disposition

| Finding | Change / current disposition |
| --- | --- |
| F-A11Y-1, F-A11Y-2, QA-013 | All `ui/Text` roles default to a 1.5 system multiplier cap and respect explicit caller caps; TextField uses 1.5. Fixed-height chrome (tab labels, HeaderChips, HeaderAction and drawer headings) retains a separate 1.3 cap. Navigation titles use the same heading role/cap. Equal caps preserve the display/title/body hierarchy at every in-app size. The brand wordmark remains a fixed-size brand image. |
| Create AX5 wrapping | Tile column count accounts for width, system scale and the in-app text ramp. A narrow phone uses one column when two cannot fit a complete label word plus icons. Section metadata wraps instead of clipping; goal, price and model rows also reflow at large sizes. |
| Mounted Library text sizing | `useThemedStyles` subscribes to window dimensions/font scale, invalidating mounted screen/list renders. Native Text owns system scaling; cached ramp values deliberately do not multiply it a second time. The older pre-phase-2b Library did not use this common primitive path. |
| F-CRE-1 | Model, brief/narration, persona and chat use `KeyboardScreen`, which measures the real screen origin rather than guessing an 88/90pt header offset. Form scroll views additionally reveal the focused native field after keyboard/layout changes and subsequent field focus. |
| F-CRE-2 | Each listed ScrollView/FlatList, including Home's nested filter rows, both composer option rows, attachments and folders, preserves handled taps. A TypeScript-AST guard checks each opening element and the shared form scroll container independently. |
| Onboarding navigation header | Welcome, Start and Vibe explicitly hide their headers in the parent stack as well as their screen options, preventing raw route titles or a back button above the cards. |
| F-ONB-1 | Vibe's screen reserves the actual top/bottom safe area, including the language step. The old fixed question padding is removed. |
| F-NET-1 | The offline banner adds top safe-area padding on the outer headerless tabs route, while stack screens retain their existing header offset. |
| F-NET-2 | Shared API transport reports response/failure outcomes, and the existing service-status response clears stale offline state. A single AppLayout recovery lifecycle probes only while offline and foregrounded: 5s, 15s, then 30s. Foregrounding while offline probes immediately; online/background/unmount cancel the recovery timer. Paid actions remain unqueued. Existing service-health polling retains its separate purpose. |
| QA-004 | Message text alone is an accessible element; DraftCards are sibling descendants of the ungrouped bubble, preserving their independent actions. |
| QA-005 | Consent checkbox, Terms and Privacy remain three independent accessibility controls. The sentence toggles consent for sighted users through a separate 44pt target hidden from VoiceOver. Legal reading still uses ADR-0266's native sheet and cannot toggle the checkbox. |
| QA-007 | A shared iOS announcement hook seeds its previous value from the initial rendered status, remaining silent on mount (including editor Saved), then announces only meaningful changes. `ui/Text` live regions use it; alerts retain native announcement semantics. Explicit hooks cover native editor status, export progress and Face Filters upload/submission errors. Create price, validation/shortfall, job state and Credits outcomes announce through the primitive. Timer ticks/revisions do not produce repeated status announcements. |
| QA-010 | Full Editor command, transport, timeline clips/markers and compact controls have at least 44pt targets. The compact override no longer defeats the shared minimum. Its session hook and stylesheet are separate modules to keep every file below 500 lines. |
| F-A11Y-3, QA-011 | WhenPicker chips use the 44pt Chip primitive. Film Remove and Publish Cancel use Button. Shared text-action targets include a 44pt minimum width. Duration/image-count chips, chat-folder actions and carousel schedule actions already had 44pt targets after phase 2b; those findings no longer reproduce in source. |
| F-A11Y-4, QA-014 | Disabled primary buttons use surface fill and tertiary ink, including rich child labels. Secondary/tertiary controls retain their existing disabled treatment. Strong input boundaries are at least 3:1 against background, elevated, surface and pressed-surface colors in light/dark/OLED. TextField and remaining input-specific styles use borderStrong. |
| QA-012 | Existing migrated screens already use the selected type ramp. This round fixes system-size subscription/caps; restyling remaining legacy screens is outside this round. |
| Owner onboarding copy | Welcome introduces Vey as the guide character without promising help on every screen. The last card introduces the actual material picker. Only app-only English keys change; the registry is regenerated. |
| F-ONB-3 / footer | All welcome cards retain the same primary, Back and Skip slots. Back is disabled on the first card; Skip appears on every card on both first run and replay. Credits gets a coins icon in a 72pt surface circle. |
| Start picker selection | ChoiceCard reserves the same inset border width in both states; selected tiles do not grow. |
| Owner “Just an idea” | Opens Home with a consumed focus parameter, scrolls to the idea card and focuses its TextField. Photo/video/reference targets remain unchanged. |
| F-ONB-2 | Start has “Skip for now” through the app-only `start.skip` English key; it records welcome seen/onboarding complete and opens Home. |
| F-ONB-4 | Language, goal, look, pace, chaos, destination and audience choices advance on one tap. The voice question includes text input and keeps an explicit completion button. A language-unavailable explanation still requires acknowledgment. Skip stays in the bottom footer position. |
| F-CHAT-1 | The message list starts following when sending begins or the message count grows. While following, streaming content-size changes scroll to the end. Dragging dismisses the keyboard and stops following; reply completion or a reduced message count does not resume it. |
| F-CHAT-2 | Failed workspace loading uses failure/retry copy instead of “being prepared.” |
| F-CRE-3 | Rating requires a loaded image/player result, then waits for celebration completion and a further result-viewing delay. Blur/unmount cancels it. The rating route has the localized sentence title. Phase 2a already introduced celebration coordination; its immediate post-celebration continuation still needed repair. |
| F-CRE-5 | Create, drawer, Tools and in-app search share one cached availability snapshot, computed from the same supported Face Filters rows as the feature screen. Concurrent reads share a pending request; refocus and transient failures retain the last known value until a catalog response updates it. Cached Tools groups and the `/face-filters` search entry are filtered too. The current start picker has no direct Face Filters entry; its photo/reference destination is the now-gated Tools screen. No unavailable fourth entry remained to remove. |
| F-NAV-1 | Menu state closes on pathname change, including deep-link route changes. |
| F-AUTH-2 | Account and MFA escape sign-out actions confirm before invoking their existing handlers. Cancel leaves the session untouched. |
| F-AUTH-1 | Development Turnstile whitelists only the configured HTTP loopback origin. The navigation guard still excludes other HTTP hosts/ports and every HTTP origin in production. HTTPS/base-page and Cloudflare behavior remains; the no-web-breakout guard is retained. |
| Phase 2c follow-ups | MFA Verify is primary; setup/confirm/unlock/password update/passkey add are at least secondary. Editor workspace buttons constrain their container width. Publish restores the uppercase brand initial. Account danger/sign-out rows align left and avoid duplicate child labels. |
| F-CRE-8, F-CRE-9 mock gaps | New dev helper supplies a real PCM WAV, audio MIME/asset selection and provenance. Audio provenance includes the digest of the actual fixture. Pending/missing records are represented explicitly. The oversized mock server changes only import/dispatch/asset wiring. |

## Findings already corrected and limits

The model, agent, persona, chat list and outer Explore scroll views already had
`keyboardShouldPersistTaps="handled"`; nested scroll responders did not. The
consent checkbox already had a 44pt row but its nested links were inaccessible.
Duration and image-count Chip hit areas, folder Button hit areas, and schedule
carousel actions already met the shared target minimum. The rating screen already
hid its header; an explicit title also prevents route-name fallback.

Full Editor currently has server-save/offline/error states but no local-draft copy
state. The alternate editor route owns local-copy failure and rejected states;
its announcement hook covers those existing states without inventing persistence.
Existing alert messages in Full Editor continue to announce errors. No native
module, dependency, app configuration, website, `_order.ts`, billing,
generation, consent requirement or MFA rule changes are made.

Library thumbnails, native date picker, Film model picker, deletion availability,
template-count copy and remaining design-system migrations stay outside this round.

## Verification and handoff

Regression coverage includes role caps, rendered AX5 Create tile layout, individual
scroll responders, API offline/recovery/backoff/foreground/online behavior, status
deduplication, independent consent/message actions, result-ready rating timing,
Turnstile development boundaries, input/disabled contrast and mock audio/provenance.
The existing suite continues to cover purchases, generation, consent, authentication,
MFA, native editor persistence and the external-browser guard.

The proof command is:

```sh
cd apps/mobile && npx tsc --noEmit && npx jest --ci && node scripts/gen-en-registry.mjs --check && node scripts/sync-web-legal.mjs --check
```

Host iOS checks remain necessary for keyboard geometry, VoiceOver focus and
announcements, largest text size, safe-area appearance and onboarding navigation.

Final automated proof after host corrections: exit 0; TypeScript passed;
234/234 Jest suites and 4,191/4,191 tests passed; English registry current; legal
bundle current (566,505 bytes across 11 locales). Existing duplicate-number
warnings for ADR prefixes 0241, 0261 and 0264 are non-failing.
