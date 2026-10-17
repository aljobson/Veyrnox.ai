/** Plain-language guidance and animated transition previews for the editor. Pure: no DOM, no timeline writes. */

const OPEN_MEDIA = 'Open media';

/** What to tell the user about adding clips, from the current video track contents. */
export function timelineGuidance(tl) {
    const clips = tl.video.length;
    if (clips === 0) {
        return {
            id: 'empty',
            title: 'Start by adding a video',
            body: 'Upload a video from this computer or pick one from your Library, then press Add to timeline.',
            action: OPEN_MEDIA,
        };
    }
    if (clips === 1) {
        return {
            id: 'second',
            title: 'Add a second video to join them',
            body: 'Open Media and press Add to timeline on another video. It lands right after this one, at the end. Then choose a transition under Transitions.',
            action: OPEN_MEDIA,
        };
    }
    return null;
}

const hasClipBefore = (tl, clip) => tl.video.some(c => c.trackId === clip.trackId && c.start + c.len === clip.start);

/** Why the Transitions panel cannot apply anything yet, or null when it can. */
export function transitionGuidance(tl, selected) {
    if (!selected) {
        return { title: 'Select a clip on the timeline first', body: 'Click the clip that should fade or slide in. The transition plays between it and the clip before it.', action: null };
    }
    if (selected.track !== 'video') {
        return { title: 'Transitions need a video clip', body: 'Select a video clip on the timeline. Text and sound clips do not take transitions.', action: null };
    }
    const clip = tl.video.find(c => c.id === selected.id);
    if (!clip) {
        return { title: 'Select a clip on the timeline first', body: 'Click the clip that should fade or slide in.', action: null };
    }
    if (hasClipBefore(tl, clip)) return null;
    return {
        title: 'This clip has no clip before it',
        body: 'A transition goes between two clips that touch on the same track. Add another video with Add to timeline, or select the second clip.',
        action: OPEN_MEDIA,
    };
}

const DISSOLVE = Object.freeze({
    duration: 1400,
    outgoing: [{ opacity: 1 }, { opacity: 0 }],
    incoming: [{ opacity: 0 }, { opacity: 1 }],
    overlay: null,
});

const wipe = (from, to) => ({ ...DISSOLVE, duration: 1400, outgoing: null, incoming: [{ clipPath: from }, { clipPath: to }] });
const slide = (axis, from) => ({
    ...DISSOLVE,
    outgoing: [{ transform: 'translate(0, 0)' }, { transform: `translate${axis}(${from.startsWith('-') ? '100%' : '-100%'})` }],
    incoming: [{ transform: `translate${axis}(${from})` }, { transform: 'translate(0, 0)' }],
});

const PREVIEWS = Object.freeze({
    dissolve: DISSOLVE,
    'dip-black': { ...DISSOLVE, duration: 1600, outgoing: null, incoming: [{ opacity: 0 }, { opacity: 1 }], overlay: [{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }] },
    flash: { ...DISSOLVE, duration: 1000, outgoing: null, incoming: [{ opacity: 0 }, { opacity: 1 }], overlay: [{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }] },
    blur: { ...DISSOLVE, outgoing: [{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(6px)' }], incoming: [{ opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0px)' }] },
    'wipe-left': wipe('inset(0 0 0 100%)', 'inset(0 0 0 0)'),
    'wipe-right': wipe('inset(0 100% 0 0)', 'inset(0 0 0 0)'),
    'wipe-up': wipe('inset(100% 0 0 0)', 'inset(0 0 0 0)'),
    'wipe-down': wipe('inset(0 0 100% 0)', 'inset(0 0 0 0)'),
    'slide-left': slide('X', '100%'),
    'slide-right': slide('X', '-100%'),
    'slide-up': slide('Y', '100%'),
    'slide-down': slide('Y', '-100%'),
    zoom: { ...DISSOLVE, outgoing: [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.6)', opacity: 0 }], incoming: [{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }] },
});

/** Web Animations keyframes for a looping two-colour preview of a transition. */
export function transitionPreview(id) {
    return PREVIEWS[id] || DISSOLVE;
}
