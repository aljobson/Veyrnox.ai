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
- `send()`, on a replay: the button says Checking and the job is looked for, with the look made after Stop and after a
  stream that broke (about 3 seconds, 3.5 at most). No send is asked about by its key, and none is closed: the answer
  already named the job.
- A turn that settles within the look ends through the branch for a stream that broke after `start`, unchanged.
- A replay that is not settled when the look ends, or that named no job, ends as amendment 13's third row: the message
  goes back with the warning, kept by the send's key.
- A stream with no `done` reaches the branch for a stream that broke after `start` by itself when `start` had come. If
  `start` itself was lost or could not be read, the send is asked about by its key, as amendment 13 does.
- In that branch a look that goes wrong (a chat read in a shape it does not know) now counts as not settled, so the send
  ends with the warning. It used to reject with nothing said and nothing stored. A replay has the same guard.

What each outcome does, while the chat the message was sent in is on screen:

| What the look finds | Words | The text | A chat made for the message | Attached images | A warning kept for the message before |
|---|---|---|---|---|---|
| The job failed and nothing was stored: the Credits come back | "The connection dropped before the reply finished. Nothing was saved and no Credits were used. Your message is back in the box." | Back in the box | Deleted: nothing can be saved to it now | Stay with the message | Stays kept, and is what a reload shows. On screen both are said, this one first |
| Saved, and the chat is read again | "The connection dropped before the reply finished. This chat shows what was saved and the Credits it used." | Not given back: it is in the chat | Stays, and shows the turn | Cleared | Forgotten: the chat was read again and shows each saved reply with its price |
| Charged, and it could not be stored | "We could not save that reply to the chat. You received it, so its Credits were used." | Not given back | Stays | Cleared | This warning takes its place. It lists no turn: it is settled |
| Not settled, after a replay (nothing of the reply was ever on screen), or a replay that named no job | "The connection dropped before the reply finished. It may have used Credits. Check this chat before you send again." kept by the send's key with a mark of the text | Back in the box, beside the warning | Stays | Stay with the message | This warning takes its place and stands for both sends |
| Not settled, after a stream with no `done` | The same words, kept by the job | Not given back. What arrived stays on screen | Stays | Cleared | This warning takes its place and stands for both turns |

Each notice is kept with its chat, so a reload shows it, except in the first row beside an earlier warning. When the
person is in another chat or has left the chat page, nothing is said there: what is kept waits in the message's own chat,
given-back text is stored in that chat's draft, the images are cleared (they cannot wait), and a chat found saved is not
read again until it is opened (its notice says "shows what was saved", and a warning kept before is still forgotten).

When the chat is next opened, the last two rows are settled as every kept warning is (amendments 11 and 13):

- Kept by the key (a replay): saved leaves "...This chat shows what was saved and the Credits it used." and empties a box
  that still holds exactly that message. Refunded removes the warning and leaves the text.
- Kept by the job (a stream with no `done`): saved removes the warning and says nothing more, because the chat shows the
  reply and its price. Refunded removes the warning too: see "Left".

**Words.** None are new. The three dropped-connection notices are true for a replay in the common case (a connection did
drop, which is why the browser sent the request again). "You received it" in the third row is not true after a replay,
or after amendment 13's ending: nothing of that reply reached the screen. It takes the chat being deleted while the first
copy runs. See "Left".

**A replay on a first and only request** (the second row of the first table). The screen cannot tell it from a first
copy that is still running: a job exists and is not settled. So it ends as "not settled": the message goes back with the
warning. From the sweep on, opening the chat removes the warning and leaves the text. Until then the warning overstates
it: no Credits can be used. Sending the message again meanwhile is charged once, as a new send, and a saved reply
removes the warning. Saying something truer there needs the server: see "Left".

## Consequences

- A replay is no longer silent, and no longer forgets a warning with nothing known. A warning kept for the message
  before now goes only when this message was found saved or charged (the chat, read again now or when it is next opened,
  shows each saved reply with its price) or when this message keeps a warning of its own. A `connection_lost` kept for a
  turn that is not settled stands for both. Refunded leaves it kept.
- A reply whose stream is cut cleanly after `start` now shows Checking for up to 3.5 seconds and then says what was kept.
- `sendTurn` no longer counts events. `done` alone ends a reply. A reply whose `done` frame was lost or could not be read
  is looked for by its job, and ends as saved or refunded on what the job says.
- The look for a job the server named is one function in `send()` (`lookFor`), used by amendment 13's ending and by a
  replay. The ask by key is still made in two places only (Stop before `start`, a request that got no answer).
- A replay that is not settled is kept by the send's key, so its warning is settled through `POST /api/v1/chat/sends/close`
  (amendment 11). With that route off it would stay until a later message is saved, as amendment 13's does.
- Tests: `tests/chatSendReplay.test.mjs` runs `sendTurn` and `send()` together, with the screen and the network faked.
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
  It holds one free allowance until the sweep returns it, so the same message sent again meanwhile can cost Credits where
  the first send would have been free. The turn could run that job itself, or answer in a way the screen can read as
  "nothing ran". Server change.
- **`debit_failed` and `provider_submit_failed`** are still refusals: they come after the debit, and the refund or the sweep
  returns the Credits. For `debit_failed` the screen says "That didn't work. Try again." with no word about Credits. For
  `provider_submit_failed` it says "No Credits were used", which is true once its refund has landed.
- **"You received it, so its Credits were used."** is said for a reply that was charged and could not be stored, also when
  nothing of it reached the screen (a replay, amendment 13's ending). Words of its own would be new words.
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
