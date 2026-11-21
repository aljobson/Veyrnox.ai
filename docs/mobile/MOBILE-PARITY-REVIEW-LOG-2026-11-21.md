# Mobile parity Claudex review log

- Host/planner/builder: Codex
- Independent plan reviewer/final inspector: Claude
- Plan: `docs/mobile/MOBILE-PARITY-EXECUTION-2026-11-21.md`
- Scope: user-facing production web-to-iOS parity, native UX improvements, final production iOS build
- Authorization: research, implement, test, create and merge green squash PRs, and create the final iOS build; App Store submission/release is not included
- Research: deep repository and PR archaeology with three specialist agents; no unsupported provider substitution
- Review rounds: maximum 5
- Build fix rounds: maximum 2 per reviewed slice
- Inspection rounds: maximum 3 for Wave 1 by explicit user approval; default maximum 2 for later slices
- Builder: Codex (host)
- Inspector: fresh Claude session
- Requested reviewer model/effort: CLI default (observed model recorded by the runner)
- Inspection: on

## Round 0: recon

Evidence sources include current source, current tests, recent mobile implementation reports, PR history, feature switches, and three independent audits: feature inventory, PR archaeology, and native UX/IA review. Historical documents are treated as evidence, not authority, where later source supersedes them.

## Round 1: Claude plan review

- Result: `REVISE`
- Reviewer: Claude Code 2.1.309, observed model `claude-opus-5-5`, session `432207f1-1771-4c6b-9ce3-83d1736faca0`
- Reviewed plan SHA-256: `25e19072085b13ef58f6dc51c684c428ba69f68c132a471458d26f18733e1aef`
- Runner result: `/private/tmp/claudex-mobile-parity-review-20261121-r1/claudex-j9_3r21a/result.json`

### Full reviewer response

Summary: The direction fits the code, but the plan conflicted with current route stability, environment gating, Music quote semantics, production migration/template dependencies, parity-source definition, subscription dispositions, and cross-product verification.

Findings:

1. `F1` medium: “Rename Editor to Studio” was ambiguous and could break `/editor`, first-run goals, tests and saved deep links. Fix: keep the route, change only the label/icon, add a search synonym and deep-link test.
2. `F2` medium: the current Editor tab follows `EDITOR_ENABLED`; making it the home of unrelated tools would orphan them when the flag is off. Fix: make Studio unconditional and gate only Professional Editor, with search/orphan tests under both flag states.
3. `F3` medium: advanced Music controls are honored only in simple quotes. Fix: show/send them only in simple mode, bind them into the quote and prepared snapshot, and test that custom mode never shows or sends them.
4. `F4` medium: `tempo_key_meter` does not prove migration 0514 is applied. Fix: verify production migration readiness or gate the capability server-side until ready.
5. `F5` medium: current web passwordless auth is a PKCE magic link, not proven six-digit verification. Fix: inspect the production email template first, then implement token OTP, universal-link return, or an explicitly approved template change with web regression checks.
6. `F6` medium: the parity test had no web source of truth. Fix: compare the mobile registry against signed-in customer routes from `AUTO_PRODUCT_INVENTORY` plus `STUDIO_DESTINATIONS`, with recorded exclusions.
7. `F7` medium: the plan did not enumerate duplicate registries. Fix: derive or replace `SCREENS`, menu sections/footer, Audio hub arrays and first-goal hrefs; retain `CREATIVE_FEATURES` as a registered domain catalogue; remove stale Face Filters search terms.
8. `F8` medium: Publish cancellation scope omitted Cinema Pass and exact semantics. Fix: preserve Cinema Pass read-only per ADR-0207, parse period/source fields, follow the credit-subscription pattern and prove retry/idempotency.
9. `F9` low: per-PR proof covered only mobile even for server/web changes. Fix: require affected root tests and do not misstate the root security-package typecheck as web coverage.
10. `F10` low: Film Studio uses duplicated hard-coded build-time switches, not a live capability. Fix: model it as build-time gated and keep its card, search entry and deep-link helper in sync.

Coverage: full plan; mobile tab layout/files; editor, Film Studio, search and menu gates; Audio hub; `/editor` callers; EAS editor variables; Music types/validation/quotes/capabilities; passwordless auth source; Publish/Cinema/credit subscription readers/routes and ADR; product inventory; root/mobile scripts; mobile WebView file list.

Limitations: no tests or live settings were run; production Supabase template and migration 0514 remain unverified; Publish cancel implementation after line 130, PR history/fingerprint, editor S7-S14, template contracts, WebViews, and detailed Beats/Dialogue/Speech behavior were not independently reviewed.

### Host dispositions

Accepted `F1`–`F10`. The plan was revised in place to implement each requested correction. No finding was rejected or deferred.

## Round 2: Claude resumed review

- Result: `REVISE`
- Reviewer session: `432207f1-1771-4c6b-9ce3-83d1736faca0`
- Reviewed plan SHA-256: `0d8ba25547fd30dd785bc97ba084337644f5e3740eae576c427f767b0362e29d`
- Runner result: `/private/tmp/claudex-mobile-parity-review-20261121-r2/claudex-hlepjj28/result.json`

### Full reviewer response

Summary: Round 1 findings `F1`–`F10` were closed. Three new defects came from the revised text: the existing Editor screen cannot become an unconditional Studio directory without restructuring its early return and project links; Publish cancellation is not wire-compatible with the credit-subscription client; and web navigation cannot be compared by key because it contains duplicate and missing keys.

Findings:

1. `F11` medium: `editor.tsx` stops loading and returns a whole-page unavailable state when `EDITOR_ENABLED` is false; project rows always open the gated editor. Fix: make Studio a registry-driven directory, keep Beats/Smart Cut/Best Cut reachable when the editor is off, and gate Professional Editor plus project rows.
2. `F12` medium: Publish cancel permits no body fields and returns `{ok,current_period_end}`, unlike credit subscription `{subscription_id,mode}` and `result.mode`. Fix: POST `{}` with JSON content type, validate its own response, re-read the plan, map route-specific errors, and prove ambiguous retries safe.
3. `F13` low: `STUDIO_DESTINATIONS` has duplicate `audio` keys, unkeyed rows, differing paths and a filtered-out Film Studio row. Fix: compare exact web hrefs through an explicit web-to-mobile route/disposition map and check Film Studio against the switch directly.

Coverage: revised plan and Round 1 dispositions; web Studio navigation; full Publish plan API; credit-subscription client; full mobile Editor home; prior Round 1 evidence.

Limitations: no commands were run; production email/migration state remains unknown; Stripe/SQL retry idempotency is not yet verified; the mechanical customer filter for `AUTO_PRODUCT_INVENTORY` remains to be implemented; editor S7–S14 and other later waves were not reviewed in depth.

### Host dispositions

Accepted `F11`–`F13`. The plan now requires a real Studio-directory restructure, exact Publish cancellation contract/proof, and href-based web-to-mobile parity mapping.

## Round 3: Claude resumed review

- Result: `APPROVED` with one low-severity finding
- Reviewer session: `432207f1-1771-4c6b-9ce3-83d1736faca0`
- Reviewed plan SHA-256: `97a7e0a837abf925888e98df31eb0853e1aa12a0a172f782f2c1c760cf838745`
- Runner result: `/private/tmp/claudex-mobile-parity-review-20261121-r3/claudex-1i7pp5qk/result.json`

### Full reviewer response

Summary: `F11`–`F13` were closed and `F1`–`F10` stayed closed. Studio is a registry directory, Publish cancellation follows its own contract, and parity mapping uses exact web hrefs. One low-severity Projects gating inconsistency remained.

Finding `F14` low: `/projects` already works when `EDITOR_ENABLED` is false and gates only actions that enter the editor. Removing Projects from Studio would hide a working surface and conflict with the no-orphan requirement. Fix: always show the Studio Projects card pointing to `/projects`; gate only rows/actions that open `/editor/[projectId]`, and assert flag-off reachability.

Coverage: full revised plan; resolutions for `F11`–`F13`; Projects index/detail gating and navigation; continued presence of `F1`–`F10` corrections.

Limitations: no commands were run; production email/migration state and Publish backend retry behavior remain conditional checks; later editor, template, WebView, Beats, Dialogue and Speech details were not reviewed in depth.

### Host disposition

Accepted `F14`. The plan now keeps Projects reachable from Studio in both editor-flag states and gates only editor-entry actions. A final review is required because the plan bytes changed after approval.

## Round 4: final Claude approval

- Result: `APPROVED`
- Reviewer session: `432207f1-1771-4c6b-9ce3-83d1736faca0`
- Approved plan SHA-256: `b86f9a76c7aa66c288915e31eda18a2da633809a0f57452dbff8ebe866a7a27c`
- Runner result: `/private/tmp/claudex-mobile-parity-review-20261121-r4/claudex-aw_uqkxw/result.json`

### Full reviewer response

Summary: `F14` is resolved. Studio exposes Projects in both editor-flag states through `/projects`; only Professional Editor, new-project actions and `/editor/[projectId]` rows follow `EDITOR_ENABLED`. `F1`–`F13` remain closed. No material defects remain.

Findings: none.

Coverage: revised criteria and Wave 1 Studio text; Projects index/detail gating; continued presence of every `F1`–`F13` correction covering registry mapping, Music, Publish cancellation, authentication, Film Studio and verification.

Limitations: tests/builds were not run by the reviewer; production email-template and migration-0514 state remain build-time checks; Publish cancellation retry safety remains to be proven; mechanical filtering of `AUTO_PRODUCT_INVENTORY` is not yet proven; later editor/template/WebView/Beats/Dialogue/Speech implementation details were outside this plan review's deep coverage.

## Wave 1 inspection round 1

- Result: `REVISE`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `9cfcf3ad-e855-4d4d-a3fa-e4f166754d22`
- Base: `dac4d1e1e1cf0b83cf8dec283eb53c96ef452762`
- Plan SHA-256: `b86f9a76c7aa66c288915e31eda18a2da633809a0f57452dbff8ebe866a7a27c`
- Inspected snapshot SHA-256: `bd7f9ffc1ecab9d034a1d4b64ced85cbfa0c451f2e55cd6f4b04482a0af3dfa0`
- Runner result: `/var/folders/l3/4f36t9jn439c8fk_1zqgx8pc0000gn/T/claudex-k16d8d_o/result.json`

### Findings and host dispositions

1. `W1-1` high: new Studio copy existed only in English and would fail complete-locale coverage. Accepted; add every key to all complete locales and equality-review exceptions where linguistically appropriate.
2. `W1-2` medium: no registry-driven All Features directory or complete orphan/deep-link contract, and the flag-off Best Cut assertion mocked behavior that the real component hides. Accepted; add the directory/entry point, contract tests, and correct the mocked assertion.
3. `W1-3` medium: search exposed Music destinations even when the live Music probe was off. Accepted; model the named capability and pass the live state into search availability.
4. `W1-4` medium: the parity test implicitly excluded every inventory route outside `/app` and `/social-cinema`. Accepted; replace the prefix shortcut with exact reviewed exclusions and dispositions.
5. `W1-5` low: disposition vocabulary did not express build-time/live gates and `/app/publish/plan` was incorrectly marked native. Accepted; expand dispositions, derive Film from its switch, and mark the Publish plan gap.
6. `W1-6` low: registry and `CREATIVE_FEATURES` produced duplicate search destinations. Accepted; de-duplicate by href with registry entries winning and assert uniqueness.
7. `W1-7` low: pull-to-refresh could fetch gated editor data while the editor was off. Accepted; gate both refresh props.
8. `W1-8` low: Studio copy promised disabled Film and reused Cinema's glyph. Accepted; make copy capability-honest and restore a distinct icon.

Inspector limitations: no proof commands or device checks were run by Claude; Wave 2-5 were outside this diff. Codex independently ran the Wave 1 TypeScript check, eight focused suites (101 tests), English-registry check, changed-file ESLint and `git diff --check` before inspection. A fresh inspection will cover all accepted fixes.

### Wave 1 fix-round proof

- All eight findings were implemented in one bounded fix round.
- Post-fix Jest: 10 suites, 168 tests passed, including complete-locale coverage, exact web-inventory accounting, Studio/editor flag behavior, search availability/de-duplication, menu/tab shell and Publish discovery.
- Mobile `npm run typecheck` passed through the shared build slot.
- Changed-file ESLint completed with zero warnings.
- `check-app-i18n.mjs`, `gen-en-registry.mjs --check`, `git diff --check`, and the Claudex plan-approval check passed.
- Studio uses the distinct scissors glyph in both the tab shell and registry-backed drawer; Cinema retains slate.
- The accepted fix snapshot now requires a fresh Claude inspection round.

## Wave 1 inspection round 2

- Result: `REVISE`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `12d13cf4-a2d7-4f5e-b859-0a61fd31f0f7`
- Inspected snapshot SHA-256: `627b4d4928d42837602bace6839fb5682abb3f4f5c064820833dfc504cc96c1f`
- Runner result: `/var/folders/l3/4f36t9jn439c8fk_1zqgx8pc0000gn/T/claudex-hbsa2waw/result.json`

### Findings and host dispositions

1. `W2-1` medium: `/app/editor/review` was falsely mapped to the unrelated public token-review screen. Accepted; it is now a recorded native gap with `/editor` as the safe fallback, and its false Studio entry-point claim is removed.
2. `W2-2` medium: native Music creation appeared in search/directory while `audioTarget` would fall back when the live Music probe was off. Accepted; the direct native Music studio now follows `music-live`, while Beats and Instruments remain available.
3. `W2-3` low: route-existence proof covered only searchable entries under `(app)`. Accepted; every registry feature now has its fallback href checked against root, grouped, tab and dynamic native route shapes. Entry-point claims are also checked against the actual Studio/Publish source.

The originally configured two-round inspection budget was exhausted. On 2026-11-21 the user explicitly approved the recommended third fresh Claude inspection before merge. The final accepted edits remain unapproved until that third verdict completes.

## Wave 1 inspection round 3

- Result: `APPROVED`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `8bb5cb9e-90e4-4e58-b24c-af8d8e5da913`
- Inspected snapshot SHA-256: `2276a80b0df67e38e4c649ab52847cb61f83aed3af46117bf2fe45d40be6c1e8`
- Runner result: `/var/folders/l3/4f36t9jn439c8fk_1zqgx8pc0000gn/T/claudex-eizonbfg/result.json`

Claude found no material defect and confirmed `W2-1`–`W2-3` are closed. One low-severity advisory, `W3-1`, remains: the non-rendered `publishPlan` and `publishActivity` registry entries use title keys that are not present in the English catalogue. This does not affect Wave 1 UI because neither entry is searchable or in the All Features directory. It is accepted for the Wave 2 Publish-plan slice: use `plan.navTitle` and `activity.title`, then extend the registry copy test to every entry and include the change in that slice's independent inspection.

Inspector limitations: Claude did not run commands or device checks; compact-header fit, VoiceOver order, Dynamic Type and linguistic translation quality remain for simulator/device qualification. Codex proof for the approved code snapshot is 10 suites / 168 tests, mobile typecheck, zero-warning changed-file ESLint, i18n/registry checks and `git diff --check`.

## Scope-expansion plan review round 1: Beats plus onboarding/paywall

- Result: `REVISE`
- Reviewer: Claude Code 2.1.309, observed model `claude-opus-5-5`, resumed plan-review session `432207f1-1771-4c6b-9ce3-83d1736faca0`
- Reviewed plan SHA-256: `835f9ce942619ae4bf37a25d464f1f9f9438dd12d9b3e48fdd262cbe42ee7baa`
- Runner result: `/private/tmp/claudex-mobile-parity-review-20261121-scope-expansion/claudex-ttm2j7c9/result.json`

### Findings and host dispositions

1. `F15` medium: the revised criterion required Magic Bar even though production `MUSIC_RUNTIME_FLAGS.magicBar` is false. Accepted; criterion 8 and Wave 3B now require only production-capability-enabled outcomes, false flag rows receive a gated/no-build disposition, and a contract test keeps matrix dispositions aligned with runtime flag keys.
2. `F16` medium: the plan described a live web/mobile hard-paywall divergence, but the production web switch is omitted and every mobile EAS profile leaves it unset. Accepted; shipped value-first polish no longer waits on the hypothetical gate. A future revenue gate is a separate flagged slice and must enforce every paid quote/confirm/generation route on the server; the typed client boundary is UX only.
3. `F17` low: migration 0514 was stated as applied without durable evidence. Accepted; the plan now records the read-only 2026-11-21 17:58:08Z production check through `scripts/check-migration-ledger.mjs`. The public `applied_migration_names` RPC returned 518 names and exactly `0514_music_tempo_key_meter` for the match, using no service-role credential and making no remote mutation.

Reviewer limitations: no proof commands or builds were run; the reviewer did not deeply verify onboarding/paywall source, the complete Beats inventory, PR #2533, the cold-launch appearance issue, or later editor/template slices.

## Scope-expansion plan review round 2: final approval

- Result: `APPROVED`
- Reviewer: Claude Code 2.1.309, observed model `claude-opus-5-5`, resumed plan-review session `432207f1-1771-4c6b-9ce3-83d1736faca0`
- Approved plan SHA-256: `8d51a9d53bccfcfb9df569d001fcd764fbb139287ceaa812559f52b6a21b65ad`
- Runner result: `/private/tmp/claudex-mobile-parity-review-20261121-scope-expansion-r2/claudex-lso5vv4x/result.json`

Claude confirmed `F15`–`F17` are closed, `F1`–`F14` remain closed, and found no new material defect. The approved scope now includes Wave 2D onboarding/paywall conversion and colour polish, Wave 3A Professional Editor S7–S14, and Wave 3B production-capability-gated Music Beats Editing parity. Final inspection remains enabled for every implementation slice.

Approval limitations: Claude did not reproduce the migration-ledger output or run tests/builds, did not independently locate the cold-launch forced-light reset, and did not deeply inspect onboarding/paywall source, the complete Beats inventory, PR #2533, Wave 3A, template contracts, or WebView removal.

## Wave 2 batch 1 inspection round 1

- Result: `REVISE`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `c83e3e46-298b-4bda-a386-644695981ed0`
- Base: `a170e38c52264c09a0f73b72f746439ad5b94809`
- Plan SHA-256: `8d51a9d53bccfcfb9df569d001fcd764fbb139287ceaa812559f52b6a21b65ad`
- Inspected snapshot SHA-256: `cd33194b2c07a2174ebe43f8806c040aa0d0fb816ed17714031d29ae09534a43`
- Inspected diff SHA-256: `34aa8d4a59e7246f8e8394ecf083d81392258ce4e3518cf0707c21155046e991`
- Runner result: `/private/tmp/claudex-mobile-parity-wave2-batch1-inspect/claudex-rce9t7od/result.json`

### Findings and host dispositions

1. `MUSIC-ADV-HIDDEN-STATE` medium: a mode switch or remount could collapse active advanced values, including an invalid BPM that disabled Review with no visible explanation. Accepted; the section now initially opens whenever an advanced value is active or BPM is invalid, and the Simple → Custom → Simple regression is covered.
2. `I18N-HI-KEY` low: Hindi used the genitive postposition `की` for musical key. Accepted; the label is now the musical term `सुर`.

Focused post-fix proof: Music create, core i18n and Music-publication i18n suites passed (3 suites / 39 tests); mobile TypeScript passed; `git diff --check` passed.

## Wave 2 batch 1 inspection round 2

- Result: `APPROVED` with one low-severity advisory
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `ff0d67a6-5f9c-4d25-b4dd-95cece5401f8`
- Base: `a170e38c52264c09a0f73b72f746439ad5b94809`
- Plan SHA-256: `8d51a9d53bccfcfb9df569d001fcd764fbb139287ceaa812559f52b6a21b65ad`
- Inspected snapshot SHA-256: `e54a1370a9bb96ea47505bb85625cbc61761977854a2bf4b6badabf23212e2da`
- Inspected diff SHA-256: `011f5d08adabc01c54d885f2f85b8e9541b7141923b81ab36e3aef7557ca1c30`
- Runner result: `/private/tmp/claudex-mobile-parity-wave2-batch1-inspect-r2/claudex-gm1q73v2/result.json`

Claude found no material defect and independently confirmed the server/web Music wire contract, simple-only capability gating, prepared-attempt snapshot behavior, appearance restoration and registry translation coverage. The one advisory, `MUSIC-ADV-01`, noted that a user could manually collapse the section after entering an invalid BPM. It was accepted after the approved snapshot: the collapsed disclosure now keeps the localized validation message visible as an alert, and the screen regression explicitly collapses the section and verifies both the hidden field and visible reason. The bounded two-round inspection budget is exhausted; this six-line advisory fix is covered by the same 3 suites / 39 tests and a passing mobile TypeScript check, but was not sent through a third Claude inspection.

Inspector limitations: Claude did not run tests, typecheck, registry generation or a simulator; later Publish, authentication, onboarding/paywall, editor, template, WebView and release waves were outside this batch. Codex ran the focused proof and typecheck described above, plus the broader Music and i18n proofs recorded in the implementation commits.

The final serial all-mobile run completed 792 of 793 suites with all 17,367 executed assertions passing. The sole suite failed during module resolution before executing because the reused installed dependency tree lacks `react-native-audio-api@1.0.1`, although that package is pinned in both `apps/mobile/package.json` and the current lockfile. No compatible existing installed environment contains it, so the PR's clean `npm ci` Mobile CI job is the authoritative proof for that native-export suite and the iOS/Android bundle boundary; no duplicate local install was created.

## Wave 2D onboarding inspection round 1

- Result: `REVISE`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `f02be47f-2f7b-4c52-b3a7-0096f9c4fab4`
- Base: `ca3edd77317f30917ad9605c837bfd0281f077d3`
- Plan SHA-256: `8d51a9d53bccfcfb9df569d001fcd764fbb139287ceaa812559f52b6a21b65ad`
- Inspected snapshot SHA-256: `7cb3f74c2e4b255855f12b9c1a60e16e10a92be428eabd171ce4420c5bdfe096`
- Inspected diff SHA-256: `097af29182c662a0435935c27ced49aff372b031828245cc4e4f2af62f9a8079`
- Runner result: `/private/tmp/claudex-mobile-parity-onboarding-inspect-r1-retry/claudex-d70ljg0r/result.json`

Claude found that failed answer writes could be lost, the UI could wait on long network timeouts, the web recap was not personalised, Escape dismissal was not stable for the tab/account, the SQL constraint admitted a null current step, retries were unbounded, route documentation was incomplete, and the private helper privilege test was missing. All eight findings were accepted. The fix round added owner-fenced durable outboxes on web and mobile, canonical replay and 409 reconciliation, bounded launch sync/retries, a personalised recap, per-owner session dismissal, the corrected SQL constraint, documentation and privilege coverage.

Post-fix proof before round 2: web/server contract tests 43/43, focused mobile tests 51/51, mobile TypeScript, migration numbering and `git diff --check` passed.

## Wave 2D onboarding inspection round 2

- Result: `REVISE`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `08e0f23e-bab0-400b-89ab-b23ab3f920ba`
- Base: `2a56a1627f8104b4c0a323c339b84ff30c648b62`
- Plan SHA-256: `8d51a9d53bccfcfb9df569d001fcd764fbb139287ceaa812559f52b6a21b65ad`
- Inspected snapshot SHA-256: `ea7ffbffe48b3b7489917cc4cabdc1f6c0f1b6bb157060c2b31c815e551a7b70`
- Inspected diff SHA-256: `020df66626331c63645adaca9ce3e5913ebe846d7dc0c8de70a90a6fc54473d7`
- Runner result: `/private/tmp/claudex-mobile-parity-onboarding-inspect-r2/claudex-y_crh4ra/result.json`

### Findings and host dispositions

1. `F1` high: established accounts with no `first_goals` row would be replayed into the new journey. Accepted; migration 0578 now materialises a version-0 completed row for every non-deleted account present at cutover and leaves post-migration accounts rowless/version-1-new. Existing answer rows are never overwritten.
2. `F2` medium: foreground reconciliation could replace analytics consent, welcome or a consent-policy route. Accepted; the gate respects owned routes, checks the launch-wide pending phase after the cached destination decision, and fences superseded effects before navigation.
3. `F3` medium: web could reopen recap while the durable completion replay was pending. Accepted; authoritative `completed` remains unchanged and a separate owner-fenced `uiComplete` suppresses only `pending && completeRequested` envelopes.
4. `F4` low: signed-out device personalisation was lost. Accepted; the signed-out hook again reads the device-only answers.
5. `F5` low: an unused unfenced `pushOnboarding` path could bypass reconciliation. Accepted; the dead export and queue were removed.
6. `F6` low: canonical mobile replay may resend earlier steps. The proposed global coalescing optimisation was rejected after host review because a shared result promise could cross account boundaries. The existing owner/session-fenced serial replay remains correct and replay-safe; request-count optimisation is deferred to a separately designed per-owner queue.

The configured two-round inspection budget is exhausted. The accepted post-inspection corrections are therefore not labelled independently approved. Host verification on the final correction snapshot: focused mobile tests 55/55, web/server contract tests 45/45, mobile TypeScript, migration numbering and `git diff --check` all pass. A read-only mobile UX agent independently identified the consent-policy detour and authoritative-versus-visual completion distinction before those final tests; a schema archaeology agent independently confirmed migration-time materialisation as the safest legacy-account boundary.

## Wave 2D paywall polish inspection round 1

- Result: `REVISE`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `55232de3-4b8d-4e6f-aa3e-3e8fa7257d4a`
- Base: `666ceace1fc20fad7efbf063a675948ccec6d5a8`
- Plan SHA-256: `8d51a9d53bccfcfb9df569d001fcd764fbb139287ceaa812559f52b6a21b65ad`
- Inspected snapshot SHA-256: `7423c7a50ff9ce0f1ee9d64c28887a91c049f2dc667811c66e8507daad2bb806`
- Inspected diff SHA-256: `7983d84b1db810efdb85838b7acebc90945bfda5a620fe818d9667bb90a3ce3a`
- Runner result: `/private/tmp/claudex-mobile-parity-paywall-inspect-r1/claudex-heetpn8z/result.json`

### Findings and host dispositions

1. `F1` medium: billing-off builds showed a retry action that could never change the state. Accepted; billing-off now has localized, build-specific unavailable copy with no retry, while failed and genuinely empty stores retain retry.
2. `F2` medium: an existing subscriber with no eligible packs was shown acquisition-failure copy. Accepted; the sheet now renders active-plan status and the provider management link instead.
3. `F3` low: loading/restoring purchase states did not announce on initial mount. Accepted; waiting states now explicitly announce on mount and the full-screen paywall regression covers loading.
4. `F4` low: Credits could mount two alert states at once and offered no matching retry. Accepted; Credits now renders one combined store loading/unavailable state and retries offerings plus the sales gate.
5. `F5` low: Recommended and selected plan cards used almost identical accent treatment. Accepted; recommendation is carried by the chip only, while accent border/elevated surface are reserved for selection.
6. `F6` low: Spanish and French low-credit copy introduced gendered adjectives. Accepted; both use neutral constructions.
7. `F7` low: this slice did not yet satisfy the plan's full cross-surface purchase-state-machine requirement. Accepted as a scope warning, not as permission to narrow the approved plan. This fix round removes the duplicate Credits “See plans/packs” path and centralises custom purchase outcome rendering, but RevenueCat dashboard-state unification remains open; Wave 2D must not be called complete until that follow-up is implemented and inspected.

Post-fix host proof before round 2: five focused suites / 91 tests passed, mobile TypeScript passed, both `sync-web-i18n.mjs --check` and `gen-en-registry.mjs --check` passed, and `git diff --check` passed.

## Wave 2D paywall polish inspection round 2

- Result: `REVISE`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `5f45141c-6bd6-4931-927f-4bf4e23328a0`
- Base: `666ceace1fc20fad7efbf063a675948ccec6d5a8`
- Plan SHA-256: `8d51a9d53bccfcfb9df569d001fcd764fbb139287ceaa812559f52b6a21b65ad`
- Inspected snapshot SHA-256: `0ce9d94d4bd31cc42f0dcf4146d7b6b0639e1a711198410919fecc23ead48c14`
- Inspected diff SHA-256: `9e024f3f88973451c316481f1cc70168bbac4a66a9ec345e955b49b44d005039`
- Runner result: `/private/tmp/claudex-mobile-parity-paywall-inspect-r2/claudex-v0a9lbsz/result.json`

### Findings and host dispositions

1. `R1` medium: terminal full-screen paywall states inferred `loading` from the absence of Retry and showed a permanent spinner; malformed offering links also used build-disabled copy. Accepted; the terminal kind is explicit, build-disabled state has no spinner/busy semantics, and invalid offering links redirect to Credits.
2. `R2` medium: `paidAccess` conflated Publish-only and Generation subscribers. Accepted; Generation acquisition is suppressed only by `generationActive`, Publish-only access still sees Generation plans, and the subscriber state is gated by Generation entitlement.
3. `R3` low: Credits rendered `notOpen` beside a stronger unavailable explanation. Accepted; the notice is limited to a ready store with sales closed.
4. `R4` medium: polite purchase outcomes mounted without a VoiceOver announcement on iOS while PaywallSheet errors could announce twice. Accepted; the shared outcome component owns one explicit announcement policy for every result, and the paywall feedback hook no longer duplicates it.
5. `R5` low: ordinary values and prices consumed accent/warning semantic colours. Accepted; unselected values and prices use primary/secondary ink, recommendation chips are neutral, and accent remains on the selected border/check and primary action.
6. `R6` low: an active Generation subscriber with an empty store saw plan-unavailable acquisition copy. Accepted; that state now reports only pack availability beside the existing plan status.
7. `R7` low: a healthy subscriber status was rendered as an alert and omitted the period end. Accepted within available data; it is now a neutral status card and displays the server subscription period end when present, beside the provider management action. A RevenueCat-only entitlement may still lack a server period date; the broader dashboard-state unification remains open under the original Wave 2D requirement.

The configured two-round paywall inspection budget is exhausted. The corrections after this verdict are therefore not labelled independently approved. Host verification on the final corrected snapshot: five focused suites / 96 tests passed; mobile TypeScript passed; changed-file ESLint produced zero errors and the same 18 warnings as the base snapshot; `sync-web-i18n.mjs --check`, `gen-en-registry.mjs --check` and `git diff --check` passed. One mistaken root-level test invocation was stopped and is not counted as evidence. Wave 2D remains open for the full RevenueCat/custom state-machine unification and simulator accessibility/visual qualification.

The first full Mobile CI run found two stale source-contract assertions after all targeted product tests had passed: the no-web-breakout allow-list did not yet enumerate the new store-management system flow, and `paywallUi` still required the rejected `paidAccess` conflation. The contracts now require the explicit management exception and `generationActive` entitlement boundary. Their focused rerun passed 2 suites / 8 tests; changed-test ESLint produced zero errors and the same two legacy `require()` warnings as the base file.

## Wave 2D unified purchase state inspection round 1

- Result: `REVISE`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `acb94328-ee90-4493-a234-2290eb2c5599`
- Base: `353801c3d8fbdb9ee65264e591b9f36f7ff4e04f`
- Plan SHA-256: `8d51a9d53bccfcfb9df569d001fcd764fbb139287ceaa812559f52b6a21b65ad`
- Inspected snapshot SHA-256: `3b790f23c481d699c307f1cd229f77e420fa1e90ed8efd791550dbd67a9d889b`
- Inspected diff SHA-256: `50c7277ec463a3c02f9c829ce8abe429f981168406269e5c1ae0dac3fd2134d0`
- Runner result: `/private/tmp/claudex-mobile-parity-wave2d-billing-inspect-r1/claudex-vy_8nyv0/result.json`

### Findings and host dispositions

1. `F1` high: external operations could remain in `store` on RevenueCat product-ID mismatch, unmount or a rejected `CustomerInfo`; Android base-plan IDs made the mismatch predictable. Accepted; product IDs are normalized, mismatch becomes a non-success outcome, preparation is bounded, and unmount handling distinguishes preparation, StoreKit and server confirmation.
2. `F2` medium: Close was disabled throughout every busy phase. Accepted; only the native StoreKit phase blocks dismissal, while preparation can abort and server reconciliation continues globally.
3. `F3` medium: unresolved access could display a permanent spinner with no recovery. Accepted; access failure is a retryable unavailable state backed by a unified server-access refresh.
4. `F4` medium: active subscribers lacked provider-correct management and renewal information. Accepted; the provider now exposes store/web/both/complimentary source and period end for Generation and Publish, with store links limited to store-backed access and web routes remaining in-app.
5. `F5` medium: the quiet `All options` route had been removed. Accepted; the tertiary route to Credits is restored.
6. `F6` low: a RevenueCat restore that could not acquire the app lock could lose successful returned access. Accepted; returned `CustomerInfo` and restored/nothing-to-restore feedback are still applied even when the shared restore operation cannot be tracked.
7. `F7` low: internal and RevenueCat purchase paths duplicated guard and reconciliation logic. Accepted; both now use the same operation core, identity fence, lock and 40-second pack webhook reconciliation.

Post-fix proof before round 2: nine focused suites / 132 tests passed, mobile TypeScript passed, changed-file ESLint had zero errors, both locale-generator checks passed, and `git diff --check` passed.

## Wave 2D unified purchase state inspection round 2

- Result: `REVISE`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `27065787-985e-4427-913c-fcc0f27cf41c`
- Base: `353801c3d8fbdb9ee65264e591b9f36f7ff4e04f`
- Plan SHA-256: `8d51a9d53bccfcfb9df569d001fcd764fbb139287ceaa812559f52b6a21b65ad`
- Inspected snapshot SHA-256: `34924413499ed0ce8f9ae0c772151aeb1f9ff17aa50cd17f0feb72951decbde2`
- Inspected diff SHA-256: `6b90b4435e54e2c5ece87a490a8ac0c706cd6ff07eecbe31a0c93022f3ed185e`
- Runner result: `/private/tmp/claudex-mobile-parity-wave2d-billing-inspect-r2/claudex-08am_fek/result.json`

### Findings and host dispositions

1. `F1` medium: Credits hid management from a store-Publish-only subscriber. Accepted; management is shown when either Generation or Publish has store/both source, with an explicit source-contract regression.
2. `F2` medium: a two-minute callback timeout released the lock while StoreKit could still be open and skipped late pack confirmation. Accepted; StoreKit remains locked until RevenueCat delivers a callback or the screen unmounts, and a slow-callback regression proves no second purchase can start before the matching completion.
3. `F3` low: rejected `CustomerInfo` skipped valid pack reconciliation and misreported successful restore. Accepted; packs always reconcile against server balance, while restore reports returned access and refreshes access if local application was fenced.
4. `F4` low: failed external preparation left Vey in a checking state. Accepted; the failure event is rendered and StoreKit is not resumed.
5. `F5` low: Publish resolution was coupled to the Generation read and Retry could not recover the rendered state. Accepted; Publish has an independent server-resolution bit combined with the resolved store read, and a Generation-failure/Publish-success provider regression passes.
6. `F6` low: the two management labels were English-only. Accepted; both labels are present in all ten complete app locale catalogues and complete-locale parity passes.
7. `F7` low: the tested action policy was not driving the three purchase surfaces. Accepted; buy, restore, manage and close decisions now use the shared discriminated policy in Credits, the contextual sheet and the RevenueCat screen.

The configured two-round inspection budget is exhausted, so these final accepted corrections are not labelled independently approved. Host proof on the final correction snapshot: 11 focused suites / 322 tests passed, including complete-locale parity, slow StoreKit completion, Publish-only management, rejected-CustomerInfo pack confirmation and independent Publish access; mobile TypeScript passed; locale generators and `git diff --check` passed. Changed-file ESLint had zero errors and only the same legacy warnings recorded for the touched files. Simulator accessibility and visual qualification remains the final Wave 2D gate.
