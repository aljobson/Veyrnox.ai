# ADR-0117 — Mobile: Auto Short in Create

**Status:** Proposed 2026-10-18
**Related:** [ADR-0029](0029-auto-short-composite-jobs.md) (Auto Short: one priced job), [ADR-0114](0114-mobile-create-with-files.md), [ADR-0106](0106-mobile-app.md), roadmap slice M10b

## Context

`auto-short-32s` is a normal catalog row (110 Credits, text-to-video) that takes one text input, `topic`, up to 200 characters. The server runs the script, scenes and voice as one job and charges once (ADR-0029). It is in the live catalog but the app hid it, because the app only offered models that take a `prompt` or a required file.

## Decisions

1. **No server change, no dependency.** It is the same `POST /api/v1/generations` as any other model.
2. **One text input, by key.** A model's text input is `prompt`, or `topic` for Auto Short. The form reads which one the catalog declares and its length limit (200 for a topic, 2000 otherwise), and sends the text under that key. The video agent's `brief` is not included: it needs a plan and approval first and gets its own screen.
3. **A topic is required.** Auto Short has no file, so the text is required, as for any text-to-video model.
4. **Price.** The catalog price is shown as for every model; the app never adds up steps. The server refuses a price mismatch before any debit.
5. **A refused topic.** The server answers `topic_refused` (422) when the script writer declines a topic. The app says the topic was not accepted, to try different words, and that nothing was charged.
6. **Consent** is sent only when files are uploaded (ADR-0114). Auto Short has none, so none is sent.

## Not decided here

- Progress of the steps inside the job; the job screen shows the same stages as for any job.
- The plan-and-approve video agent (next slice).

## Consequences

- Auto Short appears under Video in Create for every signed-in account.
- No new native module, so no new store build for this change alone.
