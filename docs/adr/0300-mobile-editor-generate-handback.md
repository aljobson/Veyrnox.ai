# ADR-0300: Phone editor Generate hand-back and stems

Status: Implemented; independent review pending.

The phone editor hosts the existing Make panel. Its catalog models, sources, consent,
server-confirmed prices and idempotency keys remain shared with chat. Pushing Create
loses the editor, and carrying a return token through the Create tab would require
covering its many entry points. The editor instead mounts Make lazily and retains
that mounted instance when it closes. Ordinary chat callers retain their Library button.

Generation starts are recorded in `userDocStorage` under
`editor.generated.v1:<projectId>`. Records belong to the active account and project,
expire after 24 hours, and retain the newest ten jobs. Serial writes prevent a batch
from losing starts. Account changes fence reads and writes; sign-out and the existing
user-document sweep remove another account's data. Names are limited to 120 characters;
asset links, prompts and credentials are not stored or logged.

The frame captured when Make opens determines both its explanatory timecode and the
placement frame. This follows the owner's playhead requirement, whereas the web
places a result at a lane's end. Audio uses the first unlocked audio track; images and
video use the first unlocked video track. The shared insertion helper enforces the
server's 40-media and 40-clips-per-kind limits. Automatic additions leave selection
unchanged; explicit media additions preserve the existing selection behaviour.

H1 (durable before forget): inserting in memory does not remove the record. Only a
clean, committed server revision containing a clip that uses the result acknowledges
it. The media dictionary alone is insufficient: Delete deliberately leaves that entry.
Failed and unknown-outcome saves retain the record. Undo, Delete and replacement of a
delivered result show Removed with explicit Add at playhead and Dismiss actions.
Dismiss removes the hand-back, not the job in Library. Failed jobs and age expiry are
the other removal paths.

H1a: delivery history belongs to the account/project session and outlives readiness
pauses. `placed` persists it across screen visits and app restarts. Reconciliation
runs against the document actually chosen after Recovery or Use saved. A recovered
clip is never duplicated; a previously placed clip missing from that document is
never reinserted without asking. A kill before saving thus keeps either the recovered
clip or an actionable Removed row.

H2: the timeline signals gesture activity immediately upon capturing its snapshot,
including the 300 ms long-press wait, and ends it after applying a drag or trim.
Generated results, explicit retries and stem additions share a queue. Release drains
against the latest document in order, acquiring a fresh import token for each entry.
Readiness pauses and unmount discard this in-memory queue; pending jobs remain durable.

H3: every write is gated by readiness and the replacement epoch import token, with
owner, project, mounted and abort checks after asynchronous work. Polling holds no
import token. The host approved one whitelist exception: `useEditorSaveSync` exposes
only a read-only `draftDecided` getter for its existing gate. Its save, conflict and
Recovery behaviour is unchanged. Readiness also requires a live session, a document,
no open core-b sheet and no replacement. A stale token retains core-b's existing
`editorSave.importDropped` wording ("Add it again"); an unplaced hand-back actually
retries on the next readiness transition or refresh. The core-b wording is unchanged.

H4: a single `clampFrame` maps all captured and inserted frames into 0–17999.
A marker at 18000 therefore generates a note, durable record and clip start at 17999;
the final clip has length one, within the server's timeline bounds.

Library audio checks the asset's listed stems and presents known labels in the shared
STEMS order. Each stem requires an HTTPS audio asset and a measured duration. Its
media id is `j-<jobId>--<stem>`, matching web loading and relinking. Multiple stems can
be added without closing the sheet. Server export continues to reject these ids with
its existing unsupported reason; teaching server rendering the stem form is follow-up
work. No server code, flags, migrations or dependencies change. Voiceover recording
also remains a follow-up requiring a native package, microphone permissions and build.

Implementation detail: the hand-back hook owns the common gesture queue and invokes
the screen's pure apply callback for both generated and explicit media additions.
The store's remove/mark helpers accept an optional execution-time guard so a queued
storage mutation cannot acknowledge an item after a readiness pause.

Submit completion retains its originating project and open-time frame even if the
editor has closed or switched projects. The owner check still gates the durable
record; only the currently mounted matching editor refreshes its presentation.
A not-added result is not polled again by ordinary edits or save reconciliation.
Ready transitions, foreground activation and explicit refresh permit a retry;
Add at playhead remains available without waiting for another poll.
