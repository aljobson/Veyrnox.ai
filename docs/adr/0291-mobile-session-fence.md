# ADR-0291: Phone requests and session changes are bound to the session that started them

Status: Proposed; implemented for independent review. The host assigns the final ADR number.

The frozen v7 work order has SHA256
`682111f6e16585b551b39a6a090587fb7e8326743c423b05727689758bd30165`.
This change is phone-only. It changes no server, flags, migrations, dependencies,
cache formats, sign-in strings, or remote logout scope.

A request or continuation begun for A must not refresh, resend credentials for,
sign out, bind a store customer for, or publish account state for B. An account
switch can finish while an earlier network call, storage call, native prompt, or
store operation is pending. Unmounting a component does not cancel that work.

AuthProvider owns one monotonically increasing session generation. A drop bumps
it once, before cleanup; duplicate drops do not bump. Adoption bumps it only
when there is no live session or the decoded token subject changes. Same-user
refresh and MFA step-up preserve it. The pure `tokenUser` helper decides identity
independently of cache mocks. Existing cache and analytics identity decoding stays.
The generation is both a synchronous ref getter and rendered context state.

Adoption checks after each await. A superseding account generation rejects with
`AuthError(401, 'account_changed')`, so its caller cannot run success effects. A
newer same-user session stops the older adoption normally. Drop checks after each
await and stops when superseded. Refresh slots hold the promise, starting
generation and starting session object; only identical starting sessions join.
Only generation zero with no current session may read a persisted token. Thus a
paused sign-out cannot resurrect the session from storage. A superseded refresh
neither adopts nor drops nor changes the transient-failure classification.

MFA adoption takes the expected generation and requires the same user as the
live session. Sign-ins capture their generation before exchanging credentials;
a losing sign-in resolves as cancellation and sends no completion analytics.
Discarded sessions are not remotely revoked because Supabase logout is global.
Session loss and sign-out accept an expected generation and ignore stale calls.
Deletion records the generation produced synchronously by its own sign-out, and
navigates only while that resulting generation remains current after revocation.

Every request and stream through `createApiClient` takes a task before
`beforeSend`, including AI consent. Both the first and forced token calls carry
the captured generation. A stale task, mismatched token subject, or stale token
source rejects `ApiError(401, 'account_changed')` without sending, refreshing the
new session, or reporting session loss. A retry may use only a different token
for the original user. Both AuthProvider and Face filters wire the task factory;
Face filters also checks its cache owner before and after token acquisition.
Clients without a task factory retain their existing behavior. An optional
`owner` checks the first token's subject; it is an additional check, not the fence.

Every Supabase account call through `authedCall` captures `expected` or the token
source's generation before its first token call, checks it before refresh and
after both token awaits, and requires a same-user retry token. Task-bound token
sources keep their expected generation across platform prompts and multiple
account calls. `getAccessToken` refuses stale expected generations synchronously,
before even an unforced lookup can trigger a refresh of the current session.

Completed first non-401 responses remain unchanged, including their error bodies
and successful mutations. A response can represent a debit or post already made
for A. Hiding it as an account-change error would invite an incorrect retry.
The caller's task fences subsequent writes; callers also own streamed body work.
Network and timeout mapping and consent-before-token ordering remain unchanged.

Cache binding, wiping and reset invalidate a module owner ticket. Binding checks
after reading the owner marker, clearing cache, and sweeping durable documents.
`Cache.clear(live)` checks after listing keys and before each parallel removal.
Document sweeping checks after listing and after each read before removing.
The newest owner therefore controls subsequent cleanup and marker writes.

`beginSessionTask()` captures `{ gen, user, current, tokens }` synchronously;
`useSessionTask()` exposes it. `current()` checks both generation and subject.
`tokens` is a new function carrying the captured expected generation.
`isAccountChanged` recognizes status 401 and code `account_changed` structurally.
The mechanical rule is to capture before the first await and check before each
post-await account-bound write: storage/files, module state, external provider
state/refs, session or identity operations, token acquisition, and navigation or
`Linking.openURL`. Account keys use the captured user. Token acquisition after
an await has an immediately preceding current check and carries `task.gen`,
`task.tokens`, or API options `{ task }`. Stale work exits silently.
Local component state under the generation key and device-wide settings are
exempt. The push removal ref uses the specified object-identity check so an
older removal cannot clear a newer registration.

Account effects in billing, push, language and MFA depend on rendered generation,
reject a lagging render at entry, and guard their continuations. AppLayout keys
MfaGate and its screen subtree by generation, restarting account loads and gate
state even if status stays signedIn across a switch. Same-user refresh does not
remount. AiConsentHost and CelebrationHost remain outside the key.

Billing stores account state in generation-tagged store and server objects;
nonmatching tags expose empty rights and entitlements. SDK logIn/logOut steps
are serialized. An old login finishing late records the SDK's login state but
publishes no account state; the next queued identity step corrects the SDK.
A bound-generation ref gates purchases and restore. Customer-info events are
only triggers to fetch the SDK's current customer; their payloads are never
published. Purchase/restore completions preserve their result but cannot write
state or finished analytics after a switch. Failed B binding exposes empty
store entitlement state. Server access refreshes also retain their cache-owner
check. Consent questions are shared only by the same captured account, and an
answer is stored only if that account is still selected.

The API's third options argument is `{ owner?, task? }`. A supplied task replaces
a freshly captured task so flows may fence all calls from their original entry.
This work converts the passkey platform-prompt flow. Other library multi-call
flows below remain follow-ups, as required by criterion 19; requests inside them
are individually fenced, but their whole operation is not newly task-bound.

Scope is every `/api/v1` request and stream through `createApiClient`, every
Supabase Auth account call through `authedCall`, all session writes in
AuthProvider, cache owner bind/wipe, and the specified screen continuations:
DevicesCard, account deletion and sign-out, MFA gate/card and privacy export
verification, OAuth consent, Vibe reset, billing, language, push, passkey adding,
and EditorSpikeHarness. It includes the account effects, billing tags and
consent ownership above. It does not claim to fence every write in the app.
`cinemaProgress.ts` retains its existing independent identity/epoch fence.

Follow-up inventory (paths relative to `apps/mobile/src/lib`):

- `privacyExport.ts:46`, `runExport`: start/retry, pages, nested message pages,
  rate-limit waits and file writes.
- `cinemaUpload.ts:47`, `runTransfer`: reservation/status, byte reads, chunks,
  refreshes, backoff and resumptions.
- `chat.ts:157`, `chatApi.sendMessage`: stream body continuations; carry the same
  task across surrounding thread/create/send/poll workflows. The method itself
  has one stream call, not two requests.
- `chatLibrary.ts:124`, `startFromPersona`: thread creation then persona fetch.
- `checkin.ts:17`, `claimCheckin`: claim then balance fetch/cache update.
- `editorDeviceMedia.ts:109`, `backup`: upload grant, PUT, inspection.
- `editorServerExportUploads.ts:17`, `uploadExportFiles`: per-file grants, PUTs,
  retries; `editorServerExport.ts:111`, `sendExportAttempt`: render retries.
- `filmCloud.ts:113`, `saveActiveStudioToCloud`: queued/replayed saves and
  conflict lookup; `filmCloud.ts:226`, `removeCloudFilm`: settle/replay then delete.
- `oddlingsProjects.ts`: `run`/`replayCreate`/`replayOrphans`, failure's head and
  workspace checks, and `choose` reconciliation.
- `publishConnect.ts:88`, `runConnect`: connect, native OAuth prompt, callback.
- `publishUploads.ts:71`, `uploadToPublish`: reserve, PUT, complete, cleanup.
- `media.ts:196`, `waitForJob`: repeated job reads separated by sleeps.
- `cinemaSocial.ts:201`, retention-list `load`: expired-cursor fallback and reload.
- Related single-client-call helpers need the surrounding flow's task too:
  `uploads.ts:33` (`uploadSource`, reservation then PUT), `editorProjects.ts:9,13`
  (`defaultWorkspace` then `createProject` when composed by a screen), pre-call
  awaits in `mediaApi.generate` and montage submission, and pagination helpers
  such as `topUps.ts:44` when a screen requests multiple pages.

Review-5 storage/module follow-ups remain: credits/useBalance/checkin and
CheckInModal/PaywallPrompt; film index/workspace/shot/cloud and publish accounts;
captured-owner cache writers in library, filmCloud, createDraftStore,
libraryView, chatLocal and filmStudioStore. Vibe's device-wide slot needs an owner
key for interview writes. Cinema uploads, editor media, oddlings and export
files retain their existing independent cleanup/ownership mechanisms as well.

Guards cannot cancel a native storage operation already invoked while current.
If its actual write/delete commits after a later account's write, checks after
await cannot roll it back. The frozen plan's call-order tests prove that no new
stale write starts, not atomic durable ordering of already-started operations.
A stronger guarantee would require serialized or generation-aware storage;
that is a proposed separate change, not an implicit redesign here.

Verification uses deferred promises with real AuthProvider and rendered screens
and providers, plus transport and storage tests. The agreed proof is:

```
cd apps/mobile && npx tsc --noEmit && npx jest --ci && node scripts/gen-en-registry.mjs --check && node scripts/check-app-i18n.mjs
```
