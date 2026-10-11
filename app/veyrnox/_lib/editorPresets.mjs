import { addSequenceText, updateSequenceClip, addSequenceMedia, addSequenceClip, addSequenceTrack, sequenceEnd } from './editorSequence.mjs';
import { FILTER_DEFAULTS, TEXT_DEFAULTS } from './editorSequenceValidation.mjs';
// Original preset definitions; no licensed CapCut assets or effects.
export const LOOKS = Object.freeze([
    { id: 'clean', name: 'Clean', filter: { ...FILTER_DEFAULTS } },
    { id: 'mono', name: 'Monochrome', filter: { ...FILTER_DEFAULTS, saturate: 0, contrast: 1.15 } },
    { id: 'warm', name: 'Warm film', filter: { ...FILTER_DEFAULTS, brightness: 1.08, saturate: 0.85, hue: -12 } },
    { id: 'vivid', name: 'Vivid', filter: { ...FILTER_DEFAULTS, saturate: 1.5, contrast: 1.1 } },
    { id: 'soft', name: 'Soft focus', filter: { ...FILTER_DEFAULTS, blur: 2, brightness: 1.05 } },
]);
export const TITLE_STYLES = Object.freeze([
    { name: 'Clean title', size: 8, y: 0.5, style: { ...TEXT_DEFAULTS } },
    { name: 'Lower third', size: 5, y: 0.85, style: { ...TEXT_DEFAULTS, align: 'left', background: '#101827', backgroundOpacity: 0.9 }, x: 0.08 },
    { name: 'Editorial', size: 9, y: 0.5, style: { ...TEXT_DEFAULTS, font: 'serif', weight: 'normal', strokeWidth: 0 } },
    { name: 'Caption highlight', size: 5, y: 0.85, style: { ...TEXT_DEFAULTS, color: '#ffe66d', backgroundOpacity: 0.7 } },
    { name:'Serif quote',size:7,y:.5,style:{...TEXT_DEFAULTS,font:'Georgia',weight:'normal',italic:true,lineHeight:1.4,strokeWidth:0,shadowColor:'#000000',shadowOpacity:.6,shadowBlur:6,shadowX:2,shadowY:2} },
    { name:'Neon heading',size:10,y:.5,style:{...TEXT_DEFAULTS,color:'#32d6c5',strokeWidth:0,shadowColor:'#32d6c5',shadowOpacity:1,shadowBlur:12,shadowX:0,shadowY:0} },
    { name:'Typewriter',size:6,y:.8,style:{...TEXT_DEFAULTS,font:'Courier New',weight:'normal',letterSpacing:2,background:'#101827',backgroundOpacity:.85,strokeWidth:0} },
    { name:'Warm label',size:5,y:.85,style:{...TEXT_DEFAULTS,color:'#101827',background:'#ffe66d',backgroundOpacity:1,strokeWidth:0} },

]);
export function insertTitlePreset(tl, name, frame) {
    const preset = TITLE_STYLES.find(s => s.name === name);
    if (!preset) return { error: 'Choose a text style.' };
    const { name: _name, ...style } = preset;
    return addSequenceText(tl, { text: name === 'Lower third' ? 'Name\nYour role' : 'Your title', start: Math.min(frame, 17910), len: 90, ...style, animation: { in: 'fade', out: 'fade', duration: 15 } });
}
export function applyLook(tl, id, name, intensity = 1) {
    const preset = LOOKS.find(s => s.id === name); if (!preset) return { error: 'Choose a look.' };
    const filter = Object.fromEntries(Object.entries(preset.filter).map(([key, v]) => [key, FILTER_DEFAULTS[key] + (v - FILTER_DEFAULTS[key]) * intensity]));
    return updateSequenceClip(tl, 'video', id, { filter });
}

export const EDIT_TEMPLATES = Object.freeze(['Title intro', 'Slideshow', 'Picture in picture']);
export function insertEditTemplate(tl, name, mediaIds, headline, frame) {
    if (!EDIT_TEMPLATES.includes(name)) return { error: 'Choose an edit template.' };
    const selected = mediaIds.map(id => tl.media[id]).filter(m => m && m.kind !== 'audio').slice(0, 5);
    if (name !== 'Title intro' && !selected.length) return { error: 'Choose video or images in the media bin first.' };
    const at = name === 'Picture in picture' ? frame : sequenceEnd(tl);
    let next = tl;
    if (name === 'Picture in picture') { next = addSequenceTrack(next, 'video'); if (next.error) return next; next = addSequenceClip(next, 'video', selected[0].id, { start: at, len: Math.min(90, selected[0].frames), trackId: next.tracks.at(-1).id, transform: { x: 0.75, y: 0.3, scale: 0.35, rotation: 0, opacity: 1, flipX: false, flipY: false }, mask: 'rounded' }); }
    else if (name === 'Slideshow') for (const media of selected) { next = addSequenceClip(next, 'video', media.id, { start: sequenceEnd(next), len: Math.min(90, media.frames), animation: { in: 'zoom', out: 'fade', duration: 15 } }); if (next.error) return next; }
    if (next.error) return next;
    return addSequenceText(next, { text: headline.trim() || 'Your story', start: at, len: 90, y: name === 'Slideshow' ? 0.85 : 0.5, size: 8, animation: { in: 'fade', out: 'fade', duration: 15 } });
}
export function insertGraphic(tl, shape, color, frame) {
    let next = addSequenceTrack(tl, 'video'); if (next.error) return next;
    const trackId = next.tracks.at(-1).id, id = `g-${next.seq}`;
    next = addSequenceMedia(next, { id, kind: 'graphic', frames: 18000, name: `${shape} element`, hasAudio: false, width: 512, height: 512, graphic: { shape, color } });
    return next.error ? next : addSequenceClip(next, 'video', id, { start: Math.min(frame, 17910), len: 90, trackId, transform: { x: 0.5, y: 0.5, scale: 0.3, rotation: 0, opacity: 1, flipX: false, flipY: false } });
}
