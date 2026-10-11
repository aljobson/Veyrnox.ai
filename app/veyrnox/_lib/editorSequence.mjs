// Version 3: independent, timed layers. Version 2 readers/operations remain available.
import { slicedWords } from './editorWords.mjs';
import { slicedAnimation } from './editorAnimation.mjs';
import { backgroundMediaIds } from './editorBackground.mjs';
import { sourceFrame, sourceAdvance, shiftedSpeedKeys } from './editorSpeed.mjs';
export { sourceFrame } from './editorSpeed.mjs';
import { sliceMaskKeyframes } from './editorMask.mjs';
import { validateSequence } from './editorSequenceValidation.mjs';
export const SEQUENCE_LIMITS = Object.freeze({ maxSeconds: 600, maxMedia: 40, maxVideoClips: 40, maxAudioClips: 40, maxTexts: 150, maxTracks: 16, maxTextChars: 1000 });
export const SEQUENCE_MAX = 18000;
const track = (id, kind, name) => ({ id, kind, name, locked: false, muted: false, hidden: false });
export function emptySequence() {
    return { schemaVersion: 3, fps: 30, seq: 0, aspect: '16:9', media: {}, video: [], audio: [], text: [],
        tracks: [track('video-0', 'video', 'Video 1'), track('audio-0', 'audio', 'Audio 1'), track('text-0', 'text', 'Text 1')], background: '#000000' };
}
export function upgradeSequence(tl) {
    if (tl.schemaVersion === 3) return tl;
    let start = 0;
    return { ...emptySequence(), ...tl, schemaVersion: 3,
        video: tl.video.map(c => { const out = { ...c, start, trackId: 'video-0' }; start += c.len; return out; }),
        audio: tl.audio.map(c => ({ ...c, trackId: 'audio-0' })), text: tl.text.map(c => ({ ...c, trackId: 'text-0' })) };
}
export const trackFor = (tl, item) => tl.tracks?.find(t => t.id === item.trackId);
export const sequenceEnd = tl => Math.max(0, ...[...tl.video, ...tl.audio, ...tl.text].map(c => c.start + c.len));
export const layerEnd = (tl, trackId) => Math.max(0, ...[...tl.video, ...tl.audio, ...tl.text].filter(c => c.trackId === trackId).map(c => c.start + c.len));
const error = message => ({ error: message });
const checked = tl => { const bad = validateSequence(tl); return bad ? error(bad) : tl; };
const editable = (tl, kind, id) => {
    const item = tl[kind]?.find(c => c.id === id);
    return !item ? error('Select a clip first.') : trackFor(tl, item)?.locked ? error('Unlock this track to edit it.') : item;
};
export function addSequenceMedia(tl, media) {
    if (tl.media[media.id]) return tl;
    const clean = { id: media.id, kind: media.kind, frames: media.frames, name: String(media.name || 'Untitled').slice(0, 120),
        ...(media.sourceName?{sourceName:media.sourceName}:String(media.name||'').length>120?{sourceName:String(media.name).slice(0,255)}:{}),...(media.originalAudio?{originalAudio:media.originalAudio}:{}),...(media.assetSource?{assetSource:media.assetSource}:{}),...(media.folder!==undefined?{folder:media.folder}:{}),...(media.attribution?{attribution:media.attribution}:{}),hasAudio: !!media.hasAudio, width: media.width || 0, height: media.height || 0, ...(media.graphic ? { graphic: media.graphic } : {}) };
    return checked({ ...tl, media: { ...tl.media, [media.id]: clean } });
}
export function addSequenceClip(tl, kind, mediaId, { in: from = 0, len, start, trackId, ...options } = {}) {
    const media = tl.media[mediaId];
    const lane = tl.tracks.find(t => t.id === trackId && t.kind === kind) || tl.tracks.find(t => t.kind === kind && !t.locked);
    if (!media || !lane) return error('Add a file and an unlocked track first.');
    if (lane.locked) return error('Unlock this track to edit it.');
    const at = start ?? layerEnd(tl, lane.id);
    const seq = tl.seq + 1;
    const length = len ?? Math.min(['image', 'graphic'].includes(media.kind) ? 90 : media.frames - from, SEQUENCE_MAX - at);
    const item = { id: `${kind[0]}${seq}`, mediaId, in: from, len: length, start: at, trackId: lane.id, volume: 1,
        ...(kind === 'video' ? { transition: 0 } : {}), ...options };
    return checked({ ...tl, seq, [kind]: [...tl[kind], item] });
}
export function updateSequenceClip(tl, kind, id, patch) {
    const item = editable(tl, kind, id); if (item.error) return item;
    if(kind==='text' && patch.text!==undefined && patch.text!==item.text && !Object.hasOwn(patch,'words') && item.words?.length)patch={...patch,words:[]};
    const destination = patch.trackId ? tl.tracks.find(t => t.id === patch.trackId) : null;
    if (destination?.locked) return error('Unlock the destination track first.');
    return checked({ ...tl, [kind]: tl[kind].map(c => c.id === id ? { ...c, ...patch, id: c.id } : c) });
}
export function removeSequenceClip(tl, kind, id, ripple = false) {
    const item = editable(tl, kind, id); if (item.error) return item;
    return checked({ ...tl, [kind]: tl[kind].filter(c => c.id !== id).map(c => ripple && c.trackId === item.trackId && c.start >= item.start + item.len ? { ...c, start: c.start - item.len } : c) });
}
export function splitSequenceClip(tl, kind, id, frame) {
    const item = editable(tl, kind, id); if (item.error) return item;
    const offset = frame - item.start;
    if (!Number.isInteger(offset) || offset < 1 || offset >= item.len) return error('Move the playhead inside the clip to split it.');
    const seq = tl.seq + 1;
    const first = { ...item, ...slicedAnimation(item,0), ...(item.maskKeyframes ? { maskKeyframes: sliceMaskKeyframes(item, 0, offset) } : {}), len: offset, ...(kind !== 'text' ? { fadeIn: Math.min(item.fadeIn || 0, offset), fadeOut: Math.min(item.fadeOut || 0, offset) } : {}),  };
    const second = { ...item, ...slicedWords(item,offset), ...slicedAnimation(item,offset), ...(item.speedCurve ? {speedCurve:shiftedSpeedKeys(item,offset)}:{}), ...(item.maskKeyframes ? { maskKeyframes: sliceMaskKeyframes(item, offset, item.len - offset) } : {}), id: `${kind[0]}${seq}`, start: frame, len: item.len - offset, ...(kind !== 'text' ? { fadeIn: Math.min(item.fadeIn || 0, item.len - offset), fadeOut: Math.min(item.fadeOut || 0, item.len - offset) } : {}),
        ...(kind !== 'text' ? { in: sourceFrame(item, offset) } : {}), ...(kind === 'video' ? { transition: 0 } : {}),
         };
    return checked({ ...tl, seq, [kind]: tl[kind].flatMap(c => c.id === id ? [first, second] : [c]) });
}
export function addSequenceText(tl, options = {}) {
    const lane = tl.tracks.find(t => t.id === options.trackId && t.kind === 'text') || tl.tracks.find(t => t.kind === 'text' && !t.locked);
    if (!lane || lane.locked) return error('Add an unlocked text track first.');
    const seq = tl.seq + 1;
    const { id: _id, ...clean } = options;
    const item = { id: `t${seq}`, text: 'Your text', start: 0, len: 90, x: 0.5, y: 0.85, size: 6, ...clean, trackId: lane.id };
    return checked({ ...tl, seq, text: [...tl.text, item] });
}
export function duplicateSequence(tl, selection) {
    const { track: kind, id } = selection || {};
    const item = editable(tl, kind, id); if (item.error) return item;
    const seq = tl.seq + 1;
    return checked({ ...tl, seq, [kind]: [...tl[kind], { ...item, id: `${kind[0]}${seq}`, start: item.start + item.len }] });
}
export function addSequenceTrack(tl, kind) {
    if (!['video', 'audio', 'text'].includes(kind)) return error('Choose video, audio or text.');
    const seq = tl.seq + 1;
    const number = tl.tracks.filter(t => t.kind === kind).length + 1;
    return checked({ ...tl, seq, tracks: [...tl.tracks, track(`${kind}-${seq}`, kind, `${kind[0].toUpperCase()}${kind.slice(1)} ${number}`)] });
}
export function updateSequenceTrack(tl, id, patch) {
    return checked({ ...tl, tracks: tl.tracks.map(t => t.id === id ? { ...t, ...patch, id: t.id, kind: t.kind } : t) });
}
export function moveSequence(tl, kind, id, start, trackId, snap = true, frame = 0) {
    const item = editable(tl, kind, id); if (item.error) return item;
    let at = Math.max(0, Math.round(start));
    if (snap) {
        const anchors = [0, frame, ...[...tl.video, ...tl.audio, ...tl.text].filter(c => c.id !== id).flatMap(c => [c.start, c.start + c.len])];
        const shifts = anchors.flatMap(a => [a - at, a - (at + item.len)]).filter(n => Math.abs(n) <= 6).sort((a, b) => Math.abs(a) - Math.abs(b));
        if (shifts.length) at = Math.max(0, at + shifts[0]);
    }
    return updateSequenceClip(tl, kind, id, { start: Math.min(at, SEQUENCE_MAX - item.len), trackId: trackId || item.trackId });
}
export function trimSequence(tl, kind, id, edge, delta) {
    const item = editable(tl, kind, id); if (item.error) return item;
    const fromStart = edge === 'in', len = item.len + (fromStart ? -delta : delta);
    return updateSequenceClip(tl, kind, id, { len, ...slicedWords(item,fromStart?delta:0), ...slicedAnimation(item,fromStart?delta:0), ...(item.speedCurve ? {speedCurve:shiftedSpeedKeys(item,fromStart?delta:0)}:{}), ...(item.maskKeyframes ? { maskKeyframes: sliceMaskKeyframes(item, fromStart ? delta : 0, len) } : {}), ...(kind !== 'text' ? { fadeIn: Math.min(item.fadeIn || 0, len), fadeOut: Math.min(item.fadeOut || 0, len) } : {}),
        ...(fromStart ? { start: item.start + delta, ...(kind !== 'text' ? { in: sourceFrame(item, delta) } : {}) } : {}),
 });
}
export function sequenceBackground(tl, background) { return checked({ ...tl, background }); }

export function setSequenceRate(tl, kind, id, rate) {
    const item = editable(tl, kind, id); if (item.error) return item;
    if (kind === 'text' || ['image', 'graphic'].includes(tl.media[item.mediaId].kind)) return error('Choose a video or audio clip.');
    const sourceLength = sourceAdvance(item,item.len);
    const len = Math.max(1, Math.floor(sourceLength / rate));
    const lower=Math.min(sourceFrame(item,0),sourceFrame(item,item.len-1));
    return updateSequenceClip(tl, kind, id, { rate, len, speedCurve: [], ...(item.animation?{animation:{...item.animation,offset:0,span:len}}:{}), ...(item.reverse ? {in:lower+(len-1)*rate}:{}), keyframes: [], parameterKeyframes: [], maskKeyframes: [], fadeIn: Math.min(item.fadeIn || 0, len), fadeOut: Math.min(item.fadeOut || 0, len) });
}
export function extractSequenceAudio(tl, id) {
    const item = editable(tl, 'video', id); if (item.error) return item;
    let next = addSequenceClip(tl, 'audio', item.mediaId, { start: item.start, in: item.in, len: item.len, rate: item.rate ?? 1, ...(item.speedCurve ? {speedCurve:item.speedCurve}:{}), ...(item.reverse!==undefined ? {reverse:item.reverse}:{}), ...(item.preservePitch!==undefined?{preservePitch:item.preservePitch}:{}),...(item.audioProcessing?{audioProcessing:item.audioProcessing}:{}),volume: item.volume, fadeIn: item.fadeIn || 0, fadeOut: item.fadeOut || 0 });
    return next.error ? next : updateSequenceClip(next, 'video', id, { volume: 0 });
}
export function sequenceTransition(tl, k) {
    const current = tl.video[k];
    const previous = tl.video.find(c => c.trackId === current?.trackId && c.start + c.len === current.start);
    return previous ? Math.min(current.transition || 0, current.len, previous.len, 60) : 0;
}

export function setSequenceTransition(tl, id, transitionType, transition) {
    const item = editable(tl, 'video', id); if (item.error) return item;
    if (!tl.video.some(c => c.trackId === item.trackId && c.start + c.len === item.start)) return error('Place this clip immediately after another on the same track.');
    return updateSequenceClip(tl, 'video', id, { transitionType, transition: Math.min(transition, item.len) });
}

export function removeSequenceMedia(tl, id) {
    if ([...tl.video, ...tl.audio].some(c => c.mediaId === id || backgroundMediaIds(c).includes(id))) return error("Remove this media from clips and backgrounds first. Undo keeps its source file available.");
    return checked({ ...tl, media: Object.fromEntries(Object.entries(tl.media).filter(([key]) => key !== id)) });
}

/** Transition after this clip, regardless of media array order. */
export function sequenceTransitionAfter(tl, clip) {
    const k = tl.video.findIndex(c => c.trackId === clip.trackId && c.start === clip.start + clip.len);
    return k < 0 ? 0 : sequenceTransition(tl, k);
}

export function setSequenceSpeedCurve(tl,kind,id,points) {
    const item=editable(tl,kind,id);if(item.error)return item;
    if(kind==='text' || ['image','graphic'].includes(tl.media[item.mediaId].kind) || item.freezeFrame!==undefined)return error('Choose moving video or audio.');
    if(!Array.isArray(points) || points.length<2 || points.length>12 || points[0].position!==0 || points.at(-1).position!==1 || points.some((p,i)=>!Number.isFinite(p.position) || !Number.isFinite(p.rate) || p.position<0 || p.position>1 || p.rate<.1 || p.rate>8 || (i && p.position<=points[i-1].position)))return error('Use 2–12 ordered speed points, from 0% to 100%.');
    const average=points.slice(1).reduce((sum,p,i)=>sum+(p.position-points[i].position)*(p.rate+points[i].rate)/2,0),span=sourceAdvance(item,item.len),len=Math.max(1,Math.floor(span/average));
    const speedCurve=points.map(p=>({frame:p.position*len,rate:p.rate})),lower=Math.min(sourceFrame(item,0),sourceFrame(item,item.len-1)),inPoint=item.reverse?lower+sourceAdvance({speedCurve},len-1):item.in;
    return updateSequenceClip(tl,kind,id,{speedCurve,len,in:inPoint,...(item.animation?{animation:{...item.animation,offset:0,span:len}}:{}),keyframes:[],parameterKeyframes:[],maskKeyframes:[],fadeIn:Math.min(item.fadeIn || 0,len),fadeOut:Math.min(item.fadeOut || 0,len)});
}
export function reverseSequenceClip(tl,kind,id) {
    const item=editable(tl,kind,id);if(item.error)return item;
    if(kind==='text' || ['image','graphic'].includes(tl.media[item.mediaId].kind) || item.freezeFrame!==undefined)return error('Choose moving video or audio.');
    return updateSequenceClip(tl,kind,id,{reverse:!item.reverse,in:sourceFrame(item,item.len-1),...(item.speedCurve?.length?{speedCurve:item.speedCurve.map(p=>({...p,frame:item.len-1-p.frame})).reverse()}: {})});
}
export function insertSequenceFreeze(tl,id,frame,length=60) {
    const item=editable(tl,'video',id);if(item.error)return item;
    if(frame<item.start || frame>=item.start+item.len)return error('Move the playhead inside the video.');
    const still=sourceFrame(item,frame-item.start),offset=frame-item.start;
    let next=offset>0?splitSequenceClip(tl,'video',id,frame):tl;if(next.error)return next;
    next={...next,video:next.video.map(c=>c.trackId===item.trackId && c.start>=frame?{...c,start:c.start+length}:c)};
    const {id:_id,...settings}=item;
    return addSequenceClip(next,'video',item.mediaId,{...settings,start:frame,len:length,in:still,freezeFrame:still,volume:0,transition:0,speedCurve:[],keyframes:[],parameterKeyframes:[],maskKeyframes:[],animation:{in:'none',out:'none',duration:15}});
}

export function updateMediaDetails(tl,id,patch) {
    const m=tl.media[id];if(!m)return {error:'Choose a media item first.'};
    if(patch.name!==undefined && (typeof patch.name!=='string'||!patch.name.trim()||/[\u0000-\u001f\u007f]/.test(patch.name)))return {error:'Choose a non-empty media name without control characters.'};
    if(Object.keys(patch).some(k=>!['name','folder','attribution'].includes(k)))return {error:'Invalid media details.'};
    const next={...tl,media:{...tl.media,[id]:{...m,...patch,...(patch.name!==undefined?{sourceName:m.sourceName||m.name}:{})}}},error=validateSequence(next);
    return error?{error}:next;
}
