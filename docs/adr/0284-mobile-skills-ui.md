# ADR-0284: Studio skills page on the phone

Status: Accepted

The phone Skills page follows the web presentation: a centred hero, Workflows
first, grouped icon cards, and a details sheet before starting a chat. It reuses
PR 1713's icon tiles, with small and extra-large sizes and workflow mappings.
The reserved PNG preparation is unnecessary while those tiles exist.

The owner decision on 2026-10-28, in the owner's words: "multi-select".
The page therefore retains PR 1709's selection of up to four skills in pick
order. Each card has a separate checkbox, the sheet offers Add/Remove, and a
sticky Start chat footer starts the ordered set. This deliberately differs from
web `/app/skills`. Opening details never selects or creates anything; Use this
skill starts only that skill, leaving the page selection intact. Workflows
remain single-start and do not read or alter the selection.

A catalog failure prevents thread creation. A failed instructions PATCH deletes
the newly created thread best-effort. The existing start-time fit check remains.
Prices come from the selected chat model; generation is a separate action.

Oddling continuity shares its instruction body with the existing hand-off code.
It is an ordinary selectable skill on this page and in ordinary chats, as on the
web. Only a hand-off with the Oddling preamble and canon locks it first and
unremovable; the existing three-skill allowlist remains unchanged. Oddling
series shows all four steps and still starts in Oddling Studio.

New chat requests models and personas together. Once models arrive it waits up
to 1500 ms for personas: a nonempty result offers the persona chooser, Blank
chat, and model choices. Empty, failed or late personas retain the default-model
auto-start exactly once. Unmounted or replaced screens discard late results.

Implementation constraints: the footer is a local component in `skills.tsx`
because the frozen file whitelist does not permit a separate footer file.
Existing large translation catalogs retain their structure; changed UI and logic
files remain under 500 lines. ADR 0284 is the next free number in the supplied
base; checking open PRs was blocked by network access and needs host confirmation.
