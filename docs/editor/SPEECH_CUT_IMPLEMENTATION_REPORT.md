# Speech Cut implementation handoff

Advisory only. **The frozen work order is not complete.** Source implementation is
present, but the required new test suites/fixtures, device exploration, full proof
and Postgres acceptance are outstanding. Keep both flags OFF and the model inactive.
An independent review is required; this report is not approval to enable or merge.

Plan file hash verified exactly:
`d0c177d18d2993fa9e52d99d7036e0630b698ae9af153f1c78e84f07a87b6c18`.
Checkout was clean at start, HEAD `22b6103a12742aad94db5cb6f5ba4256c6cc9486`.
No commit, push, publication, migration application or activation occurred.
All source writes were relative to this checkout. Existing dependency symlinks
were reused read-only; no dependency installation, native build or preview was started.

## Implementation present

- Four owner-only API routes: quote, paid request, attempt status, by-key recovery.
- Trusted bounded source probes, persisted SHA256-bound metadata, catalog pricing,
  durable request receipts, free completed reuse and in-flight joins.
- Separate attempts/cache, atomic debit/refund/settlement, unknown-submit correlation,
  speech-specific timeout and retention, source/account cleanup.
- Signed fal dispatch with metadata-only webhook deduplication; opt-in sanitized
  adapter logging. Library and push exclusions; route inventory updated.
- TypeScript timing planner and conservative utterance retakes; memory-only client,
  offline guard, idempotent recovery, bounded polling and account invalidation.
- Feature-gated phone rows, source selection, quote/privacy confirmation, progress,
  checked removal proposals, stale-Apply refusal and one editor history entry.
- English plus ten translations and regenerated English/length-review metadata.
  No added string exactly equals English, so equal-text exception lists need no entry.
- Flags OFF, inactive two-credit proposal, architecture/status documentation.

## Proof and checks

Requested proof was attempted twice through the mandatory shared build slot:

```sh
~/.local/bin/with-build-slot zsh -c 'cd apps/mobile && npx tsc --noEmit && npx jest --ci && node scripts/gen-en-registry.mjs --check'
```

Both attempts exited **1 before any inner command ran**:

```text
PermissionError: [Errno 1] Operation not permitted:
'/Users/aljobson/.local/share/storage-guard/build-slot.lock'
```

The lock was not replaced, relocated or bypassed. **No full Jest pass is claimed.**
Separately allowed lightweight checks:

| Check | Observed output |
| --- | --- |
| `cd apps/mobile && npx tsc --noEmit` | Exit 0, no diagnostics, including final source changes |
| Focused Jest: appTranslations, smartCut, fullEditorScreen, editorAiEditClient, aiConsent, hardPaywall | 6 suites passed; 116 tests passed; exit 0 |
| Existing smartCutAnalysis and falWebhook tests | 16 passed; exit 0 |
| Existing adminReporting, identityHeaders, falSubmitOutcome tests | 22 passed; exit 0 |
| Existing falWebhookHandlerIsolation, falSubmitOutcome, falWebhookSignature | 13 passed; exit 0 (six overlap the preceding run) |
| ESLint on new server modules/routes and changed server modules | Exit 0 |
| ESLint on new phone planner/client/sheet/hook (`--quiet`) | Exit 0, no errors |
| `CI=1 npx expo lint --no-cache` | Exit 1: 1 error, 731 warnings; error is the unchanged `SmartCutPreview.tsx:17` `react-hooks/immutability` finding |
| English registry `--check` | `English registry is current.` |
| App i18n length review checker | All ten locales current |
| Existing adminReporting + workerBindingBudget tests after inventory/budget updates | 7 passed; exit 0 |
| Route inventory `--check` | `Route inventory is current.` |
| Catalog UPDATE guards | `catalog UPDATE guards OK (new migrations from 0111)` |
| Migration number check | `migration numbering OK` |
| `git diff --check` | Exit 0 |

An earlier focused Jest invocation used the nonexistent filename
`editorAiEdit.test.ts`: five suites/106 tests passed and one suite failed ENOENT.
It was corrected to `editorAiEditClient.test.ts`, producing the clean six-suite run
above. An initial invocation mistakenly passed the shell migration checker to Node;
it failed syntax parsing, then passed when run with Bash. Neither is hidden as a pass.

Postgres acceptance was **not run**: neither DATABASE_URL nor
EDITOR_AI_EDIT_TEST_DATABASE_URL is configured, the new migrations are unapplied,
and the work order forbids the builder applying migrations. The existing local
acceptance workflow needs a prepared disposable database with the full schema.
No shared/production database was contacted.

## Denied and blocked actions

- ARTEMIS `mobile_diagnose(attempt_fix=true)` returned:
  `MCP tool call requires approval, but approval policy is never`.
- `adb devices -l` could not start its listener: `Operation not permitted`.
  No device was selected, booted, erased or modified.
- A clarification requesting permission to author automated tests without the
  required ARTEMIS exploration was sent; no approval was received. New test code
  and the requested language/parity fixtures were not authored. Existing test-file edits only maintain schema classification, the route inventory
  list and the binding budget required by the new standalone flag. No new suites
  or device-interaction assertions were authored.
- The shared build-slot filesystem lock was denied as shown above; no full suite
  was run outside that guard.
- `gh pr list` failed to reach api.github.com. The GitHub connector successfully
  listed open PRs instead. Migration names are locally unique but require the
  host's fresh origin/main check before integration.
- No configured/prepared local Postgres acceptance target was available.
- The sandbox also denied a read-only `ps` process listing during a slow command;
  command completion was observed through the execution tool instead.

## Deviations and remaining review work

1. Two migrations (0451 lifecycle, 0452 existing readers/sweep) replace the single
   migration wording to honor the under-500-line rule. 0450 is already Plan A.
2. MP3 measurement reads all frames within a 5 MiB total cap. Larger MP3s fail
   `source_unsupported` before debit. Header-only trusted MP3 duration is not
   supported by the existing parser. MOV/M4A/MP4 and WAV use bounded header reads.
3. Existing locale catalogs and generated review files exceed 500 lines; additions
   preserve their established data-only format. This needs an explicit exception
   to the literal all-files-under-500 rule. Every new code/migration file is below
   500; the changed editor screen is 498 lines and speech sheet is 130.
4. The new test matrix is undelivered, not merely skipped: eleven-language word
   fixtures and timeline parity, UI/new client cases, SQL concurrency/day-31 replay,
   callback/privacy/refund races, cleanup and ledger reconciliation still need code
   and execution once the ARTEMIS/testing prerequisite is resolved.
5. Full proof and Postgres acceptance remain blocked. Existing test passes do not
   establish correctness of the new money/state-machine paths.
6. `git diff --stat origin/main` includes inherited changes already in HEAD
   (including .env.example, workflows and unrelated prior UI changes). Those were
   not overwritten or reverted. Use the clean starting HEAD above to isolate this
   work; untracked new files are also listed below because ordinary diff stats omit them.

See [the ADR](../adr/0000-mobile-speech-cut.md) for pricing/reuse, refund policy,
formats, language behavior, retake limits, secrets and live probes still needed.
No new worktrees were created. No other checkout was established as unused or
safe to archive; other sessions' checkouts and native environments were preserved.

## Design goal criteria

The goal is met when… (static inspection is identified separately from device proof).

- **Checked in source:** “No piece of information appears twice on one screen”:
  price is once, before Start; progress is one live status line.
- **Checked in source:** “Mobile: every gap, padding and margin is a ds.space step”;
  the new sheet uses the existing gutter and spacing tokens.
- **Checked in source:** “Mobile radii come from the set 6/10/14/20/28/999”; existing
  radius tokens are used. No new shadows are introduced.
- **Checked in source:** “Mobile: no hex or rgb() literal outside theme.ts”;
  semantic colors are used. Money is amber and action text uses accent.
- **Checked in source:** “Mobile text uses a type step, with no numeric fontSize”;
  typography tokens are used, with no new weight 800/900 or provider names.
- **Checked in source:** “Every tappable control is at least 44 pt”; buttons and
  checkbox rows have minimum height 52 and accessibility names.
- **Checked in source:** “Every status change … is announced, not only coloured”:
  announcement hook/live regions cover progress, preview and errors.
- **Checked in source:** “With reduced motion on … looping animation [is] off”:
  the sheet uses no spinner and switches modal animation to none.
- **Checked in source:** “Every price and balance is read from the catalog or API”:
  price comes from quote/price_changed; no phone price constant is introduced.
- **Not checked on device:** layout at 375/1280, XL/OS text scaling, clipping,
  target geometry, light/dark/OLED accents and contrast, announcement behavior,
  rhythm/primary-action visibility, and one-Undo behavior of these new cuts.
- **Not applicable:** web keyboard/focus states, web spacing/type, search results.
- **States in source, not device-verified:** no eligible clip/no suggestions,
  quoting/loading, typed error/retry, offline refusal, slow progress/timeout,
  price change, preview/discard and Apply. Existing global outage/auth/paywall
  handling is reused; those states were not exercised interactively.
- **Not fully met:** the money-screen criterion requiring the refreshed balance
  after spend is not independently verified for this new sheet. The sheet reports
  confirmed refund status only, never infers it from a timeout.

## Files changed in this checkout
- `app/api/v1/editor/speech-analyses/[id]/route.js`
- `app/api/v1/editor/speech-analyses/by-key/[key]/route.js`
- `app/api/v1/editor/speech-analyses/quote/route.js`
- `app/api/v1/editor/speech-analyses/route.js`
- `app/veyrnox/_lib/smartCutAnalysis.js`
- `apps/mobile/src/components/editor/EditorSpeechCutSheet.tsx`
- `apps/mobile/src/components/editor/FullEditorScreen.tsx`
- `apps/mobile/src/components/editor/useSpeechCutAvailability.ts`
- `apps/mobile/src/lib/aiConsent.ts`
- `apps/mobile/src/lib/editorFlag.ts`
- `apps/mobile/src/lib/hardPaywall.ts`
- `apps/mobile/src/lib/i18n/messages/app/ar.ts`
- `apps/mobile/src/lib/i18n/messages/app/de.ts`
- `apps/mobile/src/lib/i18n/messages/app/es.ts`
- `apps/mobile/src/lib/i18n/messages/app/fr.ts`
- `apps/mobile/src/lib/i18n/messages/app/hi.ts`
- `apps/mobile/src/lib/i18n/messages/app/ja.ts`
- `apps/mobile/src/lib/i18n/messages/app/ko.ts`
- `apps/mobile/src/lib/i18n/messages/app/pt.ts`
- `apps/mobile/src/lib/i18n/messages/app/ru.ts`
- `apps/mobile/src/lib/i18n/messages/app/zh.ts`
- `apps/mobile/src/lib/i18n/messages/en.ts`
- `apps/mobile/src/lib/i18n/messages/en/editorSpeech.ts`
- `apps/mobile/src/lib/i18n/review/ar-length.json`
- `apps/mobile/src/lib/i18n/review/de-length.json`
- `apps/mobile/src/lib/i18n/review/fr-length.json`
- `apps/mobile/src/lib/i18n/review/hi-length.json`
- `apps/mobile/src/lib/speechAnalysis.ts`
- `apps/mobile/src/lib/speechCut.ts`
- `docs/adr/0000-mobile-speech-cut.md`
- `docs/editor/SMART_CUT.md`
- `docs/editor/SPEECH_CUT_IMPLEMENTATION_REPORT.md`
- `lib/adminRouteInventory.json`
- `lib/falWebhookHandler.js`
- `lib/speechAnalysis.js`
- `lib/speechAnalysisWebhook.js`
- `lib/speechCutCorrelation.js`
- `lib/speechCutLanguage.js`
- `lib/speechSourceProbe.js`
- `packages/adapters/fal.js`
- `packages/db/schema/supabase/0451_speech_analyses.sql`
- `packages/db/schema/supabase/0452_speech_analysis_readers.sql`
- `scripts/test-account-deletion.mjs`
- `tests/adminReporting.test.mjs`
- `tests/workerBindingBudget.test.mjs`
- `wrangler.jsonc`
