# Mobile parity execution plan (2026-11-21)

## Goal

Bring the iOS app to functional parity with the user-facing production web product, while expressing each workflow as a native phone experience rather than copying desktop layouts. Finish with a production iOS EAS build from the final integrated `main` revision.

Parity means a signed-in customer can discover and complete the same production-supported outcome on iOS. It does not include internal admin pages, routes disabled on both products, retired products, or provider names used only for competitive research. OAuth, Turnstile, App Store subscription management, mail, authenticator hand-offs, and policy-required YouTube playback remain system or embedded-provider flows rather than being reimplemented.

## Observable acceptance criteria

1. Every production-visible web destination from `AUTO_PRODUCT_INVENTORY` (filtered to signed-in customer surfaces) and `STUDIO_DESTINATIONS` is represented in one typed mobile feature registry as native, system hand-off, intentionally unavailable, build-time gated, or gated by a named live capability. The registry drives the mobile feature directory and global search, and parity tests fail when either web source adds a customer feature with no mobile disposition or recorded exclusion.
2. No shipped native feature is orphaned. Beats, Film Studio when enabled, Smart Cut, Best Cut, Professional Editor, Projects, Music, Dialogue, Speech, Oddlings, Cinema, Chat, and all supported Publish tools have visible, task-appropriate entry points.
3. The five-tab information architecture is Explore, Create, Studio, Library, Publish. The route remains `/editor` for deep-link compatibility; only its visible label becomes Studio. Studio is always present and exposes Projects, Smart Cut/Best Cut, Beats, and build-time-gated Film Studio. The Projects card always opens `/projects`; only Professional Editor, new-project actions, and rows that open `/editor/[projectId]` follow `EDITOR_ENABLED`. Global search is reachable from the root header.
4. Simple-mode Music creation exposes every result-affecting control advertised by the live capability response: variety, style influence, excluded styles, tempo, key, and time signature. Values are bound into the quote and attempt snapshot. Custom mode never shows or sends them. Production migration 0514 is recorded as applied; every control follows its existing live `controls.*` capability rather than a new client-only switch.
5. Dialogue uses the native ordered-turn studio after PR #2598 lands. Speech/TTS retains Audition Board and adds the supported web outcomes still absent on mobile: reusable voice recipes/palettes, a persistent audio shelf, and “use as lip-sync source.”
6. Publish exposes every supported customer tool from a native directory and shows plan status, renewal/end date, and safe period-end cancellation for Stripe-sourced plans. Store plans remain OS-managed; Cinema Pass remains read-only per ADR-0207 unless that ADR is explicitly amended. Email authentication gains the production-compatible passwordless path only after the live Supabase email template is verified: add native six-digit OTP only when the template includes a token, otherwise implement the universal-link/PKCE return or separately approve and regression-test a template change.
7. Onboarding and every paywall entry form one coherent, polished native journey. First run stays brief, optional and goal-led; preserves skip, back and interrupted-session recovery; and leads into a useful first creation rather than an unexplained purchase wall. The RevenueCat paywall, contextual pack/plan sheet and Credits screen share one semantic colour and typography system, a clear value and plan hierarchy, localized total price/duration/renewal terms, visible restore/manage/legal paths, and honest loading/unavailable/cancelled/pending/error/success states. Purchases still use the system confirmation sheet and existing account, sales-open, idempotency and webhook-reconciliation boundaries.
8. Wave 3 closes both editing surfaces. The native Professional Editor reaches the current web editor contract through reviewed slices S7–S14: motion/masks/Smart Picture; fonts and asset packs; on-device media foundation; scenes/Clip Finder; native preview/export; motion processing; translation/automatic captions; person tools. Music Beats Editing reaches production-capability-enabled arrangement, piano-roll/instrument, mixer/effects/automation, recording/takes, mixdown/export, Beat AI, Sounds/Labs/template, cloud/version-recovery, and collaboration outcomes through native phone interaction patterns. Magic Bar and every other runtime-disabled row remain explicitly gated with no native build work until the matching live capability turns on. Existing editor S2–S6 and Beats N1–N9 behavior do not regress.
9. Template flows accept every source-media contract supported on production web, or the template is hidden consistently on both products with a recorded product reason. Audio playback supports seek and supported hand-offs into lip sync/performance workflows. Both editors remain usable with touch, hardware keyboard where applicable, VoiceOver, Dynamic Type, Reduce Motion, safe areas, and landscape orientation.
10. Onboarding, paywalls, Beats, Smart Cut, Cinema, Music, editor, Publish, reports, authentication, and purchase-adjacent flows pass deterministic tests and device walkthroughs. Accessibility checks cover VoiceOver labels/order, 44 pt targets, XXL Dynamic Type, Reduce Motion, increased contrast, colour-independent state, safe areas, keyboard avoidance, and landscape editor gestures.
11. The final production iOS fingerprint is recorded, the final `main` revision passes the full mobile gate, and a new production EAS iOS build completes. App Store submission is separate unless explicitly authorized.

## Evidence and corrected assumptions

- The app already contains roughly 163 Expo routes. The dominant current failure is discoverability and duplicated registries, not an empty mobile product.
- Beats N1–N9 landed across PRs #2467, #2526, #2540, #2534, #2548, #2547, #2569, #2561 and #2563. PR #2597 adds the missing Music entry. Do not revive `claude/suno-apk-download-1b2fbf`; its useful web Beat-v5 work landed in #2469 and #2512.
- Music P0–P4 landed across #2406, #2416, #2423, #2441, #2447, #2451, #2461, #2539, #2579, #2582, #2514, #2537 and #2542. `docs/product/suno-music-parity-spec.md` is historical and understates current mobile coverage. Veyrnox uses ACE-Step; there is no Suno provider integration to wire.
- Production migration 0514 was verified read-only on 2026-11-21 at 17:58:08Z using `scripts/check-migration-ledger.mjs` against the top-level production Supabase configuration in `wrangler.jsonc` (`veyrnox-ai`). The public `applied_migration_names` RPC returned 518 names and exactly `0514_music_tempo_key_meter` for the 0514 match. No service-role credential or remote mutation was used.
- ByeCut session `claude/byecut-apk-backup-rea-538c7f` became #2454, one shared analysis slice. Full Smart Cut is present through #1938, #1953, #2263, #2464–#2468, #2545, #2556, #2577 and #2585. Current entry points are the drawer, Studio/Editor home, Library, and the editor AI sheet. Do not cherry-pick superseded Smart Cut branches.
- Native editor S1–S6 landed. `claude/codex-editor-s7` contains useful unmerged motion/mask work but also older S5/S6 history, so port it by feature into a clean branch rather than cherry-picking it wholesale.
- Photo Studio, Live Edit, Face Filters and Video Enhance were intentionally removed from web and mobile in #2550; stage3c is not parity work.
- Film Studio is disabled by matching hard-coded build-time switches in `apps/mobile/src/lib/filmStudioSwitch.ts` and `app/veyrnox/_lib/filmStudioSwitch.js`, not by a live capability. Preserve its routes and registry entry, but do not present it while the product decision is off. Studio card, search entry, and `isFilmStudioLink` must follow the same mobile switch.
- The iOS build-64 fingerprint and the navigation-only PR #2597 fingerprint are both `bcb20f35458a25ea31782af54d2f656b77a23652`, so #2597 is OTA-compatible.

## Decisions

1. Source and live capability responses override stale audit prose.
2. Keep five tabs. Relabel Editor as Studio without renaming its `editor` route or breaking `/editor` deep links, and use native directories/search instead of making the web-style hamburger drawer the parity backbone. Keep the drawer during migration so deep navigation does not regress.
3. Build small, independently reviewable PRs. Merge only green PRs with squash. Rebase/port abandoned work by feature, never by blind branch resurrection.
4. Use shared server/pure libraries where the repo already does so. Do not duplicate validators or price logic in the app.
5. Every paid or purchase-adjacent operation quotes first, uses idempotency, and preserves the current refund/recovery contract.
6. Native editor work must preserve the 32,768-byte document cap, validate before save, and compare native evaluation/rendering against web-produced fixtures.

## Execution waves

### Wave 0: integrate work already in flight

- Merge PR #2597 after all required checks pass.
- Allow PR #2598 (native Dialogue studio) to finish in its owning session; integrate it before changing Audio routing.
- Update the stale Suno and parity documents after source integration so future audits do not reopen completed work.

### Wave 1: one registry and native information architecture

- Add a typed feature registry containing route, label key, icon, category, search terms, availability/capability, platform disposition, and parity owner.
- Compare the registry against `lib/generatedProductInventory.js` `AUTO_PRODUCT_INVENTORY` and the declared rows in `app/veyrnox/_lib/studioNavigation.js` `STUDIO_DESTINATIONS`, with explicit exclusions for admin, retired, and disabled-on-both features. Match web navigation by exact web href through an explicit web-to-mobile route/disposition map, not by `key`: duplicate-key Audio rows and unkeyed MCP/Templates/Models/Guides rows must each have a disposition. Check Film Studio directly against its build-time switch because the exported web array filters it out while disabled.
- Retire drift deliberately: derive or replace `siteSearch.ts` `SCREENS`, `menu.ts` `MENU_SECTIONS`/`MENU_FOOTER`, `audioHub.ts` `AUDIO_STUDIOS`/`AUDIO_PERFORMANCES`, and `firstGoal.ts` destination hrefs. `CREATIVE_FEATURES` remains the domain catalogue but is registered as one feature family. Remove stale Face Filters search terms.
- Derive the All Features directory and global search entries from the registry. Add a search action to the root header. Search and visible entry points must follow the same gates.
- Keep the `editor` route and `/editor` callers intact, change only the visible tab label to Studio, and add a `studio` search synonym. Rebuild the tab screen as a registry-driven Studio directory instead of removing its flag gate mechanically. Show the tab, Projects (opening `/projects`), Beats, Smart Cut and Best Cut unconditionally; show Professional Editor, new-project actions, and any row that opens `/editor/[projectId]` only when `EDITOR_ENABLED`; gate Film Studio by its build-time switch. The flag-off screen must not be a whole-page “editor unavailable” state, and its test must assert Projects remains reachable.
- Add Beats directly to Audio. Surface supported Ads, Commerce, Workflows and Developer tools from Publish instead of leaving them deep-link-only.
- Add contract tests for registry uniqueness, valid routes, web-inventory dispositions, search coverage, feature availability with `EDITOR_ENABLED` both true and false, `/editor` deep-link continuity, and no orphaned root destinations.

### Wave 2: high-value missing controls and account flows

- Preserve the production-ledger evidence that migration 0514 is applied and use the server's existing per-control capability response; do not add a redundant client-only tempo/key/meter switch.
- Add simple-mode-only, capability-gated Music variety, style influence, excluded styles, BPM, key and meter controls. Send them in `buildSimpleQuote`, preserve them in the prepared-attempt snapshot, and test quote-to-song round trips. Custom mode must never show or send them.
- Integrate the native Dialogue studio from #2598 and verify its Audio entry and generation hand-off.
- Extend the Publish plan parser with status, `current_period_end`, `cancel_at_period_end`, and source. Offer period-end cancellation only when `source === 'stripe'` and status is `active` or `past_due`. Implement the Publish route's actual contract rather than copying the credit-subscription wire shape: POST `{}` with `Content-Type: application/json`, accept only `{ok:true,current_period_end:<valid date>}`, then re-read `/api/v1/social/plan`; map its own 404/429/502/503 error codes. Prove a retry after an ambiguous 502/503 is safe before exposing the action, and verify the refreshed plan shows `cancel_at_period_end`. Keep store management in the OS and Cinema Pass read-only per ADR-0207.
- Inspect the production Supabase passwordless email template before choosing an auth implementation. If it includes a token, add native email-code verification through the existing Turnstile boundary. If it does not, implement universal-link/PKCE return or obtain explicit approval for a template change with web regression coverage.
- Retain the already-shipped native audio seek and lip-sync source hand-off from PR #2533. Add the remaining voice recipes/palettes, voice discovery/favourites, exact submitted-recipe capture, and persistent Audio Shelf outcomes using current ownership and signed-URL contracts.

#### Wave 2D: onboarding and paywall polish

Delivery status (2026-11-23): the colourful goal/destination/role journey, paywall/Credits hierarchy and deterministic recovery/accessibility contracts merged in #2646 (`ba83c2c8672f21b248de6bd28d01779eca6ad522`). Lane F adds rendered 844×390 side-inset fixtures for first-run at AX text size, paywall fallback, Credits, Smart Cut and Rate. RevenueCat/App Store sandbox and consolidated iPhone visual/VoiceOver walkthroughs remain release qualification work, not source-completion claims.

- Audit the complete first-run-to-first-success funnel and every purchase entry: `/welcome`, `/first-run`, contextual paywall prompts, `PaywallSheet`, `/paywall`, `/credits`, account management, restore, and post-purchase return. Keep one source of truth for plan/package presentation and never replace RevenueCat/App Store price, eligibility, confirmation or management data with hard-coded display state.
- Treat the shipped configuration as authoritative: the hard-paywall switch is off in production web and is unset in every mobile EAS profile, so onboarding/paywall colour, hierarchy and state-machine work must proceed against value-first access with contextual or metered prompts. Keep any future hard-gate experiment as a separate flagged slice that cannot block the shipped polish work. If product later enables it as a revenue control, enforce it on the server for every paid quote, confirm and generation route; use one typed client entitlement boundary for UX only, remove regex-maintained feature lists, ensure blocked content is neither rendered nor briefly interactive, and test direct API as well as client behavior.
- Keep first run goal-led, skippable and recoverable. Teach by letting the person choose and begin a real task; defer permissions and optional profile questions to the point of use; and preserve Back, Skip, partial-progress relaunch and account-switch behavior. Replace the current inference that any saved goal or role means “done” with an explicit versioned account-level onboarding step/completion contract, resume at the next unanswered step across devices, reconcile it with the device-local `welcome seen` marker, and migrate existing partial/complete accounts without replaying finished onboarding. Choose and test one web/mobile step order, skip-rest behavior and analytics vocabulary; preserve the personalized sample-result payoff on mobile and either port it to web or record why the funnels intentionally differ. Avoid forcing an immediate purchase before the person can understand Veyrnox's value unless the separately approved hard-gate decision requires it.
- Establish a compact semantic visual system for these surfaces using existing theme infrastructure: adaptive canvas/elevated surfaces, primary and secondary content, one Veyrnox creative accent reserved for selection and primary action, distinct success/warning/danger roles, and subtle media-led depth. Define light, dark and increased-contrast variants; prove at least 4.5:1 for text up to 17 pt and 3:1 for large or bold text; never encode selected, unavailable or error state by colour alone. Remove ad hoc colours rather than adding screen-local palettes. Fix the current cold-launch forced-light reset so the saved or system appearance is honored without a flash before visual qualification.
- Unify the purchase hierarchy and one discriminated purchase state machine across the RevenueCat dashboard paywall, custom contextual sheet and Credits catalog: idle/loading/ready/preparing/store/confirming/credited/subscribed/restored/nothing-to-restore/cancelled/pending/error/sales-closed. Render outcome/value first, then clearly distinguishable package or plan choices, localized total billing price and cadence, renewal/trial terms, one primary purchase action, and quiet secondary actions for all options, later, restore, manage subscription, Terms and Privacy. Remove the duplicate custom-card plus “See plans/packs” acquisition path. Existing subscribers must see current status/renewal and the provider-correct management action beside it instead of an acquisition paywall; unavailable or restricted stores must explain the state and preserve a way out.
- Bring the operational outcomes already supported on web into the native account model where the store contract permits: current allowance and usage, transaction/statement history, renewal and cancellation state, pending reconciliation, and an obvious route to manage the store subscription. Keep Stripe-only recovery, consent and refund mechanics out of the App Store flow, but provide an equivalent honest store-owned state instead of a generic success/error. Revisit the mobile-only sign-in consent checkbox against actual legal requirements and web behavior; preserve required consent without adding an unexplained conversion barrier.
- Polish the interaction states without imitating StoreKit: stable skeleton/loading geometry, disabled/busy semantics, cancellation without false failure, pending webhook reconciliation, restored versus nothing-to-restore, sales closed, offline/retry, successful purchase hand-off into the chosen first task, VoiceOver announcements, Reduce Motion, Dynamic Type reflow, safe areas and 44 pt targets. Continue using the system purchase confirmation and system/RevenueCat subscription-management flows.
- Add reducer/contract/component tests for first-run completion, account switching and routing; hard-gate configured states; plan/package source consistency; price and terms rendering; existing-subscriber suppression; purchase/restore/manage/cancel paths; and every recovery state. Complete RevenueCat/App Store sandbox plus iPhone 17 Pro simulator walkthroughs in light, dark, increased-contrast, XXL Dynamic Type, VoiceOver and interrupted-network conditions; record before/after screenshots for the colour and hierarchy review.

### Wave 3: all editor completion

#### Wave 3A: Professional Editor S7–S14

- S7: port motion paths, transforms, masks and Smart Picture from `claude/codex-editor-s7`; reconcile against current S5/S6 and add fresh tests.
- S8: custom fonts and verified asset packs.
- S9: local Expo media module for PCM decode, frame sampling and H.264/AAC encode; measure a bounded simulator fixture before choosing the export architecture.
- S10: scenes and Clip Finder using web-equivalent pure evaluators and web-produced fixtures.
- S11: Skia native compositor and on-device export, split into preview and export PRs; prove combined-effect ordering and audio mix behavior.
- S12: stabilization, flicker, optical flow, track-reframe and camera movement.
- S13: on-device caption translation and automatic captions with honest Android stubs.
- S14: person tools using a verified New-Architecture-compatible semantic mask path; defer only with a written, evidence-backed incompatibility.

#### Wave 3B: Music Beats Editing parity

- Build a source-backed feature matrix for every production web Beats editor surface before implementation, including arrangement/timeline editing, piano roll and instruments, mixer and track controls, effects and automation, recording and take management, mixdown/export, Beat AI, Magic Bar, Sounds/Labs/templates, cloud sync/version recovery, and collaboration/share outcomes. Compare every row to the production `MUSIC_RUNTIME_FLAGS` keys (`beatEditor`, `beatAi`, `magicBar`, `blocks`, `references`, `labs`, `collaboration`, and future additions): every row must resolve to native, system hand-off, live-capability gated, or a recorded product exclusion. The current `magicBar`, `blocks`, `references`, and other false rows stay gated with no build work until enabled; navigation-only parity does not count. Add a contract test that runtime flag keys and matrix-gated dispositions cannot drift.
- Express the desktop editing model as a native phone workflow: progressive track focus, bottom-sheet inspectors, reachable transport and undo/redo, compact overview plus precision editing, predictable selection state, and explicit dirty/saving/exporting/recovery feedback. Preserve project and audio contracts shared with web rather than creating a mobile-only document format.
- Complete arrangement operations and precision editing: add/reorder/duplicate/split/trim/loop/mute/solo tracks and clips; snap, zoom and scrub; edit notes, velocity, duration and quantization in the piano roll; browse and swap supported instruments without losing edits.
- Complete sound shaping and capture: per-track volume/pan, supported sends/effects, automation lanes and parameter editing; microphone/input permission and latency states; recording count-in, takes, audition, keep/discard and recovery after interruption.
- Complete generation and delivery: wire capability-enabled Beat AI and, only when its live `magicBar` flag turns on, Magic Bar actions to the same capability, quote/idempotency and recovery boundaries as web; expose only capability-enabled Sounds, Labs and template flows; implement preview, mixdown/export, share/save destinations, cloud/version history and conflict recovery without silent overwrite.
- Add deterministic contract and reducer tests plus simulator walkthroughs for large projects, offline/reconnect, interrupted recording/export, failed generation, version restore and cross-surface project reopening. Verify 44 pt targets, VoiceOver labels/order/actions, XXL Dynamic Type, Reduce Motion, safe areas, keyboard avoidance, landscape gestures, transport accessibility and no controls hidden solely behind hover or right-click.

### Wave 4: compatibility and production qualification

- Close remaining template source-media gaps without weakening rights, size or duration checks. The current MP4/MOV/WebM disposition and the proof required to enable each mobile lane are frozen in [the template source compatibility contract](TEMPLATE-SOURCE-COMPATIBILITY-2026-11-23.md). Any cross-product hiding change must update and test both web and mobile.
- Remove the dead legacy editor web-view branch. Keep only unavoidable Turnstile and provider/system flows documented by the native-only guard.
- Run real-device/simulator walkthroughs for Beats, Smart Cut, Cinema, Music, Studio/editor, Publish, report sharing, authentication and purchases. Enable production flags only after their device, money, privacy and recovery gates pass.
- Fix the highest-leverage UI issues found by the iOS rubric: editor labels below 12 pt, hardcoded colors, unlabeled loading states, raw React Native text on high-traffic screens, unvirtualized growing lists, and compact-header crowding.

### Wave 5: final iOS release build

- Integrate every green slice into `main`, pull the final revision into the canonical mobile build checkout, and record the revision and Expo fingerprint.
- Run the full mobile CI gate and a clean production iOS build through the shared build slot.
- Produce the EAS artifact/build URL and build number. Do not submit or release to App Store users without explicit authorization.

## Verification contract

Each PR:

```text
git diff --check
cd apps/mobile && node scripts/gen-en-registry.mjs --check
cd apps/mobile && npx tsc --noEmit
cd apps/mobile && npx jest --ci -w 2 <affected tests>
```

Run typecheck/full suites through `~/.local/bin/with-build-slot` when heavy. A PR that changes `app/`, `lib/`, `packages/` or root `tests/` must also run the affected root `node --test` suites; the root TypeScript script covers the security package, not the Next.js app, and must not be described as web type coverage. Native slices also run Expo prebuild in a scratch copy and an `xcodebuild -jobs 2` simulator build without recreating duplicate installed environments.

Final integrated proof:

```text
~/.local/bin/with-build-slot npm test
~/.local/bin/with-build-slot npm run typecheck
cd apps/mobile && node scripts/gen-en-registry.mjs --check
cd apps/mobile && npx jest --ci -w 2
cd apps/mobile && eas fingerprint:generate --platform ios --build-profile production
~/.local/bin/with-build-slot eas build --platform ios --profile production --non-interactive
```

The canonical native environment is `/Users/aljobson/Documents/GitHub/Veyrnox.ai/.claude/worktrees/veyrnox-mobile-app-f52c2f/apps/mobile` when it still exists. Reuse it; do not install a second native environment. Keep iPhone 17 Pro `E6CA7391-3BBB-4650-8E42-F1EDBD81F9F1` as the default simulator. ARTEMIS is used for Android behavior only when Android test authoring is in scope; iOS proof uses the consolidated simulator/device tooling.

## Risks and boundaries

- S9–S14 are native projects, not JavaScript parity tweaks. They change the final fingerprint and require a new binary.
- Physical iPhone coverage depends on an attached device. Simulator evidence will not be described as hardware proof.
- Live flags, database migrations, supplier probes, store submission and production release are separate external changes. Perform only those required by an approved slice and record each one.
- Other sessions own active PRs and installed environments. Never overwrite their work or duplicate their dependencies.

## Non-goals

- Internal admin screens.
- Restoring products removed from both web and mobile.
- Replacing Apple/Google/OAuth/Turnstile/YouTube system-provider flows with imitations.
- Copying desktop density or interaction patterns onto a phone.
