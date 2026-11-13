# ADR-0335 amendment S2b — Photo Studio live camera (web)

Status: implemented and dark. The route only exists while the `photoStudio` runtime flag is on; production leaves it absent (off). Enabling it is the owner's decision.

## Decision

Photo Studio gains a live camera mode so makeup, looks and 2D wigs can be tried in real time. Frames never leave the page: no recording, no upload, no analytics carrying image content, and the page never asks for audio. There is no video export in this slice.

## Security header (the reason this needs an ADR)

Production sends `Permissions-Policy: camera=(), microphone=(), geolocation=()` on every route. This amendment adds ONE rule in `next.config.mjs`: `/app/photo-studio/:path*` sends `camera=(self), microphone=(), geolocation=()`.

- Scope: that route only. Every other route, including the editor (microphone only) and Music Studio (microphone only), keeps `camera=()`. Microphone and geolocation stay denied everywhere. No cross-origin delegation and no `allow` attribute exists, so a frame cannot be granted the camera.
- Dark by default: with the flag off the route answers 404 (middleware and Worker), so the permission is unreachable.
- Rollback: delete the one rule. The camera is then denied everywhere again.
- The page CSP is unchanged. A `MediaStream` assigned to `video.srcObject` is not a fetched URL, so `media-src` is not involved; the browser proof runs under a stricter policy (`default-src 'none'`) to prove it.
- Verified through the built Worker by `scripts/probe-photo-studio-worker.mjs`: the Photo Studio page returns `camera=(self)` when served, and `/`, `/app`, `/pricing`, `/api/status` and `/app/editor` never allow the camera.

## Navigation boundary (the header belongs to the document)

`Permissions-Policy` is applied to the document that was loaded, not to a client-side route. So the rule above only holds if Photo Studio is entered and left by a **full page load**:

- Entering: nothing in the app links to `/app/photo-studio` (it is reached by its address while the flag is on), so entry is always a document load that receives the header. Any future link must be a plain `<a href>`, never `next/link`.
- Leaving: Photo Studio renders the shared app navigation, which uses client-side links. `HardNavigation` (`_lib/liveEdit/hardNavigation.js`) turns every plain left-click on a same-origin link that leaves Photo Studio into `location.assign`, and reloads on back/forward when the new URL is outside it. Modified clicks, new-tab links, downloads and other origins are untouched (they already load a new document). As a catch-all for exits that are not link clicks (`router.push`, `redirect`), unmounting Photo Studio with the URL already outside it reloads the document. Known limit: a soft navigation INTO Photo Studio would not receive the header, which is why nothing links in. The next page is therefore served with its own `camera=()` header.

## Behaviour

- The camera starts only after the visitor presses **Start camera**, never on load. Front camera by default, `audio: false` always, ideal 1280×720 (max 1920×1080), 30 fps cap. If the camera cannot honour the preferred constraints it is retried once with a plain request, still without audio. A stream that somehow contains audio is stopped and refused.
- It stops on **Stop camera**, on leaving the page, on `pagehide`, and when the tab is hidden. The hidden-tab watcher is registered BEFORE the camera is requested and checks the current visibility immediately, so a tab hidden while the permission prompt is open never ends up holding a camera. Stop, a switch, Take photo, hide and a chosen photo all bump one operation generation, so a late continuation (a slow camera list, a slow capture) cannot restart the camera or replace a newer photo. A failure is terminal for its source generation. Every track is stopped and `video.srcObject` cleared. A camera that ends by itself (unplugged, revoked) is reported as its own state.
- Distinct, localized states for: permission denied by the visitor, blocked by the browser or page policy (`SecurityError`, where changing site settings may not help), no camera, camera in use, camera lost mid-session, unsupported or insecure context, and a generic failure.
- A visible live indicator and the sentence "Frames stay on this device. Nothing is recorded or uploaded, and there is no audio" are shown while the camera is on.
- The preview is mirrored with CSS only. **Take photo** captures the raw, un-mirrored frame (the live indicator says so; the preview alone is mirrored) and loads it through the normal photo path, keeping the look the visitor tuned, so hair recolour and the wig coverage hint work at full quality there.

## Live pipeline

The same WebGL2 renderer and the same Face Landmarker Worker (same immutable prefix, no model or Worker change) as a still photo.

- Rendering follows the video frame rate. Face landmarks come from the Worker with **one request in flight and latest-frame-wins**: while it is busy frames are dropped, never queued, so lag cannot accumulate.
- Landmarks are smoothed with the One-Euro filter. Switching face effects OFF is immediate and unthrottled (more than one face, tracker failure). A short dropout (`LIVE.holdMs`, 400 ms) keeps the last good face; after that effects switch off and the status says so. Both the hold and a stalled tracker (`LIVE.staleMs`, 1 s with no result) are enforced from the render clock, so a request that never returns cannot leave stale effects on screen.
- Face masks are the expensive part, so they are rebuilt at most every `LIVE.maskIntervalMs` (66 ms); drawing reuses them.
- **Hair recolour is not run live.** The segmentation model is about 16 MB, so live mode shows "Hair colour works on photos. Press Take photo to use it." The wig is drawn from landmarks only and the hair-coverage hint needs a photo.
- Worker input is the existing bounded bitmap (edge at most 384 px). The Worker runs in IMAGE mode per request; its pinned bytes and prefix are unchanged.

## Measured and not measured

The browser proof uses Chromium's fake camera with software WebGL. It measures and prints frame rate and landmark rate, but those numbers are **not representative of phones or laptops**, so the proof asserts only a low floor (at least 10 rendered frames and 5 landmark results in 3 s). Real-device latency, frame rate and heat are unmeasured. The fake camera shows no face, so makeup on a live frame is proven by a same-frame relation (makeup on versus off against synthetic landmarks) and not by a real face being tracked live.

## Limits

No video recording or export. Safari and iOS behaviour is untested here; the video is `muted` and `playsinline` as those browsers require. Rotation or a renegotiated stream rebuilds the renderer. Stickers are not drawn live (their controls are disabled and they are omitted from live rendering; they stay in the edit history for the photo). A stream that changes size (rotation) rebuilds the renderer and the preview refits. Glasses, hats, hands over the face and side angles degrade tracking as they do for photos.

## Carried over from the S5a inspection

The six wig SVGs (and the sticker SVGs) are **ungated public static assets**: they are reachable even with `photoStudio` off, which is harmless because they are owned, script-free artwork. A test pins that each wig SVG declares explicit `width` and `height`. A hold-to-compare redraw no longer announces "wig off" to screen readers, and a download that had to leave out a chosen wig (face lost, two faces, head turned away) now says so.
