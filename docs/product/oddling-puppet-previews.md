# Free Oddling puppet previews

All 32 original Oddlings, including the four Torso sizes characters, have individually calibrated browser-side puppet rigs in the gallery. They blink, breathe and make small head tilts/nods without moving the whole photograph. These are stylized 2D portrait puppets, not generated videos or a 3D reconstruction.

- The existing standalone portrait is the only image input. Source portrait files are not changed.
- A head cutout moves over a stationary clean plate reconstructed from the portrait's studio-background row samples. Pixels outside the local head/chest effects remain fixed, including the floor and feet.
- Breathing deforms an interior chest ellipse, with zero displacement at its boundary.
- Human eyes use local eyelid overlays. Opaque glasses, beetle/moth eyes and robot optics use stylized shutters; no uncovered human eyes are invented beneath masks.
- No inference model, provider generation, upload, audio or credit-bearing request is used for previews. No credits are deducted.
- Pause/Play freezes/resumes the puppet. Off-screen cards release their graphics resources; hidden tabs stop their frame loops. Reduced-motion preferences show the unchanged original image.
- If WebGL or image processing is unavailable, show the original static portrait and an explicit graphics-preview-unavailable message. Never substitute a paid model call.

“Animate this character” remains a separate, paid image-to-video workflow, with its live model price and explicit Generate action. Free puppet previews do not submit that action.

## Implementation and verification

`oddlingPuppetRigs.js` holds separate head polygons, neck pivots, eye ellipses and chest ellipses for all 32 images. `oddlingPuppetRenderer.js` builds the stationary plate and cutout locally and renders the small deformations in WebGL. Only visible cards allocate renderers.

Tests cover complete rig coverage, bounded poses, real blink/breath/head cycles, stationary pixels outside the head matte, immutable sources, no generation endpoints and cleanup/pause/reduced-motion guards. Browser verification must also inspect rendered pixels and blink frames, not just the presence of a canvas or an animation-state label.
