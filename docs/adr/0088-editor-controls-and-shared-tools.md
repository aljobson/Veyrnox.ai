# ADR-0088 — Editor controls and permission-aware shared tools

Status: implemented for staging verification under the owner's request to finish the remaining CapCut feature areas while production observation runs. Production activation remains gated.

## Decision and implementation plan

Keep browser-local picture/audio/text/time evaluation in small shared modules used by preview and export. Persist bounded parameters in the existing version-3 document without raising its 32-KiB ceiling. Original audio is a versioned procedural identity that regenerates on reopen; local proxies never replace original export sources.

Separate workspace brand kits and saved-revision review into migration 0280, caller-JWT RPCs, bounded API adapters and account-aware UI resource hooks. RLS and membership checks control reading and writing; a review link grants no additional access. Recheck identity before applying asynchronous results or mutations. Preserve optimistic versions and operation keys on retry.

The cross-file sequence is: parameter validators and evaluation, editing controls, preview/export agreement, feature-by-feature Reticle/output checks, storage/RPC/API permission checks, staging migration and hosted UI checks, integrated CI, then an independently approved production migration/window and focused activation.

## Flags and rollout

- `EDITOR_MULTITRACK_ENABLED`: production stays false during the existing 0269 observation window; owner already authorized activation after complete clean evidence.
- `EDITOR_SHARED_TOOLS_ENABLED`: staging true only after 0280 application; production false until its own migration and 24-hour reconciliation evidence, permission checks and deployment verification.
- Production project saving, media uploads, AI paid tools and paid Cinema retain their separate flags and release requirements.

Production SQL uses the approved main-branch apply-migrations workflow. Latest-zero snapshots or elapsed time alone do not establish a clean window. Full hourly job evidence, all five fresh zero drift counts and cron health are required.

## Validation and limits

See [the completion verification](../editor/CONTROLS-VERIFICATION-2026-10-11.md). The original catalogs are not licensed CapCut assets. Automatic AI and licensed-provider capabilities remain in the inventory until their contracts, rights, prices and live outcomes are qualified.
