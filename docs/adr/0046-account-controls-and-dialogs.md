# ADR-0046 — Account controls and accessible dialogs

Date: 2026-09-24
Status: Proposed

## Decision

Add a discoverable Account & security page using the existing Supabase Auth
client and MFA panel. Email sign-in links now carry PKCE and our explicit
callback URL, matching the code-only callback instead of relying on an implicit
fragment the callback refuses. Password updates use an authenticated GoTrue user update
with a reauthentication nonce; other-device and global logout use explicit
scopes. A failed revocation is never announced as success. This does not claim
instant invalidation of already-issued access tokens or enumerate devices.

Export/deletion links open email drafts under the existing support process.
The UI explicitly says the user must send the email and that updates arrive
by email. No deletion, export or support message is automatically issued, and
no payment-retention behavior is changed.

Confirmation and editing dialogs share a native modal wrapper. showModal
makes the background inert; explicit Tab cycling contains focus, Escape
respects the busy guard, and closing restores focus to the trigger. Initial
confirmation focus is Cancel. MFA read failures render unavailable rather
than falsely claiming the factor is absent. Enrollment copy is account-wide.

Legal version dates are now specified by each document, correcting the stale
shared September 13 metadata. No substantive legal wording or material-change
notice rule is changed. The remaining vendor/legal evidence review stays open.

## Verification and limitations

Unit tests cover password/nonce validation and authenticated payloads, logout
scope, preserving this session when revoking others, and refusal to report a
failed revocation. Chromium mobile checks verify account rendering, Cancel
initial focus, repeated Tab containment, Escape, focus restoration and overflow.
Auth calls in QA are intercepted; full staging email/MFA/provider flows remain
part of the operational end-to-end verification, not a claim of this PR.
