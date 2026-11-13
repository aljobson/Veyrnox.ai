# ADR-0335 — S4 implementation appendix

Moved verbatim from the parent ADR to keep each file below 500 lines.
See [ADR-0335](0335-local-photo-studio.md) for shared decisions and S5a.

## S4 mobile amendment — offline still and short-clip frame editing

Status: Implemented dark; native qualification and owner release decision pending.

The mobile route `/live-edit` checks `PHOTO_STUDIO_ENABLED = false` itself,
including deep links. Create and Face Filters hide their entry points under the
same constant. No URL/storage override exists. Flag changes use the normal
release/OTA path. No native modules are added; S5/S8/S9 are excluded. The review amendment below
adds the explicitly authorized esbuild development dependency.
Metro does not expose `packages/`: `scripts/sync-live-edit.mjs` (under mobile)
copies six pure modules verbatim (including smoothing after review). Jest checks byte identity, exported tables and
all nine existing mobile looks. No root React/web runtime enters Metro.

`renderEffectStack(source, stack, inference)` records the Skia picture consumed
by both preview and export. The mobile facade accepts only rendered S4 controls.
PNG preserves source resolution and alpha; zero stacks bypass shaders. SkSL
provides smoothing, seven makeup layers and hair recolour, with shared polygons,
eye/mouth/brow exclusions, .2–.8 hair matte, spatial face/hair association and
linear-light luminance preservation. Sources are normalized locally and EXIF is
not exported. Render failures disable saving. Export retains ownership checks
and removes generated cache files even after save failure.

The hidden, inaccessible WebView accepts one source/frame job. Inputs are JPEG
<=384 pixels/edge and <=900,000 characters; results <=6,000,000 characters, 478
finite landmarks in [-2,2], hair <=512x512 with finite confidence in [0,1]. Face
Landmarker requests two faces so exactly one can be enforced. Other counts clear
face/hair effects; absent associated hair disables recolour. IDs reject stale
results. Initialization/loading is bounded to 60 seconds and inference to 15
seconds. Source changes, backgrounding, unmount, timeout and cancellation destroy
the WebView/WASM heaps. Segmentation masks close after copying only hair. Images
and landmarks never enter analytics, persistence or an upload transport.

### Delivery without file-origin model/WASM fetches

Run `npm run prepare:live-edit` in mobile before bundling. The script verifies the
SDK, loader, WASM and both models against existing SHA-256/size inventory pins.
It reuses prepared web assets or downloads models at **build time**. Already
installed esbuild converts the pinned SDK into an IIFE. An ignored
`assets/live-edit/runtime.html`, notices and manifest are produced. EAS's
post-install hook prepares enabled builds and writes a small unavailable stub
for dark builds. Metro rejects enabled builds with missing/stale HTML or runner
hashes. Manual builds/OTA must prepare before bundling and carry the asset too.

The statically required Expo asset resolves to a local file. WKWebView/Android
WebView load it with no sibling `file://` fetch: model bytes use
`modelAssetBuffer`; the Emscripten loader and WASM use data URLs. Data fetch avoids
file-origin CORS restrictions. Document CSP allows prepared inline code, data
scripts, `wasm-unsafe-eval`, `connect-src data:` and `img-src data:` only; frames,
workers, forms and base URLs are denied. Native navigation allows only the exact
asset URI. Universal/file-to-file access is disabled. No website CSP or Worker
configuration changes.

Prepared HTML: 43,121,909 bytes (41.1 MiB); raw pinned inputs: 32,366,259 bytes.
Base64, JS and WASM heap copies increase peak memory beyond this. Release
compression is unmeasured. This chooses bundled offline inference over first-use
downloads. Missing/incompatible runtimes fail closed with Retry, never a remote
fallback. WKWebView/Android data-WASM compatibility, memory, latency and App Store
acceptance remain **unqualified**; software Skia does not prove them. The owner
must decide whether to accept the bundle/RAM increase, whether offline-first
remains required or to separately authorize pinned first-use downloads, and
whether native evidence permits enabling the flag. No approval is inferred here.

### Short clips and explicit qualification limits

Local clips <=15 seconds / 50 MiB supply selectable frames using installed
expo-video and expo-image-manipulator. Save exports the chosen frame as a PNG;
the UI explicitly says this is not video export. Whole-clip edited playback and
encoding are **not implemented**: no installed API was found that encodes this
Skia stack as video. If S4 requires that interpretation, frame-only support is a
proposed deviation requiring owner acceptance. Stills above 24 MP are rejected,
not silently downscaled. No live camera or wig behavior is included.

Jest covers bridge protocol/validation/timeouts/cancel, both-model runner behavior,
shared parity, stack assembly, gating, ownership and cleanup. The installed
software Skia backend compiles all four shaders and tests synthetic geometry,
seven visible makeup layers, eye/mouth exclusions, orientation, zero strength and
combined PNG/preview replay equality at zero-byte tolerance. No hand-derived
steep-gradient goldens or real-person fixtures. Native parity target: <=2/255 per
channel after matching colour space/resolution, with zero-effect PNG exactness
checked separately. Host device work must measure latency/peak memory, lifecycle,
mask quality and accessibility before activation; simulator/physical evidence is
not supplied by this implementation.


## S4 review round 1 amendment

Status: fixes implemented dark; EAS and native qualification remain pending.

Slider drags are history transactions: intermediate values replace the present
state and release/termination commits one entry. Accessibility adjustments each
commit one entry. `inactive` system overlays preserve inference and export leases.
Only `background` invalidates inference; returning active enters loading, disables
save and starts fresh inference. Export ownership includes the inference generation
so a pending permission/save operation cannot silently use a reduced effect stack.

The existing face-filter save remains JPEG quality 92; Live Edit uses PNG. Both
still use the shared picture renderer. Preview keeps its retired pictures until
an asynchronous 1x1 Canvas snapshot confirms the replacement was rendered; that
snapshot is immediately disposed and never persisted. Only then is Save enabled.
Four immutable RuntimeEffects are cached by shader source for module lifetime;
source images, masks, shader instances and pictures remain individually owned.

Build and Metro share one strict literal flag reader. Unsupported declarations
fail the build. Every dark build/Metro start overwrites a prepared runtime with
the small stub and removes its manifest. Local WebView navigation normalizes
percent encoding and URL suffixes and allows about:blank; all other documents
and remote origins remain blocked.

`esbuild@0.28.2` is now an explicit mobile devDependency (version already pinned
in the root lockfile), not an assumed root-transitive path import. The prepare
script checks monorepo/root SDK inputs and esbuild availability before model
processing. **EAS assumes the full monorepo is uploaded, root dependencies including
the pinned MediaPipe SDK are installed, and mobile devDependencies are installed.**
This assumption is **unverified without an EAS dry run**. An apps/mobile-only
archive is unsupported and fails with an actionable message. Sandbox npm attempts
could not resolve registry metadata; the host must run `npm install --package-lock-only`
in apps/mobile to update its lockfile before an immutable install/EAS build.

Stickers remain web-only; mobile does not sync or render `stickers.js` in S4.
`packages/live-edit/smoothing.js` originally held only temporal landmark filtering.
It now also exports SKIN_SMOOTHING: kernel radius, pixel step, spatial/range
Gaussian coefficients, strength scale, face inset and excluded regions/expansion.
The existing web bilateral shader and face mask consume these constants without
changing their numeric behavior. Mobile syncs the module and uses those constants
in SkSL, geometry and rendering. Jest checks tables and actual shader/mask wiring.
This corrects the earlier independent mobile coefficients; it does not assert
pixel-identical cross-platform masks (Canvas/Skia antialiasing still differs).
Temporal filtering is not applied across separately selected still frames.

The clip position slider now has its own literal localized key, distinct from
frame selection and the clip help text. All 11 catalogs are covered; length-review
JSON is regenerated with check-app-i18n.mjs --write rather than hand-maintained.

## Supported photo formats (S4 review round 2)

**Web:** one bounded signature reader (first 4096 bytes) admits JPEG, PNG, WebP,
GIF, BMP and ISO-BMFF HEIC/HEIF/AVIF major or compatible brands. Empty and
application/octet-stream MIME values are allowed only with recognised bytes;
contradictory declared types, truncated signatures, RAW/ProRAW and other formats
are refused. Both selection and decoding share this validation; the picker also
advertises .heic/.heif/.avif extensions. Limits remain 50 MB, 24 MP and 8192 pixels
per edge. Native `createImageBitmap(Blob)` applies EXIF via `from-image` and selects
the default still (if specified), otherwise the first frame, before inference.
Strict chronological frame one is not guaranteed by native decoding: this is a
proposed exception to the first-frame requirement. Help states the still behavior.

Codec availability is the browser's responsibility: desktop Chrome/Firefox cannot
open HEIC; Safari is the suggested alternative where its native decoder supports
the photo. Recognised HEIC/HEIF and AVIF decode failures have distinct localized
states with JPEG save/share recovery; corrupt ordinary raster files keep the
generic decode error. A bundled HEIC decoder is explicitly out of scope: libheif's
LGPL-3.0 licensing and binary cost require a separate owner decision. No decoder,
dependency, upload, analytics or remote conversion was added.

**Mobile:** SDK 58's `preferredAssetRepresentationMode` is set to the installed
`UIImagePickerPreferredAssetRepresentationMode.Compatible` enum. Images are picked
without livePhotos, so iOS supplies the still, not its paired video. Every photo
passes through `pickedImageFile` before validation/normalization. JPEG/PNG/WebP
stay as picked; HEIC/HEIF (including sequences), AVIF, TIFF, BMP and GIF are
converted locally to JPEG with the installed ImageManipulator. Missing/generic
Android MIME uses the file extension. Native decoding still depends on OS/codec:
HEIF is available from Android 9 and AVIF from Android 12 (device support varies);
TIFF is also decoder-dependent. RAW/ProRAW DNG is refused even if labelled TIFF.
Unsupported formats/codec failures explain JPEG export/share recovery in all 11
locales, separately from invalid media and size limits. Input bytes and converted
bytes/dimensions are checked; decoded dimensions are checked again. Only cache
copies are discarded; native conversion refs are released. No original is deleted.

References: [Expo SDK 58 ImagePicker](https://docs.expo.dev/versions/v58.0.0/sdk/imagepicker/),
[HTML ImageBitmap](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-createimagebitmap),
[Android formats](https://developer.android.com/media/platform/supported-formats#image-formats).
Synthetic header and EXIF-6 tests contain no real photos. Browser launch was denied
by the sandbox's Mach-port policy; native orientation/codec qualification remains
host work, as do iOS/Android picker tests. Default-off flags remain unchanged.
