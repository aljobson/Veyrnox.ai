# Chat: privacy notice wording (draft for the owner, 2026-10-05)

**Not applied.** The live notice is `app/legal/privacy/page.js`; this is the wording I propose adding, for you (or whoever reviews
legal text) to accept, change or reject. Every factual claim below was checked against the code on 2026-10-05; the notes after each
say where, so the wording can be corrected if the behaviour changes.

## Proposed changes to the notice

**1. "What we collect", the Usage data line.** Now: "the prompts and reference files you submit, the generations you request, ...".

> **Usage data** — the prompts, chat messages and reference files or images you submit, the generations and chat replies you request,
> credit balance and ledger history, and job status.

**2. "Retention", three new bullets.**

> - Chat conversations are kept until you delete them. Deleting a chat removes it and its messages from our database straight away.
>   [Owner to confirm: our database backups may hold it for a short time longer.]
> - Images you attach to a chat are kept in our storage only long enough to answer, and are deleted within 24 hours.
> - A chat reply's record in your credit history (which model, which options, the Credits charged) is kept like any other ledger
>   record. It never contains the text of your messages.

**3. "Sharing", the AI model providers sentence.**

> When you chat, your messages, any images you attach, and (if you switch on Web search) your question are sent to the AI model
> provider you chose, through our model gateway, so it can reply. We ask the gateway to use only providers that do not store your
> content or use it to train models. Web search sends your question to a search service as well. These providers process data
> outside the United Kingdom and the EEA, as described above.

## What each claim rests on

| Claim | Where it comes from |
|---|---|
| Chats are kept until deleted | `chat_threads` and `chat_messages` have no expiry; nothing purges them. Account deletion removes them (`ON DELETE CASCADE` from `users`). |
| Deleting a chat removes it now | Migration 0202. **Before 0202 this was untrue**: delete only set `deleted_at` and the text stayed indefinitely. Do not publish the sentence until 0202 is applied to production. |
| Backups | Not something the code can tell us. Supabase keeps backups for a period set by your plan; confirm it and adjust or drop the bracket. |
| Images deleted within 24 hours | `UPLOAD_MAX_AGE_HOURS = 24` in `lib/uploadSource.js`, and the chat job records `inputs.source_keys` so the upload sweeper deletes them soon after the reply (ADR-0068). |
| The ledger never holds message text | `jobs.inputs` for a chat holds `kind`, `thread_id`, `options` and, for images, type, size and the storage key; message text lives only in `chat_messages` (`lib/chatTurn.js`, tested). |
| "Providers that do not store or train" | Every request sends `provider: { data_collection: "deny" }` (`packages/adapters/openrouterChat.js`). All ten catalog models answered under it in a live check on 2026-10-05. It is a routing instruction to OpenRouter; **it is only as good as OpenRouter's own enforcement and each provider's policy**, so the wording says "we ask", not "we guarantee". |
| Web search sends the question to a search service | OpenRouter's web plugin (`plugins: [{ id: "web" }]`) fetches pages for the query. |

## Also worth checking before launch (outside the code)

- OpenRouter account privacy settings for the capped chat key: choose the strictest data-collection and logging options that suit you.
- Whether the notice should name OpenRouter as a processor, as it plans to name BytePlus.
