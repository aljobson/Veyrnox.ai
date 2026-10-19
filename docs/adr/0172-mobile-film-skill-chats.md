# ADR-0172: Mobile Film skill chats (parity plan P3)

**Status:** Proposed 2026-10-19. Completes the Studio skills picker of ADR-0167 with the web's seven Film skills.

## Decision

- The New chat screen gains a **Film** group: Setup, Studio init, Breakdown, Reference boards, Asset passports, Stress tests
  and Shot prompts, in the web's stage order. Wording is copied from `app/veyrnox/_lib/filmStudioAssistants.js`.
- Each starts like any skill: a chat on the cheapest image-reading model whose instructions are the preamble, the skill
  and the live model list (`PATCH chat/threads/:id { system_prompt }`), within the 4000-character limit (the longest
  body is 843 characters). Replies are priced as in any chat; nothing is made or locked.
- Film Studio itself is on the web only. The group says so in words: these chats help write what it needs and never make,
  approve or lock anything.

## Not proved

Unit tests (presence, order, fit within the limit with 400 models). No device run. How well a film chat works without
the web's Film Studio files beside it was not tested.

## Consequences

No new routes, flags, dependencies or server changes.
