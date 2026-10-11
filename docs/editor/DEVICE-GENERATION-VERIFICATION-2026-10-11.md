# Device sources for editor generation — 11 October 2026

The editor previously offered only generated Library sources for AI camera,
avatar and media tools. It now stages device originals in declared start/end,
image/video/audio slots and uploads only after Generate using the existing
owned source-upload API. This release also frees Worker text-binding capacity
while retaining every current feature value and leaving paid separation false.

## Evidence

- 28 focused checks passed: mixed Library/device plans, strict consent, type/size
  refusal, partial-upload reuse, account change/cancellation, correct provider
  start/end fields, duplicate/unknown/foreign/wrong-kind source refusal before
  debit/dispatch, and gate/cache compatibility.
- Actual isolated Next app, port 3002, used the real production public catalog
  through a temporary read-only QA rewrite; no catalog/auth/provider response was
  mocked in the browser journey. Reticle reported explicit `yes` verdicts for
  device image staging, wrong-kind refusal retaining the valid image, and clearing
  staged file state. The selection/refusal/clear windows made zero requests.
- Temporary SDK/store/CSP/catalog QA wiring was removed before the release build.
  The first already-true catalog assertion was `no-fault`, retained as a failed
  verification attempt and not counted as a pass. Other upload attempts hit the
  existing upload-root/file guards; no browser permission was changed.

- Complete regression suite: 3,247 passed, no failures and one existing skip.
  Production Next build passed. Lint has no errors; new preview-effect warning
  was corrected before release.

## Limits and production receipt

No paid generation was submitted. Automated gateway checks use real media bytes
with isolated request fixtures; they do not prove FAL/KIE output quality or live
provider billing. The existing Library inspection project remains untouched.
Actual production deployment, effective flags and native source UI still require
readback before reporting this change live. Caption translation, licensed
catalog/provider entitlements, TikTok Ads and broader quality remain separate gaps.

## Actual production availability

PR #902 squash 4eeaa49039c5de82c14e3749fd0629f637759fb3 deployed successfully in
run 38165969807. All five live smokes, preservation of 45 secret binding names
and workers.dev/preview closure passed. Production native UI selected the
repository-owned og.png in a device image slot, displayed its preview and
Device source label, showed consent and upload-on-Generate wording, and cleared
the selection. No upload or generation was submitted. A subsequent approved
paid availability release (#904) retains these source controls and enables only
the additional audioStems group member. Neither release proves provider output
quality or live billed cost. The original inspection project remains untouched.
