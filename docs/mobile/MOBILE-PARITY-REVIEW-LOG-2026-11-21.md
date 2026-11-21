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
