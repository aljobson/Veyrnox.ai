# ADR-0000: Priced typed edits in the phone Cut editor

Status: Proposed; frozen work order implementation, disabled by default.

## Decision

The phone can describe an edit, see its catalog price, send it, preview a validated
closed-vocabulary plan, then apply it as one history entry. One Undo restores the
whole document. The vocabulary is split, trim, move, remove (optional lane ripple),
duplicate, setVolume, setSpeed, addText, setText and insertMedia. Nothing generates
media, uploads, exports, selects another model or enables paid chat options.

The TypeScript command/operation port preserves the web sequence semantics,
including source-frame integration for rate ramps and reverse, animation and mask
anchors, word offsets, fades, locks and limits. The pure web document validator is
imported directly so the phone and server enforce the same document extensions and
limits. Existing native manual editing functions and the web dry run are unchanged.
A preview captures project ID, account ID and a monotonic session edit revision.
Every document replacement/mutation, Undo and Redo invalidates that preview; Apply
checks freshness synchronously before recording the single history entry.

## Price and admission

`EDITOR_AI_EDIT_MODEL_ID` must name an active text/openrouter-chat catalog row.
`replyPrice(row)` with no options supplies its `credits_5s` / credits-per-reply.
Neither the phone nor this change invents a price. The quote returns that price;
the POST compares `expectedCredits` before charging. A changed price requires a
second tap. `replyBudget` supplies the output ceiling; no Thinking/Web/image option
is requested. The provider has a 40-second ceiling and the entire server handler
has a 45-second deadline. The authenticated mobile API call has a 60-second deadline.

The POST is in both the AI-sharing consent and paid-action guard lists. It cannot
start offline. Quote and recovery use the account read quota. Only new paid
admissions use generation rate limits. Recovery reads are available even when the
model/feature is disabled, its price changes, or the account's mobile paywall locks.

## Lifecycle, identity and recovery

The lifecycle is checked `ledger_debit` → checked `job_submitted` → provider →
`editor_ai_edit_settle`, or checked failure then checked `ledger_refund`.
`job_submit_rejected` handles a confirmed rejection before submission; an ambiguous
submission never calls the provider. `debit:chat` is intentionally reused: migration
0399's existing atomic request-identity comparison covers that reason. The distinct
inputs kind is `editor_ai_edit`, with only a SHA-256 request hash alongside it.
The digest binds normalized instruction, canonical complete timeline JSON, and the
admitted model ID. It contains no plaintext instruction or timeline. Ledger debit
stores its inputs JSON, not a separate prompt argument; no prompt is provided.

The job holds the validated result in dedicated nullable columns, atomically with
SUBMITTED → STORED. Settlement is idempotent and service-role-only. A same-key POST
looks up the admitted model before current gates, compares the digest, and returns
the stored outcome. A conflicting request returns no plan. Concurrent admission is
also bound by ledger debit's existing balance lock and identity comparison; only
the first caller submits. A lost response triggers owner-scoped read-only recovery
at `/api/v1/editor/ai-edit/by-key/:key`; no paid guard or generation limit applies.
There is no second model call or second debit. Refunded keys are terminal; the phone
forgets one only after a confirmed refund. An unresolved request retains its key.

`refunded:true` is returned only after a confirmed refund. An unavailable refund
returns `refund_pending`; ambiguous transitions return `outcome_pending`. The
existing 0414 sweep is kind-independent: SUBMITTED jobs are recovered after 120
minutes, FAILED/unsubmitted jobs after its shorter default 15-minute threshold.
No sweep changes or migrations are applied by this work order.

## Refund policy

A delivered but unusable edit plan is refunded. Unlike a conversational reply under
ADR-0067 amendment 9, an invalid command plan provides no usable edit. Provider
failure, timeout, invalid JSON, invalid commands and zero usable steps all enter
the refund path. A valid delivered plan is charged even if the person discards it
or changes the timeline before applying it. The response contains accepted commands
only; unknown operations are reported by index and a fixed reason, never echoed.

## Privacy and retention

The provider receives only `buildAgentRequest`'s reduced timeline and the typed
instruction, fenced as untrusted data under a fixed contract. No media bytes or
URLs, generated-asset prompts, account IDs or project IDs are sent. Provider text,
instruction and timeline are not logged. The stored result can contain text commands;
this is the explicitly required recovery exception to the original memory-only
plan. Phone drafts/previews remain memory-only. Results expire after 24 hours and
a minutely purge removes expired payloads. Account tombstoning clears payloads;
expired recovery answers `result_expired` (410), never recharges or calls the model.
The digest remains on the financial job for idempotency. Existing Library readers,
cancel-status reads and Library-derived achievement counts exclude these jobs;
ledger/credit history retains the debit/refund.

## Flags and owner decisions

Both Wrangler environments default `EDITOR_AI_EDIT_ENABLED` to the exact string
`false` and `EDITOR_AI_EDIT_MODEL_ID` to empty. The mobile build flag
`EXPO_PUBLIC_EDITOR_AI_EDIT_ENABLED` also defaults off. The UI requires both that
build flag and a successful quote. The two requested standalone variables raise
the repository public-binding budget from 67 to 69. At the recorded 50-secret
footprint this retains nine of Cloudflare’s 128 text-binding slots; a live secret
count was not available and must be checked before any deployment. `EDITOR_RUNTIME_FLAGS` is unchanged.

Before enabling, the owner must:

1. Choose an **active** openrouter-chat text model row and set the server model ID.
   A merely staged/inactive row is refused, following the binding admission rule.
   Change its catalog price separately if desired; this change edits no catalog row.
2. Enable the server flag per environment and the public mobile build flag.
3. Confirm refund-on-unusable-plan policy, which differs from ordinary chat.
4. Confirm migration 0450 remains free on current main and in open PRs. The builder
   could inspect only the local origin/main because GitHub network access failed.

## Implementation notes and verification limits

The existing English `editorAi` area is extended rather than replaced. The mobile
API client in this checkout had no per-call deadline option; one was added through
the existing authenticated transport. Metro watches the two pure source directories used by document validation, and
Jest transforms their .mjs modules using the existing Expo transformer. No new
dependencies or native build installs are required. No command was removed from the closed vocabulary. One boundary differs deliberately:
the legacy web plan check uses JavaScript string length, not bytes. The new server
and phone both enforce the stated 16 KiB as UTF-8 bytes, so oversized non-ASCII
plans that the legacy dry run accepts are refused here. All operation results
otherwise match the web. Existing large locale catalogs remain in their required
files; splitting them to satisfy a literal 500-line maximum would conflict with
the specified localization layout. New code files stay below that maximum.

ARTEMIS exploration was denied by the environment approval policy; ADB could not
start its local listener under the sandbox. Device interaction proof is unverified.
These limits do not authorize enabling the feature or applying its migration.
