# ADR-0073 — Studio skills: built-in assistants in LLM Chat that prepare a job, never run it

- **Status**: **Proposed 2026-10-06.** The owner accepts it by merging. It builds the "Build (v1)" half of ADR-0072's Agents split without
  its deferred parts.
- **Related**: ADR-0072 (Agents and Trends: Personas and the deferred tool calls), ADR-0067 (chat replies are jobs), ADR-0068 (image
  attachments, amendment 2: Library images), CLAUDE.md "Money & billing"

## Context

The owner wants assistants available for making and editing content in the Studio: a visible list, ready to use, that helps with prompts,
model choice, editing a photo, animating it, and planning a sequence. ADR-0072 deferred anything that lets chat start a generation, because
a model-triggered spend is the dangerous part. Everything else an assistant does is words.

## Decision

1. **A skill is built-in instructions, started like a Persona.** Choosing one copies its instructions onto a chat that has not started
   (the existing 4,000-character Instructions) and picks a default model. No table, no migration, no flag, and it never touches a chat
   that exists. The skills are in `app/veyrnox/_lib/studioSkills.js`: Prompt writer, Model picker, Fix this photo, Edit with words, Bring it
   to life, Add sound, Storyboard, Fix my prompt, in three groups (Make, Edit, Plan).
2. **They never make anything and never spend Credits.** A skill ends with a **Studio draft**: a fenced `studio` block holding a model id and
   a prompt (and optionally an aspect ratio). The chat turns it into an **Open in Studio** card. Opening it fills the Studio's prompt through
   the existing sessionStorage hand-off (`writeStudioDraft`), and only the person's own press of Generate there starts a job, at the catalog
   price, with the usual refund. The assistant has no tool, no key and no path to `/api/v1/generations`.
3. **A draft is checked, not trusted.** `parseStudioDrafts` accepts a block only if its model is in the live Studio catalog, open (not gated)
   and not a Library-only editor or Auto Short; the prompt is non-empty and cut at 2,000 characters; an aspect is kept only if that model takes it;
   at most six drafts per reply; every other field is dropped. The price on the card is the catalog's, never the text's. A hostile or confused
   reply can therefore offer nothing the Studio would not already sell.
4. **The model list is live.** The instructions end with `id|kind|Credits per generation` for each open Studio model, built from the catalog when
   the skill is chosen and cut by whole lines to stay under the Instructions limit. No skill text hard-codes a price (a test pins this).
5. **Cost.** A skill is an ordinary chat reply on GPT-6 Luna, 1 Credit, which reads images, so "Fix this photo" and "Bring it to life" can look
   at a Library image attached with ADR-0068 amendment 2. The instructions ride on every reply inside the existing worst-case costing
   (Instructions up to 4,000 characters, history capped at 24,000).
6. **Where they are.** On the empty chat, grouped, under "Studio skills"; a chip shows the skill in use and removes it; and the Studio's prompt
   box links to Prompt writer, Fix my prompt, Model picker and all skills (`/app/chat?skill=<id>`).

## Not in this ADR

- A model starting a generation by itself, or queuing several: ADR-0072's deferred v2, with its own confirm step.
- Skills that run code, make files or read the person's documents: not planned (ADR-0072).
- Video input: chat reads images only, so the video skills (Add sound) work from a description.
- Passing a Library image into the Studio from a draft: the card says to choose it with From library there.

## Consequences

- No new access path, no database change, and the money rules are untouched.
- A skill's quality is the model's: it can write a poor prompt, but not charge for it.
- Adding a skill is adding an entry and a test, and the 4,000-character test covers the catalog growing.
