# ADR-0072 — Agents and Trends: what to build first, and what to leave alone

- **Status**: **Proposed 2026-10-05**. Nothing is built. The owner's answers (recommendations marked) are at the end.
- **Related**: ADR-0067 (chat replies are jobs), ADR-0069 (free allowance), ADR-0070 (Deep research), ADR-0068 (image
  attachments), CLAUDE.md "Money & billing", "Object storage", "Web security"

## Context

Two Syntx sections remain unmatched (read from its public pages on 2026-10-05):

- **Agents**: "create and communicate with your personal agent. Agents memorize instructions, speech manner, study on your
  data, know how to look on the Internet, issue files, launch code, work in the neural networks GPT Image, Veo 3.1, Suno."
- **Trends**: "get inspired, add your own perspective, and turn ready-to-use ideas into something uniquely yours", a gallery
  filtered by All, New, Featuring You, Popular, Anime, Cartoons, Movies, Fantasy, Fashion, Products, Realistic.

What Veyrnox.ai already has: a presets gallery with categories (`ALL, NEW, YOUR PHOTO, CINEMATIC, ANIME, FASHION, PRODUCTS,
VFX, UGC, ADS`, 18 hand-written presets that open the studio with a model and prompt), and a chat with per-chat Instructions,
Web search, image attachments, and Deep research accepted (ADR-0070). So **Trends is mostly a sort and a remix away**, while
**Agents is six different products** bundled under one word, three of which are security-heavy.

## Decision (proposed)

### Trends: extend the presets gallery, publish nothing user-made in v1

1. Add the missing categories (Cartoons, Movies, Fantasy, Realistic) and a **Popular** sort. "Featuring You" is the existing
   `YOUR PHOTO` category renamed in the UI only.
2. **Popular** comes from a counter: when a studio generation starts from a preset, the job records the preset id in `inputs`
   (already stored, no new table), and a daily definer function counts jobs per preset over 30 days. It returns counts only, never
   users or prompts. A preset needs at least 20 starts in the window before it can rank, so a handful of accounts cannot
   push one up.
3. **Remix** is what a preset already does: it opens the studio with the model, length, aspect and prompt filled, editable.
   Nothing new is needed beyond a clearer button.
4. **No user-published trends in v1.** Showing other people's generations is a moderation, rights and privacy surface (Cinema
   already has a review queue and a Rights Declaration for exactly that; reuse it later, do not rebuild it here).

### Agents: build the smallest useful piece, defer the dangerous ones

Syntx's six claims, split by what each costs us:

| Claim | Verdict |
|---|---|
| Memorizes instructions and speech manner | **Build (v1): Personas.** A saved, named instruction set, plus a default model and options, that can start any chat. Chat already stores Instructions per chat (4,000 characters); a Persona is that, reusable. No new money path. |
| Looks on the Internet | **Already built** as Web search; Deep research is accepted (ADR-0070). |
| Works in the image, video and music models | **Defer to v2, and only through existing priced jobs.** A tool call from chat would create a normal `/api/v1/generations` job, debited at the catalog price, with the price shown and confirmed before it runs. Never a way to spend Credits without an explicit confirm. |
| Issues files | **Defer.** Needs a safe output path (R2 key rules, size limits, malware scan). Not in v1 or v2. |
| Launches code | **Not planned.** Running user-influenced code is a sandbox product of its own; the risk is out of proportion to the value for a generation platform. |
| Studies on your data | **Not planned for now.** Storing and indexing a user's documents for retrieval is a privacy, retention and cost commitment (Terms, deletion, per-account storage caps). Revisit only with a concrete use case. |

### v1 Personas, concretely

- One table `chat_personas (id, user_id, name, instructions, default_model_id, thinking, web, created_at)`, RLS enabled and
  forced, service-role definer functions only, a cap of 20 per account, instructions up to the existing 4,000-character limit.
- Starting a chat from a persona copies its instructions and options onto the new thread. Editing a persona never changes
  existing chats. Nothing about a persona is priced: a reply costs what it costs today.
- Behind `PERSONAS_ENABLED` (`"false"` in production), staging first. No migration touches the ledger.

## Why not copy Syntx's Agents wholesale

Four of its six claims (files, code, your data, spend on media) each need their own ADR for security, retention or money. Doing them
as one "Agents" feature would make the first release the riskiest thing we ship. Splitting them keeps each one reviewable and
refundable, in line with how Web search, images and Deep research were each priced and shipped separately.

## Consequences

- Trends v1 is small: a category list, one counter function, a sort, one test file; no migration if the preset id is already in
  `inputs`, one small migration if it has to be added.
- Personas v1 is one table and a small UI on the chat screen; about the size of drafts and stars plus one migration.
- The "Agents" name stays out of the product until it means more than saved instructions; call it Personas.

## Open questions for the owner (recommendation first)

1. Trends: **extend the gallery with the missing categories and a Popular sort now; no user-published trends in v1.**
2. Popular needs how many starts to rank: **20 in 30 days.**
3. Agents: **build Personas only; defer media tool calls to v2; do not plan files, code or your-data retrieval.**
4. Name: **"Personas"**, not "Agents".
5. Persona cap per account: **20.**
