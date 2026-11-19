import { framesToTicks, loss } from './proInterchangeTime.mjs';
// Unknown metadata uses these neutral values, rather than invented codec/container identities.
export const MEDIA_DEFAULTS = Object.freeze({ codec: '', pixel_format: '', container: '', bitrate: null, file_size: null, start_timecode: null,
    par: [1, 1], color: { matrix: 'Bt709', transfer: 'Srgb', primaries: 'Bt709', range: 'Full' }, has_alpha: false, sample_rate: 48000, channels: 2, bits_per_sample: null });
export const LABELS = Object.freeze({ Violet:'#380ea7',Iris:'#1d4a64',Caribbean:'#355418',Lavender:'#6b1c82',Cerulean:'#23535a',Forest:'#404a11',Rose:'#801836',Mango:'#803f17',Purple:'#590db0',Blue:'#192d94',Teal:'#1f4d45',Magenta:'#791c56',Tan:'#6c5b47',Green:'#295c2d',Brown:'#583d14',Yellow:'#6e6628' });
const rgb = c => c.slice(1).match(/../g).map(n => parseInt(n,16));
export const nearestLabel = color => Object.keys(LABELS).reduce((best,k) => {
    const distance = key => rgb(LABELS[key]).reduce((s,v,i) => s + (v-rgb(color)[i])**2,0);
    return distance(k) < distance(best) ? k : best;
}, 'Violet');
export const param = (type, value) => ({ value: { [type]: value } });
export const effect = (id, params) => ({ effect: id, enabled: true, params });
export const float = value => param('Float', value);
export function mediaInfo(e) {
    const d = MEDIA_DEFAULTS;
    return { name: e.name, kind: e.kind === 'audio' ? 'AudioOnly' : e.kind === 'image' ? 'Still' : 'Movie', duration: framesToTicks(e.frames),
        video: e.kind === 'audio' ? null : { width:e.width || 1920,height:e.height || 1080,frame_rate:{num:30,den:1},par:[...d.par],codec:d.codec,pixel_format:d.pixel_format,color:{...d.color},has_alpha:d.has_alpha,bitrate:d.bitrate },
        audio_streams:e.hasAudio ? [{sample_rate:d.sample_rate,channels:d.channels,codec:d.codec,bits_per_sample:d.bits_per_sample}] : [],
        container:d.container,start_timecode:d.start_timecode,file_size:d.file_size };
}
export const projectSettings = () => ({ renderer:'FilmCraft GPU Acceleration (wgpu)',video_display:'Timecode',audio_display_samples:true,default_still_duration:framesToTicks(150),default_transition_duration_frames:0,default_audio_transition_duration:0 });
export const sequenceSettings = (width,height) => ({ width,height,frame_rate:{num:30,den:1},par:[1,1],sample_rate:48000,drop_frame:false,preset:'Veyrnox 30 fps',audio_master:'Stereo',preview_codec:'ProRes 422',max_bit_depth:false,max_render_quality:false,working_space:'Rec. 709' });
export function visualEffects(c, width, height) {
    const t = c.transform || {x:.5,y:.5,scale:1,rotation:0,opacity:1};
    const effects = [effect('motion', {position:param('Vec2',{x:t.x*width,y:t.y*height}),scale:float(t.scale*100),rotation:float(t.rotation),uniform_scale:param('Bool',true)}),effect('opacity',{opacity:float(t.opacity*100)})];
    if (c.crop) effects.push(effect('crop',{left:float(c.crop.x*100),top:float(c.crop.y*100),right:float((1-c.crop.x-c.crop.width)*100),bottom:float((1-c.crop.y-c.crop.height)*100)}));
    return effects;
}
export function textEffects(c,width,height) {
    return [effect('graphic_text',{text:param('Text',c.text),size:float(c.size*height/100),position:param('Vec2',{x:c.x*width,y:c.y*height}),fill:param('Bool',true),fill_color:param('Color',[...rgb(c.style?.color || '#ffffff').map(v=>v/255),1])})];
}
// Lanes are assigned in source ARRAY order: every later overlapping clip must be above.
export function stackingLanes(clips) {
    const lanes = [], assigned = [];
    const overlaps = (a,b) => a.start < b.start+b.len && b.start < a.start+a.len;
    for (const c of clips) {
        let lane = 0;
        for (const prior of assigned) if (overlaps(prior.clip,c)) lane = Math.max(lane,prior.lane+1);
        while (lanes[lane]?.some(old=>overlaps(old,c))) lane++;
        (lanes[lane] ||= []).push(c); assigned.push({clip:c,lane});
    }
    return lanes.length ? lanes.map(l=>l.slice().sort((a,b)=>a.start-b.start)) : [[]];
}
export function assertCounts(counts, refuse) {
    for (const [key,limit] of Object.entries({media:40,video:40,audio:40,text:150,tracks:16,markers:100,frames:18000,bytes:30000})) {
        if (counts[key] > limit) refuse('limit_exceeded', {dimension:key,count:counts[key],limit,counts});
    }
}
export const sequenceCounts = tl => ({media:Object.keys(tl.media).length,video:tl.video.length,audio:tl.audio.length,text:tl.text.length,tracks:tl.tracks.length,markers:tl.markers?.length || 0,frames:Math.max(0,...[...tl.video,...tl.audio,...tl.text].map(c=>c.start+c.len)),bytes:new TextEncoder().encode(JSON.stringify(tl)).length});
export function reportUnknown(object, allowed, path, report) {
    for (const key of Object.keys(object)) if (!allowed.includes(key)) loss(report,`${path}.${key}`,key,'dropped','Unsupported FilmCraft field.');
}

// FilmCraft item colour names: file-format values, never shown to a user.
export const FC_ITEM_COLOUR = Object.freeze({ media: 'Iris', graphic: 'Lavender', sequence: 'Forest' });
