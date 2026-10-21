# ADR-0247: Phone editor — native shell and engine seam (option C)

Status: Proposed

## Context

The owner chose option C on 2026-10-19 (mobile PARITY and TRD §2.4): a native shell for projects, Library, export and credits, with a bundled web editing engine. This work implements slice 1 only, before the S1 device experiment has run. The installed S1 harness remains separate and deletable. It is not imported by the editor.

Projects are tenant-scoped behind TENANT_PROJECTS_ENABLED. Version 3 saving also depends on EDITOR_MULTITRACK_ENABLED. Project errors are object-shaped; the mobile UI maps their HTTP statuses instead of displaying server messages. GET document returns revision zero and an empty document for a new project. PUT requires expected_revision, a document of at most 32768 UTF-8 bytes, and an Idempotency-Key. Conflict is 409; audited write limits return 429 with Retry-After.

## Decisions

**D1 — Bundled engine.** Ship one self-contained HTML document with inline script/style and a CSP meta tag. Load it with `source={{html, baseUrl}}`; baseUrl is the API origin plus `/app/editor-engine/`. There is no server route and no fetch to that path. Incognito WebView storage is disabled; navigation is restricted to that base URL and about:blank. The page never holds a session token. All API requests go through native. The public `/app/editor` is rejected: it requires an auth bridge, brings the web credits dialog, and drifts with web deployments. Slice 1 bundles a developer stub only, gated by EXPO_PUBLIC_EDITOR_ENABLED rather than __DEV__; enabling that flag in any build selects the stub. Its CSP prohibits every network fetch. Assets receive an acknowledgement without fetching their URLs.

**D2 — Engine-neutral seam.** The shell owns the server project document (versions 1, 2 or 3), structurally validates it and otherwise treats the timeline as opaque. Asset requests name Library media `j-<UUID>[--<stem>]`; native resolves fresh HTTPS links, valid at most fifteen minutes. Links are not put in documents or drafts. The eventual export result is a Library editor-render id. A native timeline (B) or Fly render adapter can replace EngineView while preserving the shell, persistence, asset resolution and result contract.

**D3 — Protocol v1.** JSON strings use `{v:1,type,...}`. Native posts through the WebView ref; the page listens on window and document. Page messages must come from the engine origin, be no more than 65536 characters, and match a known type. Every project id, including the document's id, must match the open route. Document keys are limited to schema_version, project_id, brief, canvas and timeline; schema versions are 1–3; encoded size is at most 32768 bytes. No content, labels, ids, URLs or tokens are logged.

| Direction | Type | Fields |
| --- | --- | --- |
| Page → native | hello | protocol integer 1–99; engine kind stub/web, version ≤40; boolean secureContext/webcodecs/offscreenCanvas caps |
| Native → page | init | protocol:1, locale |
| Native → page | load | projectId, revision, document, imports (≤10 mediaId + video/audio kind) |
| Page → native | ready | projectId |
| Page → native | changed | projectId, document |
| Native → page | flush | nonce |
| Page → native | flushed | nonce, projectId, document |
| Native → page | saved | revision |
| Page → native | asset-request | reqId ≤40, Library mediaId with one of vocals/drums/bass/other/guitar/piano stems |
| Native → page | asset | reqId, HTTPS url, mime, expiresAt milliseconds |
| Native → page | asset-error | reqId, unavailable/expired/offline/rate_limited |
| Page → native | beat | once per second |
| Page → native | error | load_failed/invalid_document/engine_unsupported/internal |
| Both, slice 2 | export/export-progress/export-ready/upload-grant/upload-result/export-failed/cancel-export | Reserved, rejected in slice 1 |
| Page → native, slice 3 | paid-action/open-credits | Reserved, rejected in slice 1 |

Native sends nothing before a valid hello. A protocol other than 1 shows the update-app state and sends no init or load. Other messages are ignored until the handshake succeeds. No valid hello after fifteen seconds offers a startup retry.

**D4 — Ownership, persistence and recovery.** Native is the source of truth. Each changed document immediately enters a serialized durable write to userDocStorage, under Paths.document/veyrnox-user-docs, key `editor.draft.v1:<projectId>`. Records contain only owner, projectId, baseRevision, document and updatedAt. Direct storage failures are visible: the screen promises local recovery only after the current snapshot's write succeeds. The existing appCache behavior remains unchanged. First binding in a process or changing accounts sweeps durable records using their own owner field, independently of the purgeable cache marker. Same-user refreshes do not sweep, so they cannot read an in-progress draft write. Failed reads preserve records, and sweep failures do not reject session adoption. Sign-out and genuine session loss wipe every durable record. The screen also verifies ownership and abandons in-memory state on account change.

The API-only token adapter maps a null token after a transient refresh failure to ApiError(0, network), preserving the stored session and drafts. Other direct token callers keep their existing null contract. Real refresh rejection or a 401 following refresh still signs out.

A draft identical to the server head is already confirmed and is removed silently, including after a crash between PUT and draft removal. Any other valid draft is unsaved work, regardless of timestamp. Equal base/head revisions offer Restore or Discard. A newer server head offers Use saved (with a second discard confirmation) or Keep mine as a copy. A future-base or wrong-project draft is invalid. No engine load or autosave occurs before a recovery choice. A copy freezes its name, document and two idempotency keys across retries, rewrites project_id, and saves at expected revision zero before navigation.

Autosave waits three seconds after the last change, with one request in flight. Snapshot identity is stable under JSON key reordering. A failed in-flight snapshot retains its exact body and idempotency key; it completes before a later queued snapshot saves against the resulting revision. A confirmed snapshot clears its draft only when it still matches the current document. Rate-limit retries obey a separate 1–600 second gate (default sixty); manual retry, resume and leave cannot bypass it. Connectivity failures back off 5, 10, 20, 40, then sixty seconds while focused. Resume, an observed reconnect and Retry now can retry connectivity immediately. All editor API requests are observed by the network store.

Done and every native removal use the same usePreventRemove guard for the entire mounted visit, including the stub's debounce window. It flushes, waits up to three seconds, persists and saves; offline or paused leave saves are skipped. Failure prompts use wording appropriate to durable-write success. Prevention renders false before repeat runs once. Account teardown disables prevention without saving or prompting. Backgrounding flushes and attempts a save. iOS and Android process-death callbacks remount the HTML engine with the native document; they never call reload(). Two kills within 120 seconds stop automatic reopening and offer Reopen; native autosave and leave-save remain available while the engine stays closed. A save conflict flushes pending engine edits before showing the conflict choices.

**D5 — Money.** Editing, preview, browser export and saving an editor-render to Library are free (ADR-0080). No ledger path is added. Future stems and AI steps remain server jobs with server quotes, submitted by native only while online. Credits open the native store route `/credits`; the web Stripe dialog must not enter the bundle.

**D6 — Dependencies and rollout.** No dependency or native configuration is added. EXPO_PUBLIC_EDITOR_ENABLED accepts only the exact string `true`; it is absent from EAS profiles, so this feature ships off. Portrait lock remains. Screen rotation needs a later approved expo-screen-orientation install; keep-awake is a slice 2 device-driven decision.

## Slice plan and device gate

Slice 1 provides the shell, flag, bridge, stub, project load/save, drafts, recovery, leave guard and tests. Slice 2 bundles the real web workspace with native bridge shims for auth/API, locale, cloud save and credits. Tailwind and mediabunny are bundled; remote executable code and MediaPipe/WASM are excluded. A generated-bundle check needs a separately approved root-build/CI whitelist.

Slice 2 adds browser export, a native rights confirmation, editor-renders presigned upload/inspect, Library result, sharing and cancellation. The current 25 MiB cap permits only about 100 seconds at compact 2 Mb/s although the timeline supports 600 seconds. The owner must choose a phone export cap, a server cap change or a separate share transport before implementing that requirement.

Before enabling the real engine, test a 60-second 1080p timeline on an iPhone and a mid-range Android: export ≤3× real time, zero kills including lock/background, 1800 frames, A/V within 0.1 seconds, and thumb trim. Also prove secureContext/WebCodecs, R2 GET/PUT from the HTML base origin, stored inspect with matching sha256, hello within two seconds, and examine WebContent jetsam. Test native header Back, Android hardware Back and iOS edge swipe: removal waits for saving and Stay keeps the screen open. Jest tests the documented usePreventRemove boundary; the native stack testing-library dependency is absent and is not installed.

Slice 3 adds quoted native paid jobs, captions/stems integration, manual captions, rotation and accessibility polish. Local speech inference and device-file import require explicit size/CSP/upload decisions. PROJECT_MEDIA_UPLOADS_ENABLED is not assumed on.

## Risk and fallback

WKWebView encoding has not been proved on iPhone. Memory kills and background suspension can interrupt exports; an HTTPS baseUrl's secure context and R2 CORS behavior also need device evidence. Slice 1 does not rely on those properties. If S1 or the bundled-engine gate fails, the owner chooses B or the Fly runner; that replaces the engine/export adapter and retains this shell. No device proof or production enablement is claimed by the automated slice 1 checks.
