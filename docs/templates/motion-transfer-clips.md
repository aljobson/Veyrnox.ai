# Motion-transfer driving clips (ADR-0269)

Every driving clip is made by us. We never download, trace, re-film or re-time
another service's reference video, and we do not copy a named viral or
copyrighted choreography (game emotes, music-video routines). Moves are generic
or invented for us.

## How we make a clip

Two routes, chosen per concept (column "Route" below):

- **Generate (G).** Text-to-video on **staging** with our own prompt (Kling 3.0
  text-to-video or Veo). One adult, plain clothing, uncluttered background,
  whole body visible, no logos, no text. Supplier terms give us the output.
  About $0.56 per 5 s attempt; budget 3 attempts per clip, so about $35 for 20
  clips. Every run needs the owner's word first.
- **Film (F).** For timed routines a generator cannot hold steady (duo dances,
  balance tricks). A performer we hire or a team member, signed release that
  covers use as an AI motion reference and commercial use, phone at 1080x1920,
  tripod or one planned camera move, plain background.

Every clip, either route:

- Exactly 5.0 s or 10.0 s, 1080x1920, 30 fps, H.264, no audio track
  (`ffmpeg -t 5 -an`). The length sets the price, so it is checked by a test.
- One performer (two for duo concepts), whole body or upper body visible,
  head never cut off or covered, nothing crossing in front of them.
- A camera move only in clips marked `image` orientation, and only one move.
- Stored privately in R2 at `motion/driving/<template-id>.mp4`; fal receives a
  15-minute presigned URL. Not in `public/`.
- Preview: one result made on staging from a photo of a consenting team member
  or a generated person, saved as `public/showcase/motion-<template-id>.mp4`
  and `.jpg`, with our own licensed music added in the preview only.
- A provenance line in `lib/motionClips.js`: route, date, prompt or
  release reference.

## Twenty concepts

Mode M = motion transfer (v1). Mode R = replace (phase 2). Orientation `image`
follows the clip's camera move (10 s max); `video` follows the performer's body
orientation.

| # | Template id | Concept | Length | Mode | Orientation | Route |
|---|---|---|---|---|---|---|
| 1 | `motion-city-stride` | Confident walk toward a slowly retreating camera | 5 s | M | image | G |
| 2 | `motion-runway-turn` | Runway walk, pause, half turn, look back | 10 s | M | video | G |
| 3 | `motion-slowmo-hair-walk` | Slow-motion walk, wind in hair and clothes | 5 s | M | image | G |
| 4 | `motion-orbit-reveal` | Standing pose while the camera orbits 180° | 5 s | M | image | G |
| 5 | `motion-push-in-glance` | Still, then a sharp glance to camera on a push-in | 5 s | M | image | G |
| 6 | `motion-two-step` | Simple two-step side groove | 5 s | M | video | F |
| 7 | `motion-shoulder-bounce` | Upper-body shoulder bounce and finger point | 5 s | M | video | G |
| 8 | `motion-arm-wave-routine` | Eight-count arm wave and pose (our own routine) | 10 s | M | video | F |
| 9 | `motion-spin-and-freeze` | One spin into a held freeze pose | 5 s | M | video | F |
| 10 | `motion-moonwalk-glide` | Backward glide on a flat floor (generic, no signature moves) | 5 s | M | video | F |
| 11 | `motion-parkour-vault` | Run, vault a low wall, land | 5 s | M | video | G |
| 12 | `motion-rooftop-jump` | Run-up and gap jump, camera tracking sideways | 5 s | M | image | G |
| 13 | `motion-waiter-balance` | Walking while balancing a tray on one hand, a wobble and save | 10 s | M | video | F |
| 14 | `motion-skate-glide` | Gliding forward as if on skates, arms out | 5 s | M | image | G |
| 15 | `motion-boxing-combo` | Shadow-boxing jab, cross, slip | 5 s | M | video | F |
| 16 | `motion-duo-dance` | Two people, mirrored side-step routine | 10 s | M | video | F |
| 17 | `motion-slow-dance` | Two people, slow sway and a turn under the arm | 10 s | M | video | F |
| 18 | `motion-world-shift-walk` | Steady walk toward camera; the background changes mid-clip | 10 s | M | image | G |
| 19 | `motion-hero-landing` | Drop from above into a crouched landing, camera tilts up | 5 s | M | image | G |
| 20 | `motion-stage-swap` | Performer on a lit stage, replaced by the user (replace mode) | 10 s | R | — | F |

Notes:

- #18: the background change is in the driving clip itself (we generate a clip
  whose set changes). Whether Kling keeps it or holds the photo's background is
  a probe question; with `image` orientation the photo sets the scene, so this
  may need replace mode instead.
- #16, #17 need two people in the user's photo. Kling's two-person behaviour is
  unverified; these ship after a probe.
- Pet and product versions (a dog doing #1, a product doing #4) wait for the
  pet probe in ADR-0269 decision 10.

## Order of work

1. Owner approves ADR-0269 and the probe spend.
2. Make clips #1, #4, #11 first (generated, cheapest) and run the probes on them.
3. Film #6, #8, #13 with a signed release.
4. The rest in batches of five, each previewed on staging before it is added to
   the registry.
