# ADR-0067 amendment 14 (2026-10-10): a replay, and a reply cut short with no `done`, are looked for by their job

- **Status**: Proposed. The owner accepts it by merging the change.
- **Amends**: [ADR-0067: Chat, a reply is a job](0067-chat-replies-are-jobs.md). It follows amendment 13 and closes the two
  endings that amendment names as left. It is a file of its own because ADR-0067 is at the 500-line limit.
- **Scope**: browser only. No route, migration, switch or new wording.

## Context

Two endings of a chat send ended as "sent", with nothing said.

**A replay.** The turn answers `{ replay: true, job_id }` when the database already holds a job for the send's key. The
screen read that as "this message already ran": it read the chat again, said nothing, forgot a warning kept for the
message before, and gave no text back. But the screen makes a key for each press and sends it once. A job that exists
before its request is answered was made by something the screen never saw answered:

| How the job came to exist | What became of it |
|---|---|
| The browser sent the request again by itself. Chromium does this when a connection dies with no answer. The first copy had reached the server | Debited. With its reader gone the server takes it as Stop (amendment 10): usually failed and refunded, sometimes text was produced and it is saved and charged. It can still be running when the second copy is answered |
| The free allowance's call made the job and its own answer was lost (`lib/freeJob.js`). The debit that follows finds the job by the key | Nothing was debited (a free job costs 0 Credits) and **no turn runs**. The job stays `DEBITED` (read as `queued`) until `sweep_stuck_jobs` refunds it, 15 to 25 minutes later |

So a replay says a job exists. It does not say the reply ran, or how it ended. A refunded first copy left the message in
neither the chat nor the box, and a warning was removed with no turn asked about.

**A stream that ends with no `done`.** The server writes `done` last on every path that ends a turn. A reply stream that
ends cleanly without one was cut somewhere between the server and the browser. `sendTurn` resolved as for a finished
reply: the images were cleared, the chat was read again (often before the turn was saved, so without it) and nothing was
said, though Credits were debited at `start`.

## Decision

Both end as a request that got no answer and whose job the server named (amendment 13): **the turn is looked for by that
job, at once**. The job is the replay answer's `job_id`, or the `job_id` that came with `start`.

- `sendTurn` hands on the job of a replay (`{ replay: true, job }`), taking only a job id as the server makes them. It
  resolves `{ replay: false }` only once `done` has been handed on. A stream that ends without `done` raises
  `send_unanswered`, as one that breaks does.
- `send()`, on a replay: the button says Checking and the job is looked for (3.5 seconds, the look of amendment 10). No
  send is asked about by its key, and none is closed: the answer already named the job.
- A turn that settles within the look ends through the branch for a stream that broke after `start`, unchanged.
- A replay that is not settled when the look ends, or that named no job, ends as amendment 13's third row: the message
  goes back with the warning, kept by the send's key.
- A stream with no `done` reaches the branch for a stream that broke after `start` by itself: `start` had come.
- In that branch a look that goes wrong (a chat read in a shape it does not know) now counts as not settled, so the send
  ends with the warning. It used to reject with nothing said and nothing stored. A replay has the same guard.

| What the look finds | Words on screen and after a reload | The text | A chat made for the message | Attached images | A warning kept for the message before |
|---|---|---|---|---|---|
| Failed and refunded, nothing stored | "The connection dropped before the reply finished. Nothing was saved and no Credits were used. Your message is back in the box." | Back in the box | Deleted: nothing can be saved to it now | Stay with the message | Stays kept. Both are said, this one first |
| Saved, and the chat is read again | "The connection dropped before the reply finished. This chat shows what was saved and the Credits it used." | Not given back: it is in the chat | Stays, and shows the turn | Cleared | Forgotten: the chat was read again and shows each saved reply with its price |
| Charged, and it could not be stored | "We could not save that reply to the chat. You received it, so its Credits were used." | Not given back | Stays | Cleared | This warning takes its place |
| Not settled, after a replay (nothing of the reply was ever on screen), or a replay that named no job | "The connection dropped before the reply finished. It may have used Credits. Check this chat before you send again." kept by the send's key with a mark of the text | Back in the box, beside the warning. If the chat page was left, stored in its chat's draft | Stays | Stay, while its chat is on screen | This warning takes its place and stands for both sends |
| Not settled, after a stream with no `done` | The same words, kept by the job | Not given back. What arrived stays on screen | Stays | Cleared | This warning takes its place and stands for both turns |

The last two rows are settled when the chat is next opened, as every kept warning is (amendments 11 and 13): saved leaves
"...This chat shows what was saved and the Credits it used." and empties a box that still holds exactly that message;
refunded removes the warning and leaves the text.

**Words.** None are new. The three dropped-connection notices and `reply_not_saved` are used as they stand. For a replay
they are true in the common case (a connection did drop, which is why the browser sent the request again).

**A replay on a first and only request** (the second row of the first table). The screen cannot tell it from a first
copy that is still running: a job exists and is not settled. So it ends as "not settled": the message goes back with the
warning. From the sweep on, opening the chat removes the warning and leaves the text. Until then the warning overstates
it: no Credits can be used. Sending the message again meanwhile is charged once, as a new send, and a saved reply
removes the warning. Saying something truer there needs the server: see "Left".

## Consequences

- A replay is no longer silent, and no longer forgets a warning. A warning kept for the message before goes only when
  this message was found saved (the chat is read again and shows what was charged) or keeps a warning of its own, which
  then stands for both.
- A reply whose stream is cut cleanly after `start` now shows Checking for up to 3.5 seconds and then says what was kept.
- `sendTurn` no longer counts events. `done` alone ends a reply. A reply whose `done` frame was lost or could not be read
  is looked for by its job, and ends as saved or refunded on what the job says.
- The look for a job the server named is one function in `send()` (`lookFor`), used by amendment 13's ending and by a
  replay. The ask by key is still made in two places only (Stop before `start`, a request that got no answer).
- A replay that is not settled is kept by the send's key, so its warning is settled through `POST /api/v1/chat/sends/close`
  (amendment 11). With that route off it would stay until a later message is saved, as amendment 13's does.
- Tests: `tests/chatSendReplay.test.mjs` runs `sendTurn` and `send()` together, with only the network and the look faked.
  Earlier assertions that pinned the old replay, or the lines this changes, are changed on purpose, each with the reason
  beside it (`tests/chatSendHome.test.mjs`, `tests/chatSendRefused.test.mjs`, `tests/chatSendUnanswered.test.mjs`,
  `tests/chatStop.test.mjs`).

## Not chosen

- **Asking by the key on a replay.** The answer already names the job, and asking closes nothing that needs closing.
- **Leaving an unsettled replay on screen as sent, with a warning by its job.** A refund then left the message in neither
  the chat nor the box. Amendment 13 made the same choice for the same reason.
- **New words for a replay.** A page on older code reads a code it does not know as an ordinary notice and forgets it at
  the next send.
- **Treating a missing `done` as an error only when no text had arrived.** Text on screen does not say the turn was saved.

## Left

- **The free job that is made and never run** answers `replay` and leaves a job no turn will ever run for up to 25 minutes.
  The turn could run that job itself, or answer in a way the screen can read as "nothing ran". Server change.
- **`debit_failed` and `provider_submit_failed`** are still refusals: they come after the debit, and the refund or the sweep
  returns the Credits. The screen says "That didn't work. Try again." with no word about Credits.
- **A turn that broke after `start`, was not settled, and is refunded later** (a Worker cut mid-reply is refunded by the sweep
  after 120 minutes): the warning is removed when the chat is opened, and the message is then in neither the chat nor the
  box. This is the branch for a stream that broke, as it was; a stream with no `done` now reaches it too.
- **Found saved, but the chat could not be read again** (still offline): the warning kept is this turn's alone. One kept for
  the message before is forgotten before the read is tried, so its turn is no longer listed. The branch for a stream that
  broke has always done this.
- **Stop's own look is not guarded**: if it goes wrong, the send still rejects with nothing said.
- **A free job left failed without its zero refund is never swept** (the sweep takes failed jobs only when they cost
  Credits), so a warning kept for it never settles. Server side, and older than this change.
- Text typed while the button says Checking is replaced when the message is given back. Nothing is stored during the look,
  so a page reloaded in those 3.5 seconds finds neither the text nor a warning. A replay used to leave neither at once.
