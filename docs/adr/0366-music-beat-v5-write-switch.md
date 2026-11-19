# ADR-0366: Beat v5 write capability and read-only rollback

Status: Proposed (implementation of frozen work order B1)
Date: 2026-11-19

## Decision

`beatV5Writes` is an optional literal in the existing `MUSIC_RUNTIME_FLAGS` JSON.
It is absent/off by default. `musicBeatV5WritesEnabled(env)` also requires the
beat editor. This change does not set the flag, add a binding, edit Wrangler,
apply a migration, or introduce markers or marker controls.

The list and editor receive `v5Writes` from their server pages and configure the
client capability in `useLayoutEffect`; the song seed loader does the same.
Rendering, including suspended or abandoned navigation, never changes capability.
A monotonically increasing generation invalidates asynchronous work started under
an earlier configuration. Storage transactions, take checkpoints, cloud sends
(including authentication waits), media uploads and layer changes recheck before
persistence. An authoritative `BEAT_WRITES_DISABLED` response revokes the mounted
client's v5 capability immediately. Pending edits remain in memory, retries stop,
and no conflict dialog opens for this refusal.

The cloud client declares reader version **5** in both switch states. Write
admission is separate: client `assertBeatWritable` and the server flag both guard
v5 writes. Server refusal is HTTP 409 `BEAT_WRITES_DISABLED`; the gateway preserves
this code. `BEAT_CLIENT_OUTDATED` continues to identify the declared-version fence.
Declared-4 clients cannot replace or delete stored v5 documents. With writes
available, the declared-5 client recovers version conflicts and outdated responses
by fetching the remote document and offering the existing conflict choices.

Once a document is v5, undo, redo, restore, cloud replacement and both conflict
choices restore content without reducing its version. The final normalized
document is validated before acceptance, and the version floor persists in editor
state and device storage, not merely in outgoing JSON. New ordinary documents
continue to use v4; B1 never calls the marker upgrade operation.

With writes off, stored v5 documents open read-only. Account Open and clean cloud
refresh materialize validated read snapshots without write-gated create/replace.
Dirty local edits are not overwritten. Editing, saves, restores, rename, linking,
new AI/generation submissions, layer changes, microphone arming and media
reserve/upload/confirm are refused. Visible controls explain their disabled state.
Playback, downloads, export and already accepted result access remain available.
A recording underway at revocation stops and preserves captured audio as a pending,
unattached take; this preservation is the intentional exception to the no-new-take
rule. Versions above 5 remain unsupported and undeletable.

## Rollout and rollback

Migration **0564 is already applied**, per the owner work order; no database action
is part of this implementation. Deploy the readers, guards and server admission
first. Verify with the switch absent. Only the owner may enable `beatV5Writes`,
and that flip is last. To roll back, remove that JSON key or set it to false and
deploy the runtime configuration. Do not downgrade documents or undo migration
0564. Existing v5 documents remain readable; loaded clients discover rollback on
server refusal or committed navigation with the new flag.

## Verification and allocation

This ADR was first drafted as 0364. Main took 0364 (local silence cut) and 0365
(speech studio inputs) while B1 was in review, so it is renumbered to 0366. On
2026-11-19 `origin/main` held ADRs up to 0365 and no open PR allocated 0366;
re-check against main and open PRs immediately before merging.

The implementation report records exact proof results and remaining browser,
layout and database acceptance checks. The required knowledge generator owns
`lib/generatedProductInventory.js`, which already exceeds 500 lines; its generated
output is a stated exception to the file limit. The existing `lib/musicBackend.js`
also exceeds 500 lines (622 before B1, 623 after the required helper); this
implementation preserves that established module rather than refactoring unrelated
backend functions. New handwritten files remain below 500 lines.

## Known limits (inspection 3, accepted for this release)

- **The switch is a product rollout gate, not a database guarantee.** The route
  enforces it. Migration 0564's `save_music_beat_project` does not know the switch,
  so a client calling PostgREST directly with a user JWT and a declared version of 5
  can still write version-5 rows while the switch is off. A later migration or RLS
  check is needed if the switch must hold against direct RPC calls. The route's
  stored-row preflight is also not atomic with the RPC.
- **A MIDI recording running when writes are revoked is discarded.** Audio takes are
  kept as unattached takes; the captured MIDI overlay is refused by the read-only
  edit path. Keeping it (for example as a saved copy) is future work.
- **Rare races, tracked for follow-up:** with the switch on, a stored version-6 beat
  can leave "keep mine" in a conflict loop instead of update-required; an account
  Open that races a capability change shows a generic error; and edits made in the
  roughly 800 ms before a write refusal are lost if the user leaves by a route other
  than the "My beats" link (which warns).
