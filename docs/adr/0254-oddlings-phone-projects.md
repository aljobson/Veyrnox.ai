# ADR-0254: Oddlings saved to Projects on the phone

Status: Proposed.

Builds on ADR-0246 by adding account-isolated phone storage and synchronization of Oddlings to Projects. This change leaves the server, migrations, flags and editor unchanged. During session adoption, the legacy claim runs after `bindCacheUser` and the Cinema upload owner call, and before `writeRefreshToken`; this preserves the existing Cinema initialization order.

The phone stores one `oddlings.v1` record in `userDocStorage`. It contains the owner, linked project and link generation, server base and local collection, generation-tagged pending operations, exact in-flight request, orphan requests, pending creation intent and optional recoverable collection. All account record mutations use one serialized read/modify/write queue. A write verifies the owner both before and after persistence and undoes a write crossing an account change. Existing `bindCacheUser` and `wipeCache` sweep this record; no bespoke authentication wipe is added. Screen state resets on account change and late results are discarded.

The legacy install-wide passports file is claimed at most once by the first adopted account able to persist a SecureStore marker. `claiming:<userId>` is stored before any read. Only that account can resume; `done:<userId>` prevents rereads on refresh or restart. Claim merges repaired items absent from the existing base, local collection and operations; the legacy draft is used only when none exists. Adopting that draft enqueues a draft operation, the smallest change that preserves it through the first project link even when the project already has a different draft. `legacyApplied` makes a resumed merge idempotent. Deletion is best effort and a failed marker write fails closed. The marker key `veyrnox.oddlings.legacy.v1` is one string per install, deliberately retained across sign-out, account switches and cache wipes. If the cache is wiped before an interrupted claim finishes, local saves can be lost; unavailable SecureStore exposes nothing. Nothing else reads or writes the retired file.

Saves land locally without a network prerequisite or paid-action gate. Durable pending upsert/remove/draft operations sync on screen events, with no background task. Autosaves debounce at 600 ms into the cache; Save excludes the active draft and leaving the builder sends at most one changed draft per visit. Explicit Saves make permanent revisions, subject to the server's 1,000-revision cap. Unsent content is lost on sign-out or session loss, like editor drafts; rows state “On this phone only” with “Signing out removes them” as the accessibility hint. No pre-sign-out prompt is added.

The server representation is the exact v4 Projects document from ADR-0246. Text is repaired without depending on Hermes `isWellFormed`; UTF-16 truncation preserves surrogate pairs. IDs, timestamps and names are repaired on legacy reads. A local 25th passport is refused, replacing silent oldest-item eviction. A merge exceeding 24 passports or 32 KiB of PostgreSQL jsonb text stays local with “This project is full. Delete a saved Oddling first”; no content is dropped. Tests compare byte counts and validation with the repository's server validator, including both sides of the exact byte boundary.

A sync replays a persisted request before reading a new head. Exact body, key, expected revision, project ID, link generation and captured operations are persisted before PUT. A success removes only acknowledged generations; newer edits, deletes and drafts are applied over the acknowledged base. A different document kind is never overwritten. Fresh reads merge only pending operations, never resend an old whole collection. Acknowledgement also requires the same project and link generation.

| HTTP outcome | Phone action |
| --- | --- |
| Network/status zero | Keep pending operations and exact request; stop |
| 409 | Clear definitive failed request, read a fresh head and rebase, at most two more attempts; then “Could not save yet” |
| 429 | Keep pending request, show “Busy, try again in a moment”, honor Retry-After; no retry loop |
| 400 | Keep local content, clear request, remember rejected body to prevent identical retry; “This could not be saved” |
| Linked GET 404 | Probe workspaces; success unlinks with recoverable collection and “That project is no longer available. Choose another.”; unavailable probe remains quiet unavailable |
| PUT 404 | Re-read document; success means unavailable, another 404 probes workspaces as above; uncertainty retains the exact request |
| 402, 403, 503 (any code), other 5xx | Keep pending content/request; unavailable in session memory, retried after ten minutes or a new launch |
| 401 | ApiClient handles session loss; owner change stops sync |

Unavailable screens show only “Saved on this phone. Saving to Projects is not available yet.” and hide the chooser. Server codes, messages and document content are never displayed as errors or logged.

The chooser uses existing workspace/project helpers and checks document kind only on tap, without per-row GETs. A normal switch takes the remote base and carries only pending operations. Synced items of the old project remain there; non-pending ties prefer the selected project's server copy. In-flight generations belong exclusively to the original project and become an orphan containing only project ID, key, expected revision, serialized body and creation time. Switching back resumes that request with a fresh link generation. Reselecting the same project while its request is unresolved preserves the request, local collection and pending operations, updating only the link generation and the request’s generation binding; a replay conflict can then rebase those edits. Orphans never feed another project's operations or content. A 200 drops the orphan, 400/409 drops it with a one-time lost-changes notice, and uncertain responses including 404 retain it. At most three orphans survive for at most thirty days. If saving stays unavailable, those uncertain changes may or may not be on the server and become unrecoverable from the phone after eviction; reselecting that project loads its server copy.

A confirmed deleted project retains `{items,draft,from,at}` durably. Choosing another offers “Bring N Oddlings from the deleted project” by default, or confirmed “Start empty”. Bring imports only IDs absent from the target and keeps remote ties. This recovery differs from an ordinary switch.

Creation persists `{nonce,key,workspaceId,name,linkGenAtIntent,createdAt}` before POST. Retries send the exact normalized intent regardless of new form values. Only the matching nonce may apply an answer or clear its slot. Success links the created project through the ordinary switch path only if the selection generation has not changed, even when another project was linked at intent time. A later selection wins. Definitive 400/403/409 or 404 with a successful workspace probe clears with “The project could not be created.” Network, 429, 5xx, 402 and uncertain 404 retain the intent, bounded to twenty-four hours; Start over also clears it. Expired or abandoned uncertain creation can leave an unlinked empty project. No automatic project deletion is attempted; the chooser points to the existing Projects screen for removal.

Validation uses `cd apps/mobile && npx tsc --noEmit && npx jest --ci && node scripts/gen-en-registry.mjs --check`. Native device behaviour, staging with the feature flag enabled, and OS backup/uninstall retention are not verified by these source tests. No image, media asset, analytics, dependency, server configuration or editor-screen change is included.

## Owner decisions

1. Claim the legacy file once for the first account that signs in, using the SecureStore ownership marker. The alternative is to discard the file unread, which is recommended if any install is public. At most one account ever receives the legacy data; that data is lost from the phone if its owner signs out before it syncs.
2. Refuse a new save at the 24-saved-Oddlings limit or a server document beyond 32 KiB, retaining existing content instead of silently dropping the oldest passport.
3. Unsent saves are lost on sign-out or a lost session, as editor drafts are. No pre-sign-out prompt is added.
4. Turning on `PROJECT_ODDLINGS_ENABLED` and `TENANT_PROJECTS_ENABLED` remains the owner's decision. This change does not enable either flag.

## Known limits

The existing `oddlings.saved.deleteBody` wording says the passport is only stored on this phone and cannot be brought back. That statement is no longer accurate for synced items, but remains unchanged by owner decision. Device behaviour, staging with saving enabled, and OS backup/uninstall retention remain unverified.
