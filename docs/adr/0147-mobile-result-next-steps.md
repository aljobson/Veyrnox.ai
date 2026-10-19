# ADR-0147: Mobile result screen next steps (parity plan N5)

**Status:** Proposed 2026-10-19. Second slice of the parity plan's Track B, after ADR-0146.

## Context

A finished creation ended at Save, Share, Report and Delete. Nothing led onward, so a person who made a video
had no way to edit it, post it or make another without going back through Library.

## Decision

The result screen shows a "What next?" block above Save and Share. Each step appears only when it can honour the
file in front of the person:

| Step | Shown for | Opens | What is carried |
|------|-----------|-------|-----------------|
| Edit this video | video | Quick edit (`/edit`) | `jobId`: the video is added and its length read, as if chosen from the Library |
| Publish this | image or video | the composer (`/publish/compose`) | `jobId`: the creation is already selected (the composer already took this) |
| Make another | any, when the model is known | Create (`/create/[modelId]`) | the model |

- Audio gets Make another only: the composer takes images and videos, and Quick edit takes videos.
- The steps open above the result, so Back returns to it. The action area scrolls, so the extra buttons cannot
  push Save and Share off a small screen or large text.
- Quick edit accepts only an id of the expected shape. A creation older than the first Library page still
  works, because adding a clip needs only the job id; the server checks it when the price is quoted.
- Four new English strings (`job.next.*`) are listed in `docs/mobile/I18N-NEW-KEYS.md` for the localization
  process; no machine translation.

## Gap for the server

`GET /api/v1/jobs/:id` returns no prompt, so **Make another reopens Create on the same model with an empty
prompt** (and no remembered length). Carrying the prompt over needs the route to return it for the owner; that
is a server change and is not made here.

## Not proved

- VoiceOver and TalkBack on the new buttons (steps as in ADR-0133).
- Android, and a real phone. Checked on the iPhone 17 Pro simulator against the mock server: a video result
  opens Quick edit with the video added, the composer with it selected, and Create on the same model; an image
  result hides Edit.
- A real Publish round trip: the composer was not submitted.

## Consequences

No new routes, dependencies, flags or server calls.
