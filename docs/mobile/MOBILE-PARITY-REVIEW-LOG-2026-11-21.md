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

## Wave 3A Editor S7 inspection round 1

- Result: `REVISE`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `519d1a6b-8683-49ab-aacc-7eba760101ad`
- Base: `879ba415b0e0490778beb793b49f49ccca37c7de`
- Plan SHA-256: `8d51a9d53bccfcfb9df569d001fcd764fbb139287ceaa812559f52b6a21b65ad`
- Inspected snapshot SHA-256: `cf52d8a657f1033aed32926596721c86f01dcfff37a86ce5452d427ac35185b2`
- Inspected diff SHA-256: `2926ef4cee6cefef86788ec17852c8619ba0eab628347d560a61197b9aca86e7`
- Runner result: `/private/tmp/claudex-mobile-parity-wave3a-s7-inspect-r1/claudex-rvg4ae5s/result.json`

### Findings and host dispositions

1. `S7-RTL-HANDLE` medium: the motion handle used physical `left` positioning without opting out of RTL mirroring. Accepted; the motion handle and transform layer now force LTR geometry, with an RTL regression covering physical position and positive drag direction.
2. `S7-IMAGE-COVER-FLASH` low: an image with unknown decoded dimensions temporarily ignored the clip's `cover` fit. Accepted; the preview keeps the clip fit until decoding and then contains the image inside the correctly fitted layer, with before/after decode coverage.

Post-fix proof before round 2: 10 focused suites / 156 tests passed, mobile TypeScript passed, app-i18n and locale-registry checks passed, and `git diff --check` passed.

## Wave 3A Editor S7 inspection round 2

- Result: `APPROVED` with one low-severity accessibility advisory
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `3228140c-83f0-4e1e-b914-343b73ad6323`
- Base: `879ba415b0e0490778beb793b49f49ccca37c7de`
- Plan SHA-256: `8d51a9d53bccfcfb9df569d001fcd764fbb139287ceaa812559f52b6a21b65ad`
- Inspected snapshot SHA-256: `993ddf7e1b5e598c1fbd27e7babc3783899dcb8a41edfd59870dd33a0aed3c95`
- Inspected diff SHA-256: `2db8318bf3571f118746c1cd7f986fedaed6628fae22120c6692122203204945`
- Runner result: `/private/tmp/claudex-mobile-parity-wave3a-s7-inspect-r2/claudex-nh5df8_6/result.json`

Claude found no material defect and confirmed the transform, motion-path, picture-key, mask, Smart Picture, bounds, export-cleanup, RTL and decoded-fit contracts against the corresponding web implementation. The low advisory, `S7-SWITCH-DUP-LABEL`, identified duplicate VoiceOver stops for the visible Invert mask and Remove background by colour labels beside identically labelled switches. Accepted after the approved snapshot: the visible labels are now accessibility-decorative while each switch remains the single labelled control, with a regression assertion.

Final host proof: 10 focused suites / 156 tests passed; the two directly affected suites passed 28/28; mobile TypeScript passed; changed-file ESLint has zero warnings; app-i18n, web-locale sync and English-registry checks passed; and `git diff --check` passed. Device gesture, VoiceOver order, Dynamic Type and rotated portrait metadata remain part of the later integrated simulator qualification.

## Wave 3A Editor S10b Clip Finder inspection round 1

- Result: `REVISE`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `07604ce5-be7f-45ed-8262-700555cf7325`
- Base: `f8838ac0de378c8e00bb73d7cbacf24cef9609a6`
- Plan SHA-256: `8d51a9d53bccfcfb9df569d001fcd764fbb139287ceaa812559f52b6a21b65ad`
- Inspected snapshot SHA-256: `df8f5bbbdc935656acae7a36460d3a11505a73ba3d91f2824b3b9e071a71faf4`
- Inspected diff SHA-256: `c10bef7c6d02f8f7e5d4a165fe1ffabaffd7aa9ca6b2ae4755b1ef15a25138a1`
- Runner result: `/private/tmp/claudex-mobile-parity-wave3a-s10b-inspect-r1/claudex-z2l0jyov/result.json`

### Findings and host dispositions

1. `S10-1` high: exact frame sampling could retain the frame already showing before a non-zero requested start, which the strict manifest then rejected. Accepted; native sampling now drops materially early and end-boundary frames and clamps only sub-microsecond timebase rounding.
2. `S10-2` medium: a fixed two-times editor-frame budget had no boundary headroom and failed high-frame-rate sources. Accepted; inspected nominal frame rate now flows through the analysis contract, ordinary sources get two-frame headroom within the 1,800-frame cap, and an additive, strictly echoed 60 fps ceiling deterministically thins higher-rate/VFR bursts.
3. `S10-3` medium: multichannel web-average PCM requested more than stereo without an explicit channel layout. Accepted; the decoder now supplies and validates a discrete AV channel layout before constructing the reader output, preserving the arithmetic mean across all source channels.
4. `S10-4` low: known over-720p sources were prepared before failing with generic format copy. Accepted; stored and inspected dimensions now use the native 1280-by-720 geometry boundary and present a specific localized blocker in all ten non-English app catalogs.

Post-fix host proof before round 2: 15 focused suites / 5,588 tests passed; Swift parsing, the English registry, complete app-locale checks and `git diff --check` passed. Mobile TypeScript reports no errors in changed files; its remaining failures are the known missing optional modules in the reused dependency tree. The full local suite executed 17,618 passing assertions; its dependency-resolution failures are recorded for clean PR CI. Real AVFoundation 25/29.97 fps and 5.1 fixtures were unavailable locally, so the native boundaries are additionally covered by Swift parse, strict source-contract regressions and deterministic 25/29.97/60/120 budget tests; clean native CI remains required.

## Wave 3A Editor S10b Clip Finder inspection round 2

- Result: `REVISE`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `58843fd7-b9bb-4524-8414-62e98246c443`
- Base: `f8838ac0de378c8e00bb73d7cbacf24cef9609a6`
- Plan SHA-256: `8d51a9d53bccfcfb9df569d001fcd764fbb139287ceaa812559f52b6a21b65ad`
- Inspected snapshot SHA-256: `0c8daac16c34622816d18aad927fd4efe3f7e126b54c058c8d5dc8123c550e14`
- Inspected diff SHA-256: `a953300d658ff28f71411db8e864ce8a78786450ec8f3b8ca661481c0d3ecd9c`
- Runner result: `/private/tmp/claudex-mobile-parity-wave3a-s10b-inspect-r2/claudex-w8082xay/result.json`

### Findings and host dispositions

1. `S10B-VFR-BUDGET` medium: exact sampling still derived its limit from AVFoundation's average nominal frame rate, so a variable-frame-rate motion burst could exceed the budget. Accepted; exact mode now budgets against its enforced 60 fps ceiling and ignores the nominal average, with a low-average-rate VFR contract regression.
2. `S10B-EMPTY-AUDIO-RANGE` medium: a valid track with no samples in the selected source range failed instead of matching web's zero-loudness accumulator. Accepted; only a successfully completed empty `web-average` read materializes bounded mono silence with exact source timing, while incomplete, cancelled, malformed and ordinary PCM reads retain their typed failures.
3. `S10B-PROGRESS-STAGE` low: native decode completion moved the UI to Ranking while JavaScript still read and validated PCM. Accepted; decode occupies the first half of the audio phase, PCM reading remains below completion, and Ranking begins only after the read and post-loop validation resolve.
4. `S10B-GENERATION-CANCEL` low: starting Scenes could silently pre-empt Clip Finder and vice versa through their shared native generation. Accepted; the editor blocks the inactive analysis while one is running, shows the active localized stage, keeps the active Cancel action available and fences both start handlers.
5. `S10B-I18N-NAME` low: the 720p blocker left the tool name in English in all translated catalogs. Accepted; all ten non-English catalogs now use their localized Clip Finder term, with length-review metadata and a complete-locale regression updated.

The configured two-round inspection budget is exhausted, so these corrections are not labelled independently approved. Final host proof on the corrected snapshot: 12 focused mobile suites / 428 tests passed; the canonical web Clip Finder and scene evaluator suites passed 21/21; Swift parsing, English registry generation, complete app-i18n validation and `git diff --check` passed. Mobile TypeScript reports only the known missing optional modules and their cascading implicit-any errors in the reused dependency tree, with no changed-file error. Real AVFoundation VFR, empty-audio-range and multichannel fixtures remain native-integration limitations; clean PR CI and later simulator qualification are required.

## Wave 3A Editor S11a preview-plan inspection round 1

- Result: `REVISE` (inspection runner invalidated the verdict after the working snapshot changed concurrently)
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `1b060455-bdf3-4480-9775-9eabf4de2af4`
- Inspected snapshot SHA-256: `4dd4c09b1700e3b17d0820020126adc064c12bba6ec0b85927bd0361567ac93e`
- Inspected diff SHA-256: `880ca6bff3a02b71dde385422cf9495f53bf8cd5a99c368304f5a71a48bc5cb8`
- Runner result: `/var/folders/l3/4f36t9jn439c8fk_1zqgx8pc0000gn/T/claudex-e9r604mw/result.json`

### Findings and host dispositions

1. Active orphan visual media could reach the canonical selector and crash preview planning. Accepted; the adapter now excludes unresolved visuals from canonical selection and reports active or transition-tail orphans as unsupported capability use.
2. The inspected files were changing concurrently, so the runner could not prove a stable review scope. Recorded; no approval is claimed from this round.
3. The legacy UI used the static compositor capability profile and could falsely omit the approximation badge. Accepted; the legacy surface now has its own bounded capability profile.
4. Active orphan audio media was not reported. Accepted; audible orphan audio is now an explicit unsupported capability.
5. Preview planning was performed more than once for the same rendered frame. Accepted; `PlaybackPreview` now constructs one plan and derives its visible layer, caption and approximation state from it.

## Wave 3A Editor S11a preview-plan inspection round 2

- Result: `REVISE` (inspection runner again invalidated the verdict after the working snapshot changed concurrently)
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `726d60d1-371a-4c57-87b9-022c40e6b700`
- Inspected snapshot SHA-256: `d33965e80017f0cb8e8a3f4b851f8ab700472d3d3f0b1fa90db2e76c5139d340`
- Inspected diff SHA-256: `dbf1361b6a31a51f3c7c2a0aa8350e59f165f52e4984e5c148189fdabf1e03f1`
- Runner result: `/var/folders/l3/4f36t9jn439c8fk_1zqgx8pc0000gn/T/claudex-0hz7sg95/result.json`

### Findings and host dispositions

1. The review scope still changed during inspection. Recorded; this round is not labelled approved.
2. The approximation badge still used a capability set broader than the mounted renderer. Accepted in the final correction; it now evaluates the current one-layer Expo fallback specifically.
3. Outgoing transition layers did not always declare the transition capability. Accepted; transition capability use is derived for both canonical outgoing and incoming layers.
4. The legacy caption fallback selected raw array order instead of canonical compositor order. Accepted; the UI now chooses the uppermost active visual and text from the one canonical plan.

The configured two-round inspection budget is exhausted. The final corrections therefore are not labelled independently approved. A separate adversarial host review then found frame-wide retention of layer and mask surfaces, missing canonical numeric bounds and blur framing that omitted the web compositor's three-sigma overscan. Accepted corrections now dispose nested native resources immediately and exception-safely, reject invalid crop/transform/mask geometry before allocation, preserve caller-owned images and match the web blur geometry. Host proof on the final corrected snapshot: five focused suites / 160 tests passed; the English registry and complete app-i18n checks passed; TypeScript reported only the reused checkout's known missing optional packages and their cascading errors, with no S11 changed-file error; and `git diff --check` passed. This S11a slice establishes one canonical preview plan and a bounded static image compositor, but the static Skia surface is not yet mounted in the editor; the visible legacy renderer remains explicitly labelled approximate whenever its capability profile cannot reproduce the active frame.

## Wave 3A Editor S11b paused static preview inspection round 1

- Result: `REVISE`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `bfdf2332-6970-4c10-a60c-e16356f2812b`
- Base: `f06d7d5517bf2e609bab06d1ebf8a4850d8e62a8`
- Plan SHA-256: `8d51a9d53bccfcfb9df569d001fcd764fbb139287ceaa812559f52b6a21b65ad`
- Inspected snapshot SHA-256: `c401c1f7b8b99d35fc9e03c9b952f605234b3db6ae2f5d7931cf5899a59c917a`
- Inspected diff SHA-256: `2e77a799a7d2808c8f1e5984e08adc7555ac344e2ce61d2e6c94a60c17662046`
- Runner result: `/private/tmp/claudex-mobile-parity-wave3a-s11-static-ui-r1/claudex-ogvj__pd/result.json`

### Findings and host dispositions

1. `S11-UI-1` high: the surface imported the Skia capability constant from the preview-plan module instead of the lazily loaded renderer, causing a type error and a broader runtime fallback capability set. Accepted; capability planning now uses the actual lazy renderer export, with a regression that distinguishes the sets.
2. `S11-UI-2` medium: the surface re-resolved and decoded identical images on every paused frame or transform change and briefly returned to the legacy renderer. Accepted; caller-owned decoded sources are cached by source identity and reused for re-composition while the prior committed image remains visible until replacement.
3. `S11-UI-3` medium: compositor dimensions used layout points rather than bounded device pixels. Accepted; render geometry now multiplies by `PixelRatio`, caps against the compositor limits and still draws at layout size.
4. `S11-UI-4` low: the static accessibility proxy could suppress spoken caption context when static text support is later enabled. Accepted; the proxy label is derived from active media names and canonical text presentation.

Post-fix host proof before round 2: six focused editor suites / 136 tests passed, including 17 dedicated static-preview tests; `git diff --check` passed. A full TypeScript scan reported only the checkout's known missing optional dependencies and cascading errors, with no S11 source error.

## Wave 3A Editor S11b paused static preview inspection round 2

- Result: `REVISE`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `b6af4364-ca46-480c-aba6-ce15826c2723`
- Base: `3a2d75b7e46150944f14796da35d981b1afffee5`
- Plan SHA-256: `8d51a9d53bccfcfb9df569d001fcd764fbb139287ceaa812559f52b6a21b65ad`
- Inspected snapshot SHA-256: `3a1a69b18ef7539d9ccb30c98745a51da818a3ff40b646a5a933befd6ba43df5`
- Inspected diff SHA-256: `81cfc32a15e9d13e8b0470a05f6ca826343d326fa2560c5e0535f88631ea4931`
- Runner result: `/private/tmp/claudex-mobile-parity-wave3a-s11-static-ui-r2/claudex-41b1pobb/result.json`

### Findings and host dispositions

1. `S11-BADGE-FLICKER` medium: a same-source replacement temporarily reported the retained exact snapshot as approximate, flashing and re-announcing the live-region badge. Accepted; retained same-source output preserves its committed exactness until success or failure is known, with intermediate-commit regressions for frame and transform changes.
2. `S11-STALE-FOREIGN-SNAPSHOT` medium: a previous snapshot could remain visible across a source-key change, hiding the correct legacy clip and creating a visual/VoiceOver mismatch. Accepted; static output is retained only for the same decoded source identity, while cross-source generations immediately restore the legacy preview and accessibility tree.
3. `S11-PER-FRAME-SYNC-RENDER` low: unanimated stills were recomposited for frame-only steps. Accepted; a conservative render projection reuses output only when the visual plan has no transitions, clip animation or transform/parameter/mask keyframes; frame-dependent plans continue to render.
4. `S11-METADATA-DECODE-GATE` low: timeline dimensions alone could not prevent an understated large encoded image from allocating before the post-decode check. Accepted; local files now use a bounded stat/header read and signed remote assets require an exact bounded `206 Content-Range` probe. A 16 MiB encoded cap, independently parsed PNG/GIF/JPEG/WebP dimensions, the aggregate pixel budget and the post-decode check all fail closed before a handle is exposed.

The configured two-round inspection budget is exhausted, so the final accepted corrections are not labelled independently approved. Final host proof on the corrected snapshot: nine focused suites / 195 tests passed; the source-loader suite passed 13/13; file-scoped strict TypeScript passed for the final loader; and `git diff --check` passed. The final full TypeScript rerun remained queued behind the shared heavy-build slot and was cancelled without interrupting the active build; the earlier full scan reported only known missing optional packages. Targeted ESLint was unavailable because this reused dependency tree has no local ESLint binary, so clean PR CI remains authoritative. HEIC/AVIF, JPEG headers whose SOF lies beyond the 64 KiB probe, and signed sources without byte-range support fail closed to the legacy preview. Signed remote objects are assumed immutable between the bounded probe and Skia's subsequent fetch. Integrated simulator visual, gesture and VoiceOver qualification remains a later Wave 3 gate.

## Wave 3A Editor S11c basic-filter preview inspection round 1

- Result: `REVISE`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `f35035dc-a4d2-45f4-8a1b-620d0f74f025`
- Base: `fb65681f7c939c6b86c153a1d018e247cdb2f45e`
- Plan SHA-256: `8d51a9d53bccfcfb9df569d001fcd764fbb139287ceaa812559f52b6a21b65ad`
- Inspected snapshot SHA-256: `0b1f6a1cb0c57aa4b059e18a211250d20c6f3e51d4fcd52422a012523118ab21`
- Inspected diff SHA-256: `05dba9396b18b8fc36303c642579cc11974fd7638863024b5143c5f6760a850b`
- Runner result: `/private/tmp/claudex-mobile-parity-wave3a-s11-basic-filter-r1/claudex-f3pxzj3w/result.json`

### Findings and host dispositions

1. `S11F-1` medium: raw mobile render pixels made foreground blur strength depend on the device/layout instead of the canonical 720-target web preview geometry. Accepted; the preview plan now carries canonical `timelineSize(timeline, 720)` geometry and the renderer scales sigma from the canonical reference into its bounded output.
2. `S11F-2` medium: the foreground and mask were clipped to the output surface before blur, so transformed or cover-fit pixels outside the frame could not feed the blur and produced transparent edge halos. Accepted; blurred layer and mask surfaces use bounded three-sigma overscan, a translated canonical frame origin and negative-outset final composition.

Post-fix proof before round 2: the renderer suite passed 40/40; the combined editor gate passed nine suites / 216 tests; the canonical web compositor contract passed; `git diff --check` passed; and full TypeScript reported only the reused checkout's known missing optional packages, with no changed-file diagnostic.

## Wave 3A Editor S11c basic-filter preview inspection round 2

- Result: `REVISE`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `a0f079cc-6d5b-46ab-a1c2-ced853330e08`
- Base: `fb65681f7c939c6b86c153a1d018e247cdb2f45e`
- Plan SHA-256: `8d51a9d53bccfcfb9df569d001fcd764fbb139287ceaa812559f52b6a21b65ad`
- Inspected snapshot SHA-256: `f2bebe6f3decbfad8e8275c545c89e2a752bb3d07252a9caeabde1e42d1486dd`
- Inspected diff SHA-256: `80a6dd54090b1ae529eff9e3c2050cebcd05108aa6c67550efcafe24895f2b92`
- Runner result: `/private/tmp/claudex-mobile-parity-wave3a-s11-basic-filter-r2/claudex-wlu487tf/result.json`

### Findings and host dispositions

1. `S11F-1` medium: `source`-aspect web timelines can have canonical geometry that differs from the mobile document canvas, so copying only reference height still changed composition and blur footprint while claiming exactness. Accepted; the static surface now renders at the full canonical aspect inside the bounded physical viewport, centers the result in an unrounded contained rectangle and covers the hidden legacy surface with black letterbox/pillarbox bars only after static commit. The renderer carries both reference dimensions, requires integer-rounding-tolerant uniform aspect before allocation and uses the shared uniform scale for blur.
2. `S11F-2` low: the frame-invariant cache key omitted new reference geometry, so changing the off-screen first source clip could reuse a snapshot rendered with stale blur scale. Accepted; `referenceSize` is now part of request identity, and reference-only changes recompose from cached decoded sources without an approximation-badge flash.

The configured two-round inspection budget is exhausted, so the final aspect/cache corrections are not labelled independently approved. Final host proof on the corrected snapshot: the renderer suite passed 44/44; the surface suite passed 23/23; the combined editor gate passed nine suites / 222 tests; the web compositor contract passed 1/1; full TypeScript again reported only known missing optional packages with no changed-file error; and `git diff --check` passed. Browser Canvas2D edge sampling was validated from the production source contract and existing browser-proof pattern, but the optional local Playwright oracle was not run because `@playwright/test` is deliberately installed ad hoc only in its dedicated CI workflow. Integrated iPhone visual comparison remains required for colour-space rounding and blur-kernel qualification; this slice claims basic brightness, contrast, saturation, hue and blur preview only, while advanced colour, Smart Picture, effects, transitions, video and text remain explicit fallbacks.

## Wave 3B Beats audio-region playback inspection round 1

- Result: `REVISE`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `2a988a55-c3ad-4f85-82a4-09e6b1d2563f`
- Base: `4462adfbb37a8f9e9b7ac372c6b13e639c812ceb`
- Plan SHA-256: `8d51a9d53bccfcfb9df569d001fcd764fbb139287ceaa812559f52b6a21b65ad`
- Inspected snapshot SHA-256: `8e643163c165462df0eae84f9094841e25fe319b279b69324c69f8161883ad71`
- Inspected diff SHA-256: `c21b1d4be66acab1f901937d287aa59772735b79cb101371c01c3fd7930698e3`
- Runner result: `/private/tmp/claudex-mobile-beats-audio-regions-r1/claudex-bf67c8yl/result.json`

### Findings and host dispositions

1. `BEATS-STEM-REGRESSION` high: web-created stem regions returned ZIP archives and caused the entire native beat to fail. Accepted; stems remain deliberately silent until bounded native extraction exists, while every other track continues.
2. `BEATS-CACHE-THRASH-MEMORY` medium: decoded buffers could evict and reload one another during a run. Accepted; the player now admits and pins the run's metadata-keyed decoded set under a 300 MB budget and fails once with beat-specific guidance instead of thrashing.
3. `BEATS-PLAY-PRELOAD-UI-STATE` medium: network preload had no cancellable UI state and could announce playback falsely. Accepted; `play` returns `started`, `cancelled` or `busy`, the editor exposes Stop while starting, and intentional cancellation is silent.
4. `BEATS-GENERATION-CLOSE-RECORDING` low: account-generation teardown could close the engine without disarming recording or resetting the UI. Accepted; the exact generation/engine/recording session is retained, the old recording controller finishes and disarms before close, and transport state resets.

## Wave 3B Beats audio-region playback inspection round 2

- Result: `REVISE`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `4093e034-4e6b-4bf1-afd4-ba3ebf0377e5`
- Base: `4462adfbb37a8f9e9b7ac372c6b13e639c812ceb`
- Plan SHA-256: `8d51a9d53bccfcfb9df569d001fcd764fbb139287ceaa812559f52b6a21b65ad`
- Inspected snapshot SHA-256: `765732b8d772d8fc3b08e411cd4eb0da4887709fcba01b3e57d3ca540d8eb40c`
- Inspected diff SHA-256: `31faf134278729e1ee1dd7c400d85850eaafcad511352508048d9e27b3d8dc25`
- Runner result: `/private/tmp/claudex-mobile-beats-audio-regions-r2/claudex-k0ensct8/result.json`

### Findings and host dispositions

1. `F1` high: a non-take asset failure during recording could halt the range silently. Accepted; ordinary backing-asset failures now silence only that region and preserve the recording transport.
2. `F2` medium: recording startup could wait on remote signing and decoding. Accepted; recording preload is take-only and remote backing audio loads lazily without blocking capture.
3. `F3` medium: a held, missing or offline asset stopped the whole beat and held assets were re-signed on each Play. Accepted; failure state is per asset, permanent held/404/410 results persist without re-signing, retryable failures reset for the next run, and the unavailable region is named in the notice.
4. `F4` low: muted or unsoloed regions were not preloaded, causing a first-onset miss when made audible. Accepted; all referenced audio is preloaded when the decoded set fits, with an audible-only plan used only when the complete set exceeds the device budget.
5. `F5` low: the cache-budget failure reused misleading song-editing copy. Accepted; `beat.audioTooLarge` explains the beat-level condition and recovery in all complete mobile locale catalogs.

The configured two-round inspection budget is exhausted, so the final per-asset failure corrections and their additional cache-overflow recording regression are not labelled independently approved. A separate read-only host audit found no blocker against the five findings. Final focused proof on the corrected snapshot: eleven mobile suites / 249 tests passed, including sound/song/target scheduling, held and retryable failures, recording continuity, cancellation, account fencing, arrangement/mixer screen contracts and complete locale coverage. The additional recording cache-overflow regression passed in the final suite rerun. Clean PR CI passed mobile TypeScript before exposing two older screen mocks that still used the pre-outcome audio/auth contract; both exact failures and the expanded gate pass after correction. Native audio fidelity, memory pressure and interruption behaviour still require the integrated iPhone qualification gate.

## Wave 3B Beats adaptive workspace shell inspection round 1

- Result: `REVISE`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `c48e1081-21a1-4886-8e55-45842f11cf5c`
- Base: `adb360475b5003c4e82e8e2e499b9d8736a721b4`
- Plan SHA-256: `e356b6205e8913b1824b015ed930264a8641c86160ecd66860095ebb28db744f`
- Inspected snapshot SHA-256: `94e3a9228bab5a615ff5399af3d551f5411b74c34bdb37cdcf49ae0d50d53b3d`
- Inspected diff SHA-256: `2214e1f3d5352979498b9f33a758d178dfc059d0db97760c9e8260bb3ef303f8`
- Runner result: `/private/tmp/claudex-beats-workspace-shell-r1/claudex-k6ma0xs8/result.json`

### Findings and host dispositions

1. `F1-android-safe-area` medium: React Native's deprecated iOS-only SafeAreaView left the pinned Android controls exposed to edge-to-edge navigation. Accepted; the bar now uses `react-native-safe-area-context` with the bottom edge and a rendered non-zero-inset test.
2. `F2-accessible-transport-collapse` medium: two `flex: 1` groups could collapse inside an auto-height accessibility column. Accepted; accessible groups no longer flex-grow and the rendered AX layout is tested.
3. `F3-threshold-inconsistency` low: the large-text cutoff differed between compact and regular widths. Accepted; effective scale above 1.35 selects the accessibility-safe layout before width branching, with phone/iPad boundary tests.
4. `F4-acceptance-coverage-gaps` low: count-in, channel mute/solo, rendered layout and action-prominence coverage were incomplete. Accepted; the focused tests now cover those contracts.

## Wave 3B Beats adaptive workspace shell inspection round 2

- Result: `REVISE`
- Inspector: Claude Code 2.1.309, observed model `claude-opus-5-5`, fresh session `2afc1faf-817b-4975-a168-b3cfb8cfd872`
- Base: `adb360475b5003c4e82e8e2e499b9d8736a721b4`
- Plan SHA-256: `e356b6205e8913b1824b015ed930264a8641c86160ecd66860095ebb28db744f`
- Inspected snapshot SHA-256: `5b81edcdce0f93b7ef99da9de075dd23f37c18b186ec7ba2ed79a89c747dcdbf`
- Inspected diff SHA-256: `3b05ae18eedf7d9c125049af6063c2634e84c1542a951ca3d08434b6484e44d7`
- Runner result: `/private/tmp/claudex-beats-workspace-shell-r2/claudex-zzxc11qp/result.json`

### Findings and host dispositions

1. `BWS-1` medium: two stacked labelled toolbar rows could consume too much height on a short AX5 phone. Accepted after the inspected snapshot; accessibility mode now keeps all four actions in one horizontally scrollable toolbar row and removes the redundant status caption, with a rendered 390×667/fontScale 3.12 regression.
2. `BWS-2` low: the primary-action test checked a configuration constant instead of rendered controls. Accepted after the inspected snapshot; the test now compares the rendered Pressable backgrounds and proves only Play/Stop uses the prominent style.

The configured two-round inspection budget is exhausted, so the final horizontal AX toolbar and rendered-prominence corrections are not labelled independently approved. Final host proof on the corrected snapshot: seven focused suites / 134 tests passed and `git diff --check` passed. Full mobile TypeScript and changed-file ESLint are unavailable in this checkout because its lockfile differs from the consolidated native environment while `node_modules` points there; the resulting diagnostics are unrelated missing packages (`expo-audio`, RevenueCat UI, fonts, PostHog and clipboard), with no changed-file diagnostic. Clean PR CI is authoritative for those gates. The SwiftUI-only gstack device bridge is incompatible with this React Native app and was not injected; integrated iOS proof must use the existing consolidated simulator/agent-device path.

## Wave 3B Beats pattern controls plan review and build

- Base: `e24026bd4643ca5719a84506512feccb45cc4b67` (merged adaptive workspace shell).
- Plan: `/private/tmp/claudex-beats-pattern-controls-plan.md`.
- Reviewer: Claude Code 2.1.309, observed model `claude-opus-5-5`, session `7ee3bc6b-acb4-4b8a-8067-03a24fc4b80d`.
- Round 1 result: `REVISE`; runner result `/private/tmp/claudex-beats-pattern-controls-review-r1/claudex-1pyo1pjg/result.json`.
- Round 2 result: `APPROVED` with zero findings; approved plan SHA-256 `c1e6c31a7cc952080034b63c1f7333a526ca7675ed79ff09502f9f8a4c93ff0d`; runner result `/private/tmp/claudex-beats-pattern-controls-review-r2/claudex-ckd_wzqz/result.json`.

Round 1 found that arrangement taps also polluted history; queued clicks could be cut when a mix run retired; a recording click-output failure could silently stop scheduling; globally forwarding mixer steps would regress existing VoiceOver increments; segmented controls lacked disabled semantics; hidden steps made empty/populated ambiguous; straight-time/late-click behavior was unstated; and the proof suite list was incomplete. All eight findings were accepted. The approved plan requires one non-recording pattern-selection path, mix-run click lifetime tracking, fail-safe recording routing, Swing-only 1% accessibility increments, disabled segmented controls, all-step population checks and exact audio timing tests.

The implementation now provides pinned A-D selection in both editor views, an adaptive pattern-controls modal, persistent swing/metronome/length edits, confirmation before destructive clear or populated overwrite, persistent Undo, and true native metronome clicks in ordinary and recording playback. Quarter clicks use straight times, accent every sixteen steps, skip late scheduling and enter the active master path; recording falls back safely if a mix node fails. Copy/clear consider hits 17-32 even while the grid is set to 16. Pattern selection—including arrangement taps—uses `replacePresent`, so it never creates a false Undo entry; changing a region's assigned pattern remains a real recorded edit.

Claude inspection round 1 returned `REVISE` in fresh session `690495b8-b5d3-412a-9c03-026a25391023` (`claude-opus-5-5`; result `/private/tmp/claudex-beats-pattern-controls-inspect-r1/claudex-r31r6xmc/result.json`; snapshot `6d31619f901e0e80826894e435cca2e1e5f429b7b9d3f320aace3eeffc9ffc51`). It found that compact 360-719pt phones incorrectly inherited the accessibility scroller and could hide Mixer/Undo/Redo, plus a low-priority missing focus return after dismissing Pattern Controls. Both findings were accepted. Compact layouts now use a fixed five-action icon toolbar with distinct Pattern/Mixer icons, accessible names and 44pt targets; only accessibility layouts scroll, and every layout keeps Pattern → history → playback order. The shared Button forwards its native Pressable ref, native dismissal returns VoiceOver focus to the trigger, and a guarded next-frame fallback covers platforms without Modal `onDismiss`. Clear also refuses a stale confirmation after pattern selection changes.

Post-fix host proof: fourteen focused mobile suites / 212 tests passed, including 360pt, 390pt and 719pt compact toolbar regressions; shared web beat operations passed 9/9; and `git diff --check` passed. Full mobile TypeScript reports only known dependency-tree failures in the reused mismatched installation (`expo-audio`, RevenueCat UI, Expo fonts/clipboard and PostHog), with no changed-file diagnostic. Changed-file ESLint remains unavailable because this reused tree has no local ESLint binary.

Fresh Claude inspection round 2 returned `APPROVED` with no material defects in session `47e44cdd-fe4a-4908-8331-df3ad103701a` (`claude-opus-5-5`; result `/private/tmp/claudex-beats-pattern-controls-inspect-r2/claudex-c7llivh7/result.json`; snapshot `80f1c4d2ee4a0c33011959b22d031f67d236fc6121fb3b07e033a623e07aa5f3`). Three low findings remained: Swing's visible normalized number did not match its real 0-60% range, Korean particles followed A-D slot letters, and the unrelated Reticle files needed exclusion. The first two were accepted after inspection: StrengthSlider now accepts a real display/range contract and Swing proves 30 visually and semantically at 30%; all affected Korean messages put particles on `패턴`, with direct regressions. The five Reticle changes remain user-owned and excluded from staging. The configured two-round inspection budget is exhausted, so these low-polish corrections are host-tested rather than claimed as part of the independently approved snapshot. Final host proof after those corrections: fourteen focused mobile suites / 213 tests passed; shared web operations passed 9/9; `git diff --check` passed; full TypeScript still reports only the known unrelated dependency mismatch. Integrated iPhone device qualification remains pending for the later consolidated Wave 3 gate.
