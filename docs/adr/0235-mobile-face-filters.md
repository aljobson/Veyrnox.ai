# ADR-0235: Face filters share the mobile Create lifecycle

Status: Proposed.

The public catalog returns active models only. The phone offers a curated front door for retouch, enhance, relight, makeup and age; no returned rows means “Face filters are not open yet”. Relight always requires a prompt. Price is the catalog's credits field without local pricing arithmetic. Selectors intersect the catalog contract with the generations allowlist. Age starts at 18, matching the stricter capability record; fixed identity preservation is not exposed as a mutable option.

Create and Face filters use `generationSubmit.ts`: the existing media generation client, sequential batch orchestration, retained idempotency keys after ambiguous failures, and the unchanged Create error mapping. Face filters adds its own guidance before falling back to that mapping. Create retains its draft and navigation behavior. A changed request or successful completion starts a new key; retrying an unchanged ambiguous request reuses the key.

A fresh, unchecked rights checkbox is separate from the existing AI-sharing sheet. Its exact English wording comes from `SourceRightsConfirmation.jsx` and the legal binding catalog, pinned by a drift test. Face filters supplies explicit per-run rights to `media.ts`; an absent/false attestation cannot be replaced by stored AI-sharing agreement. The web sends `consent: true`, not a wording version; the server records `aup-2026-09-26` on the account and attestation on the job. The phone follows that contract.

The image picker selects one JPEG, PNG or WebP within the existing upload caps. Upload happens after the Run attestation; retries reuse the uploaded key. The original URI lives only in the mounted flow, never routes, drafts, analytics, logs, or cross-account cache. A small account notification in `appCache.ts` invalidates the flow and aborts pending upload/poll work immediately. The existing API transport is bound to the initiating account, including token refresh and delayed sharing consent. Picker cache copies are removed on replacement/unmount. Images disable display caching and transitions. Before/after buttons expose selection to VoiceOver without motion.

Results reuse `waitForJob`, `mediaApi`, `saveOutput` and `shareOutput`. Completed jobs are already saved to Library by the server: “Open in Library” opens that existing job list; it does not duplicate a job. The result offers saving to Photos and sharing too. Output moderation is not claimed.

Verification uses the existing dependency symlink, with no installs or native builds. Scope excludes server changes, flags, migrations and navigation layouts. The `appCache.ts` notification is an explicit scope addition required for account-change photo cleanup. ADR numbering is deliberately left to the host before the PR.


Inspection revision: the owner-bound client passes AuthProvider's shared `onSessionLost` callback, the same `expo/fetch` streaming transport, and the same AI-sharing hook. Only token retrieval is additionally bound to the initiating owner; local session loss does not revoke a remote session. AuthProvider exposes its existing callback to allow this exact reuse.

React Native Testing Library is not installed in the supplied dependency tree and the work order prohibits installation. Interaction tests therefore use the existing `test-renderer` dependency of `jest-expo` to render the actual FaceFiltersFlow and result components. This test-library substitution is an explicit deviation; the tests cover the closed catalog, unchecked and per-run rights, Run enablement, and the before/after controls.
