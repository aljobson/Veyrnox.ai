# Music Beats web-to-mobile gap matrix

Date: 2026-11-22

Scope: production web Beats editor versus the native iOS/Android editor

Authority: current source, production runtime flags and merged PR history; older slice plans are historical

## Production disposition

Production enables `beatEditor`, `beatAi`, `labs` and generic Music `collaboration`. It disables `magicBar`, `blocks` and `references`. `beatCloud`, `beatLibrarySave` and `beatV5Writes` are absent and therefore false. Disabled rows are intentional gates, not work to expose early. Generic Music collaboration is not a live collaborative Beats editor and is not counted as one.

| Web surface | Native state | Gap and reason | Disposition |
| --- | --- | --- | --- |
| Entry, create, local save and reopen | Present | Registry entry, Beats home/create, local persistence and account isolation landed. | Native; retain contract tests. |
| Pattern transport | Partial | Native lacks web A-D pattern selection, copy/clear, swing, metronome and 16/32-step controls. | Build next; use a pinned phone transport. |
| Pads and step sequencer | Partial | Native pads audition/select but do not record live hits; steps toggle at the default velocity with no 60/100/127 editor. | Build native pad recording and velocity editing. |
| Arrangement and region editing | Mostly present | Move, copy, trim, resize, split, duplicate, delete, ruler, cycle, snap and zoom exist. Web ripple delete, insert gap, clip search and track rename do not. | Build native precision operations and search. |
| In-editor Music library | Missing | A song can seed a beat and starter Sounds can be inserted, but the editor has no private-song browser or clip picker. | Build a native library sheet using existing signed-asset contracts. |
| Sound/song/target playback | In progress in this slice | Documents already stored and rendered these regions but native playback was take-only. | Bounded local/remote playback, owner fencing and per-asset failure isolation. |
| Stem playback | Missing by design | The signing endpoint returns a ZIP archive, not directly decodable audio. Treating it as audio would be unsafe and broken. | Keep silent until bounded ZIP extraction and part validation land. |
| Piano roll and instruments | Manual editing present | Note, velocity, duration, quantize, keyboard and instrument browsing exist. Web live MIDI/on-screen recording, record quantization and one-bar count-in do not. | Build native MIDI/piano capture. |
| Mixer, effects, automation and meters | Mostly present | Native omits distortion Drive and uses a compressor stand-in; real-device fidelity is unproved. | Close controls, then qualify on device. |
| Microphone recording and takes | Present in source | Count-in, takes, audition, keep/discard and recovery are implemented, but no current device proof covers interruption, permission and latency behaviour. | Integrated iPhone qualification required. |
| Mixdown, export, share and Save to Music | Partial | Pattern export works; song export still rejects sound/song/stem/target assets, so generated or seeded audio is omitted. Save to Music is correctly gated while `beatLibrarySave` is off. | Port all supported asset rendering; retain product gate. |
| Beat AI | Partial | Generate, target, extend and replace are surfaced behind `beatAi`; split stems stays disabled and generated external audio inherits playback/export gaps. | Finish playback/export and bounded stem extraction. |
| Magic Bar | Intentionally gated | Production `magicBar` is false on both platforms. | No exposure until the live flag is enabled. |
| Sounds, templates, coach and controls | Present for editor scope | Four templates, starter Sounds, audition/add, song seed, coach and the controls sheet exist. Standalone Music Labs is a separate product surface. | Native; keep Labs capability-gated. |
| Cloud save, versions and conflict recovery | Implemented but gated | Source exists, while production `beatCloud` is off pending backend/privacy activation. | Preserve off-state; do not activate from the client. |
| v5 document markers | Intentionally dark | `beatV5Writes` is false; both platforms remain v4-write/v5-read. Ripple/search are live v4 work and are not blocked on v5. | No user-facing v5 work until rollout. |
| Collaboration | No Beat-specific web baseline | Production's generic Music collaboration does not provide simultaneous Beat editing. | Track broader Music workspaces separately. |
| Native phone UX | Material gap | The editor is portrait-only and vertically long; transport can scroll away, hierarchy is flat, and Dynamic Type, colour-independent state and landscape/iPad layouts are incomplete. | Build the adaptive workspace and run the accessibility/device gate. |

## Why the gap exists

The web editor arrived as a sequence of browser-native phases: arrangement, audio-library regions, MIDI, cloud, export, AI, mixer, recording and polish. Native work deliberately established the document model and audio engine first, then shipped the editor in N1-N9 slices. The remaining gap is therefore concentrated in browser-dependent asset handling, phone-specific interaction design, external-audio mixdown and device qualification—not in a separate mobile document format. Keeping the shared validators, signing paths and document schema prevents the two products drifting while native controls are completed.

## PR evidence

Web baseline: #2264, #2279, #2283, #2290, #2322, #2342, #2349, #2363, #2371, #2392 and #2484; dark v5 rollout #2469 and #2512.

Native baseline: #2428/#2524 (engine), #2467 (N1), #2526 (N2), #2540 (arrangement), #2534 (piano), #2548 (mixer), #2547 (recording), #2569 (export), #2561 (AI), #2563 (templates/Sounds/coach) and #2597 (Music entry).

## Completion order

1. Land bounded sound/song/target playback without claiming stem or export parity.
2. Add the persistent adaptive transport and phone workspace shell.
3. Close pattern/pad/velocity, ripple/search/library and MIDI-recording gaps.
4. Render every supported audio source in mixdown/export, then add bounded stem extraction.
5. Qualify recording, playback, export, accessibility and recovery on the consolidated iPhone simulator/native build.

Navigation is not counted as parity. Each row closes only after its behavior, recovery path, accessibility contract and production gate are proved.
