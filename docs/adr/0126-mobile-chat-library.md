# ADR-0126 — Mobile: chat personas and folders

**Status:** Proposed 2026-10-18
**Related:** [ADR-0067](0067-chat.md) (chat), [ADR-0072](0072-chat-personas.md) (personas), [ADR-0106](0106-mobile-app.md) (the app)

## Context

The app can already pick a model, chat and stream a reply. The web also has personas (saved instructions with a default model) and folders for chats. This slice adds both to the app. Nothing is priced or charged by this slice: a persona and a folder never cost credits.

## Decisions

1. **Personas** (`/chat/personas`, `/chat/persona/[id]`): list, create, edit, delete. `GET /api/v1/chat/personas` answers `enabled: false` while the server flag is off; the app then says personas are not available yet and shows nothing else. Limits mirror the server (name 60, instructions 4000 characters and 1000 estimated tokens); the server stays the authority.
2. **Start from a persona** on the New chat screen. The server has no single call for this, so the app makes the chat on the persona's model (or the first available model when the persona leaves it open) and then sets the persona's instructions (`PATCH /chat/threads/:id {system_prompt}`). If the second step fails the half-made chat is deleted, so no empty chat is left behind.
3. **Thinking and web search** are saved with a persona. The web applies them as per-message options with an extra credit price (its chat settings panel), which the app does not have yet, so the app shows the switches, saves them, and says it does not apply them to a chat. Pricing them in the app is a later slice.
4. **Folders** (`/chat/folders`): list with counts, create, rename, delete (its chats stay, with no folder). The chat list gets a filter (All, No folder, and each folder). A chat is filed from its header (`Folder`, `/chat/move`) with `PATCH /chat/threads/:id {folder_id}` alone, `null` taking it out.
5. Deleting a persona or folder asks first. The folder limit answer (`FOLDER_LIMIT`) is worded without a number, since the response carries none.
6. Personas and folders are extras: if either fails to load, the chat list and New chat still work.
7. No server change, no dependency, no flag.

## Not decided here

- Applying a persona's thinking and web options to a chat; pinning or renaming a chat; searching chats.

## Consequences

- Starting a chat from a persona is two calls, so a person on a bad connection can see a short delay, and a failure after the first call rolls the chat back. An atomic `persona_id` on create would remove both.
