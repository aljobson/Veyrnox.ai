/**
 * Motion-transfer template cards (ADR-0269). Public data only: what a card
 * shows and which server-side driving clip it uses. The clip's R2 key, length
 * check and orientation live in lib/motionClips.js. The server charges the
 * catalog row (`model`) per 5 seconds of the clip; nothing here is a price.
 *
 * Nothing here is shown until MOTION_TRANSFER_ENABLED / MOTION_REPLACE_ENABLED
 * is "true" and the clip is marked ready. Every clip and preview is our own.
 */

const card = (id, title, blurb, seconds, model = 'motion-transfer') => Object.freeze({
    id,
    title,
    blurb,
    model,
    drivingClip: id,
    seconds,
    preview: { video: `/showcase/${id}.mp4`, poster: `/showcase/${id}.jpg` },
});

export const MOTION_TRANSFER_TEMPLATES = Object.freeze([
    card('motion-city-stride', 'City stride', 'You walk toward a camera that eases back.', 5),
    card('motion-runway-turn', 'Runway turn', 'A runway walk, a pause, a look back.', 10),
    card('motion-slowmo-hair-walk', 'Slow-motion walk', 'Wind in your hair, every step in slow motion.', 5),
    card('motion-orbit-reveal', 'Orbit reveal', 'You hold the pose while the camera circles.', 5),
    card('motion-push-in-glance', 'The glance', 'Stillness, then a sharp look into the lens.', 5),
    card('motion-two-step', 'Two-step', 'An easy side-to-side groove.', 5),
    card('motion-shoulder-bounce', 'Shoulder bounce', 'Shoulders on the beat and a point to camera.', 5),
    card('motion-arm-wave-routine', 'Arm wave', 'An eight-count arm wave into a pose.', 10),
    card('motion-spin-and-freeze', 'Spin and freeze', 'One spin, then hold it.', 5),
    card('motion-moonwalk-glide', 'Backward glide', 'A smooth glide backwards across the floor.', 5),
    card('motion-parkour-vault', 'Wall vault', 'Run, vault a low wall, land clean.', 5),
    card('motion-rooftop-jump', 'Rooftop jump', 'A run-up and a jump across the gap.', 5),
    card('motion-waiter-balance', 'Tray balance', 'Carrying a tray on one hand, a wobble and a save.', 10),
    card('motion-skate-glide', 'Skate glide', 'Gliding forward with your arms out.', 5),
    card('motion-boxing-combo', 'Boxing combo', 'Jab, cross, slip.', 5),
    card('motion-duo-dance', 'Duo dance', 'Two people, one mirrored routine. Needs a photo of two.', 10),
    card('motion-slow-dance', 'Slow dance', 'A slow sway and a turn. Needs a photo of two.', 10),
    card('motion-world-shift-walk', 'World shift', 'A steady walk while the world changes around you.', 10, 'motion-replace'),
    card('motion-hero-landing', 'Hero landing', 'Drop in and land in a crouch.', 5),
    card('motion-stage-swap', 'Take the stage', 'You replace the performer on a lit stage.', 10, 'motion-replace'),
]);

