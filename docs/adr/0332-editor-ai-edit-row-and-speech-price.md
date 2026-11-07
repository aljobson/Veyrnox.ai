# ADR-0332: A dedicated 3-Credit row for the editor AI edit, and Speech Cut at 3 Credits

- **Status**: Proposed 2026-11-07; the owner chose the price (3 Credits for both) and this design (option A) in chat.
- **Related**: ADR-0067 (chat replies are priced from the catalog), ADR-0330 (typed AI edit), ADR-0331 (speech cut), ADR-0014 (floor pricing).

## Decision

1. **AI edit** keeps using a catalog text row for its price (the app never computes one), but a *dedicated* row:
   `editor-ai-edit-gemini-3.8-flash`, the same model as `chat-gemini-3.8-flash` (`google/gemini-3.8-flash`), 3 Credits, cost $0.0222
   (the same worst case; the ADR-0014 floor is 2). The shared chat row is not repriced, so ordinary chat is unchanged.
2. **Chat must not see it.** Ids starting `editor-` are editor-only: `/api/v1/chat/models` filters them in the query, thread creation
   refuses them (`model_unavailable`, 404), and a chat turn on one answers `model_unavailable` (409) before any money moves
   (`editorOnlyModel` in `lib/chat.js`). Tests: `tests/editorOnlyChatModels.test.mjs`, `tests/chatTurn.test.mjs`.
3. **Speech Cut** is activated at **3 Credits per clip up to 60 s** (replacing the 2-Credit proposal in ADR-0331); cost $0.008, floor 1.
4. Migration `0453` does both with exact row-count assertions and is replay-safe. It turns nothing on for users:
   the switches (`aiEdit`, `aiEditModel`, `speechCut`) are keys inside `EDITOR_RUNTIME_FLAGS` and are set in a separate change,
   because the Worker is at Cloudflare's 128 text-binding cap and these add no binding.

## Rollback

Remove the keys from `EDITOR_RUNTIME_FLAGS` (absent = off). To withdraw a row: `UPDATE public.model_catalog SET active=false WHERE id IN ('editor-ai-edit-gemini-3.8-flash','elevenlabs-scribe-v2');`.

## Not decided here

Whether Speech Cut's unprobed cases (15/60 s latency, failure webhook, music-only, multi-speaker) and scribe-v2 billing hold up; the owner accepted that risk before enabling.
