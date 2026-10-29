# ADR-0302: Phone editor voiceover recorder

Status: Implemented; native device verification pending.

The phone editor offers voiceover recording on iOS, using the host-installed
`expo-audio ~58.0.10` (the frozen plan named `~58.0.9`). The installed API and
plugin support the planned options, including `record({ forDuration })`.
A new dev client and store build are required: OTA alone cannot add the native
module. No server, migration, feature flag or upload behavior changes here.

Record WAV, linear PCM, 16 kHz mono, 16-bit little-endian integer samples, with
metering enabled. The existing backup, export and server accept MP3/WAV audio
up to 20 MiB. At 32,000 bytes per second, 600 seconds uses about 19.2 MB plus
container headers, under that limit. Validate RIFF/WAVE before copying a take;
probe its duration instead of substituting the editor's guessed length. The
native WAV container, including any iOS FLLR chunk, still needs device proof.
Android's MediaRecorder formats in expo-audio cannot produce WAV. The action
is hidden there and `android.permission.RECORD_AUDIO` remains blocked.

Both expo-audio and expo-image-picker receive the owner-approved iOS permission
text: “Veyrnox.ai uses the microphone only while you record a voiceover in the
editor.” Leaving image-picker's microphone permission false would delete
NSMicrophoneUsageDescription, so both plugins now write the same value. The
audio plugin uses `recordAudioAndroid: false`, `enableBackgroundRecording:
false` and `enableBackgroundPlayback: false`; it adds no UIBackgroundModes.
Audio Data was already declared in the privacy manifest. The owner checks App
Privacy answers separately. The approved privacy-policy paragraph ships in a
separate legal change; no legal catalog is edited here.

Playback stops and the playhead is captured when the sheet opens. Add places
and selects one clip on an unlocked audio track at that captured frame. The
recording cap is the smaller of 600 seconds and the whole seconds remaining
on the timeline. Permission/start work is generation fenced, including the
`starting` phase (specified by the plan's startup steps but omitted from its
phase enumeration). A first stale idle poll is ignored; a recording must be
established within 1.5 seconds. Backgrounding, interruption or editor recovery
stops recording. Recovery hides the recorder sheet and retains the take.

Temporary takes live in `Paths.cache/veyrnox-voiceover`. The installed filesystem
API uses `moveSync` to adopt a take without an asynchronous account-change gap;
WAV validation opens `FileMode.ReadOnly`, awaits `readBytes(12)` and closes the
handle. The folder is cleared at module load and on account changes/sign-out.
Discard, re-record and unmount remove un-added takes. A kill mid-recording may
leave expo-audio's original file in the OS cache until the OS purges it; that
file is never uploaded. File cleanup is best effort and never logs identifiers.

Add owns an editor import token and an operation generation. Every exit ends
the token and settles to review/idle only if that Add or its cancellation still
owns the sheet. Unmount, account change, backgrounding or readiness loss prevents
late insertion. A cancelled copy may leave an orphan in project device media:
hydration ignores ids absent from the document and project removal deletes it.
`preparePicked(..., true)` refuses a failed durable copy. Existing three-argument
imports retain their original fallback behavior. Backups and exports use the
existing paths; the recorder itself makes no network requests. Backup is gated
server-side (production off, staging on at plan approval). Enabling production
backup requires updating the separate privacy paragraph to mention backup.

All ten app catalogs carry the new strings. Their existing files exceed 500
lines; preserving their mandated layout is an explicit exception to the plan's
all-source line limit. New source files remain below 500 lines and the editor
screen remains at its stricter 440-line ceiling.

Host verification after merge: rebuild the single consolidated mobile dev
client, record on iPhone 17 Pro, confirm the prompt and RIFF/WAVE header, Add,
and render a staging export. Introspect native config to confirm the microphone
usage string, no new UIBackgroundModes and no Android RECORD_AUDIO permission.
