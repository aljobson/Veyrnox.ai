import { scanProProject } from '../../../lib/proProjectScan.mjs';
import { validateSequence, TEXT_DEFAULTS } from './editorSequenceValidation.mjs';
import { emptySequence } from './editorSequence.mjs';
import { assertManifest, manifestMedia, manifestEntry, safeSourceName, safeText } from './proMediaManifest.mjs';
import { result, refuse, loss, checkedTicks, rationalRate, ticksToFrames, sourceFirstTick, dbToVolume, MAX_SEQUENCE_TICKS, TICKS_PER_FRAME } from './proInterchangeTime.mjs';
import { assertCounts, sequenceCounts, reportUnknown, boundReport, LABELS } from './proInterchangeFormat.mjs';
const obj = v => v && typeof v==='object' && !Array.isArray(v);
const array = (v,path) => {if(!Array.isArray(v))refuse('invalid_array',{path});return v;};
const number = (v,path) => {if(typeof v!=='number'||!Number.isFinite(v))refuse('invalid_number',{path});return v;};
const bounded = (v,min,max,path,report) => {number(v,path);const n=Math.max(min,Math.min(max,v));if(n!==v)loss(report,path,'clamped','approximated','Value clamped to the v3 range.',{from:v,to:n});return n;};
const bool = (v,fallback,path) => {if(v===undefined)return fallback;if(typeof v!=='boolean')refuse('invalid_boolean',{path});return v;};
const neutralMixer = m => !m || ((!m.lanes || !Object.keys(m.lanes).length) && !m.sends?.length && m.output==null && !m.record_arm && !m.solo_safe && (!m.input_map || m.input_map==='Stereo') && (!m.mode || m.mode==='Read'));
const safe = (v,max,fallback,path,report,keepLines=false) => {const n=safeText(v,max,fallback,keepLines);if(n!==v)loss(report,path,'sanitized','approximated','String sanitised or shortened.');return n;};
function identities(project) {
    const seen=new Set(),structural=new Set();
    const walk = (v,path) => {
        if(!v || typeof v!=='object') {if(typeof v==='number'&&!Number.isFinite(v))refuse('invalid_number',{path});return;}
        if(Object.hasOwn(v,'id')) {
            if(!Number.isSafeInteger(v.id)||v.id<0)refuse('invalid_id',{path});
            if(seen.has(v.id))refuse('duplicate_id',{path,id:v.id});seen.add(v.id);if(!/\.markers\.\d+$/.test(path))structural.add(v.id);
        }
        for(const [key,child] of Object.entries(v))walk(child,`${path}.${safeText(key,80)}`);
    };
    walk(project,'project');
    if(!Number.isSafeInteger(project.next_id)||project.next_id<=[...structural].reduce((a,b)=>Math.max(a,b),-1))refuse('invalid_next_id',{nextId:project.next_id,maxId:[...structural].reduce((a,b)=>Math.max(a,b),-1)});
}
function quantize(values,path,report) {
    const errors=values.map(v=>ticksToFrames(v));
    const max=errors.reduce((a,b)=>Math.abs(a.errorTicks)>=Math.abs(b.errorTicks)?a:b,{errorTicks:0});
    if(max.errorTicks)loss(report,path,'approximated:quantized','approximated','Rounded to the 30 fps authoring grid.',{maxErrorTicks:Math.abs(max.errorTicks),maxErrorFrames:Math.abs(max.errorFrames),remainders:errors.map(e=>e.remainder)});
    return errors.map(e=>e.frames);
}
function effectsFor(c,path,report) {
    const effects=array(c.effects,`${path}.effects`), by=new Map();
    for(const [i,e] of effects.entries()) {
        if(!obj(e)||typeof e.effect!=='string'||!obj(e.params))refuse('invalid_effect',{path});
        if(!bool(e.enabled,true,path)) {loss(report,`${path}.effects.${i}`,'disabled_effect');continue;}
        if(by.has(e.effect))loss(report,`${path}.effects.${i}`,'duplicate_effect');
        else by.set(e.effect,e);
        reportUnknown(e,['effect','enabled','params'],`${path}.effects.${i}`,report);
        for(const [k,p] of Object.entries(e.params)) {
            if(!obj(p)||!obj(p.value))refuse('invalid_parameter',{path});
            if(p.keyframes?.length)loss(report,`${path}.effects.${i}.params.${k}.keyframes`,'keyframes','dropped','Animated parameters use their static value.');
        }
        if(!['motion','opacity','crop','graphic_text','volume'].includes(e.effect))loss(report,`${path}.effects.${i}`,e.effect);
    }
    return by;
}
function parameter(e,key,type,fallback,path) {
    const p=e?.params?.[key];if(p===undefined)return fallback;
    if(!Object.hasOwn(p.value,type))refuse('invalid_parameter',{path,key});
    const v=p.value[type];
    if(type==='Float')return number(v,path);
    if(type==='Vec2' && (!obj(v)||!Number.isFinite(v.x)||!Number.isFinite(v.y)))refuse('invalid_point',{path,key});
    return v;
}
function visual(c,e,width,height,path,report) {
    const motion=e.get('motion'), opacity=e.get('opacity'), crop=e.get('crop');
    if(motion||opacity) {
        if(motion)loss(report,`${path}.effects.motion`,'motion','approximated','Pixel motion is normalised; source fitting and anchor semantics may differ.');
        if(motion?.params?.uniform_scale?.value?.Bool===false)loss(report,`${path}.effects.motion.params.uniform_scale`,'uniform_scale');
        const p=parameter(motion,'position','Vec2',{x:width/2,y:height/2},path);
        c.transform={x:bounded(p.x/width,-2,3,path,report),y:bounded(p.y/height,-2,3,path,report),scale:bounded(parameter(motion,'scale','Float',100,path)/100,.05,8,path,report),rotation:bounded(parameter(motion,'rotation','Float',0,path),-360,360,path,report),opacity:bounded(parameter(opacity,'opacity','Float',100,path)/100,0,1,path,report),flipX:false,flipY:false};
    }
    if(crop) {
        const [x,y,right,bottom]=['left','top','right','bottom'].map(k=>parameter(crop,k,'Float',0,path)/100);
        if([x,y,right,bottom].some(n=>n<0||n>1)||1-x-right<.05||1-y-bottom<.05)refuse('invalid_crop',{path});
        c.crop={x,y,width:1-x-right,height:1-y-bottom};
        loss(report,path,'crop','approximated','FilmCraft cropping and v3 fit-to-cropped-picture differ.');
    }
    for(const [id,allowed] of [['motion',['position','scale','rotation','uniform_scale']],['opacity',['opacity']],['crop',['left','top','right','bottom']],['volume',['level','bypass']],['graphic_text',['text','size','position','fill','fill_color']]]) {
        if(e.has(id))reportUnknown(e.get(id).params,allowed,`${path}.effects.${id}.params`,report);
    }
}
export function importProInterchange(input, options = {}) {
    return result(() => {
        // No JSON.parse of the object graph before bounded lexical scanning, including duplicate keys.
        const scan=scanProProject(input,{duplicateKeys:'all',keyBudget:300000});if(!scan.ok)refuse(scan.reason);
        const bytes=input instanceof ArrayBuffer?new Uint8Array(input):input;
        const doc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)), p=doc.project, report=[];
        reportUnknown(doc,['format','schema_version','generator','project'],'document',report);
        const supplied=structuredClone(assertManifest(options.manifest || {version:1,entries:[]}));
        const known=new Map(supplied.entries.map(e=>[e.virtualPath,e]));
        if(!obj(p.items)||!obj(p.root))refuse('invalid_project');identities(p);
        const items=new Map();
        for(const [key,item] of Object.entries(p.items)) {
            if(!obj(item)||String(item.id)!==key||!obj(item.kind)||Object.keys(item.kind).length!==1)refuse('invalid_item',{key:safeText(key,64)});
            items.set(item.id,item);
            reportUnknown(item,['id','name','label','kind','metadata'],`items.${item.id}`,report);
            if(item.metadata)reportUnknown(item.metadata,['veyrnox.tracks.v1'],`items.${item.id}.metadata`,report);
            loss(report,`items.${item.id}.label`,'item_label');
        }
        // Check references even in later sequences which will be dropped.
        for(const item of items.values())if(item.kind.Sequence)for(const t of [...array(item.kind.Sequence.video_tracks,'video_tracks'),...array(item.kind.Sequence.audio_tracks,'audio_tracks')])for(const c of array(t.items,'items'))if(!items.has(c.item))refuse('dangling_item',{item:c.item});
        const sequences=[...items.values()].filter(i=>i.kind.Sequence);
        if(!sequences.length)refuse('no_sequence');
        for(const item of sequences.slice(1))loss(report,`items.${item.id}`,'sequence','dropped','Only the first sequence is imported.');
        const seq=sequences[0].kind.Sequence, settings=seq.settings;
        const trackOrder=new Map(), orderValue=sequences[0].metadata?.['veyrnox.tracks.v1'];
        if(orderValue!==undefined) {
            if(typeof orderValue!=='string' || orderValue.length>4096 || !/^(?:[0-9]+:(?:video|audio|text))(?:,[0-9]+:(?:video|audio|text))*$/.test(orderValue))refuse('invalid_track_metadata');
            for(const [index,entry] of orderValue.split(',').entries()) {const [id,kind]=entry.split(':');if(!Number.isSafeInteger(Number(id))||trackOrder.has(Number(id)))refuse('invalid_track_metadata');trackOrder.set(Number(id),{index,kind});}
        }
        if(!obj(settings))refuse('invalid_settings');
        const width=number(settings.width,'width'),height=number(settings.height,'height');
        if(width<=0||height<=0||width>32768||height>32768)refuse('invalid_dimensions');
        const rate=rationalRate(settings.frame_rate);if(rate.num/rate.den!==30)loss(report,'sequence.settings.frame_rate','frame_rate','approximated','Conformed to 30 fps.');
        const tl=emptySequence();tl.tracks=[];tl.media=Object.create(null);
        tl.aspect=width/height===16/9?'16:9':width/height===9/16?'9:16':width===height?'1:1':'source';
        const manifest={version:1,entries:[]}, mediaIds=new Map(), usedIds=new Set(supplied.entries.map(e=>e.mediaId)), unknownPaths=new Map();
        let counter=0;
        const fresh=prefix=>`${prefix}${++counter}`;
        for(const item of items.values()) {
            if(item.kind.Sequence||item.kind.Graphic)continue;
            if(!item.kind.Media){loss(report,`items.${item.id}`,'item_kind');continue;}
            const m=item.kind.Media, info=m.info;if(!obj(info)||!obj(m.media))refuse('invalid_media');
            checkedTicks(info.duration,'media.duration');
            const path=m.media.File?.path;
            if(!m.media.File)loss(report,`items.${item.id}.media`,'generator','approximated','Generated media becomes an offline local-file placeholder.');
            if(path!==undefined&&typeof path!=='string')refuse('invalid_media_path');
            let entry=known.get(path);
            if(!entry) {
                const existing=path!==undefined?unknownPaths.get(path):undefined;
                if(existing){mediaIds.set(item.id,existing);loss(report,`items.${item.id}`,'shared_file','approximated','Repeated file path uses the first media metadata; item-specific metadata is dropped.');continue;}
                let id;do{id=fresh('local-');}while(usedIds.has(id));usedIds.add(id);
                const basename=safeSourceName(typeof path==='string'?path.split(/[\\/]/).at(-1):info.name || item.name);
                const kind=info.kind==='AudioOnly'?'audio':info.kind==='Still'?'image':'video';
                const frames=Math.max(1,Math.ceil(info.duration/TICKS_PER_FRAME));
                if(frames>1e7)refuse('media_duration_limit',{frames});
                const media={id,kind,frames,width:info.video?.width || 0,height:info.video?.height || 0,hasAudio:!!(info.audio_streams?.length || info.audio),...basename};
                entry=manifestEntry(media,report,`items.${item.id}`);entry.needsManualRelink ||= basename.needsManualRelink;
                loss(report,`items.${item.id}.media`,'offline_media','approximated','Unmapped media becomes a new local file requiring relinking.');
                if(entry.needsManualRelink)loss(report,`items.${item.id}.sourceName`,'needs_manual_relink','approximated','Original path or filename cannot be retained.',{code:'unsafe_source_name'});
                if(path!==undefined)unknownPaths.set(path,id);
            }
            if(entry.kind==='graphic')refuse('unsupported_graphic_media');
            loss(report,`items.${item.id}.info`,'media_metadata','approximated','Only kind, dimensions, duration and audio presence are retained; manifest metadata is authoritative when matched.');
            mediaIds.set(item.id,entry.mediaId);
            if(!Object.hasOwn(tl.media,entry.mediaId)) {tl.media[entry.mediaId]=manifestMedia(entry);manifest.entries.push({...entry,offline:true});}
            if(Object.keys(tl.media).length>40)refuse('limit_exceeded',{dimension:'media',count:Object.keys(tl.media).length,limit:40});
            reportUnknown(m,['media','info','offline','interpret','mark_in','mark_out','markers','proxy'],`items.${item.id}`,report);
            for(const k of ['interpret','mark_in','mark_out','markers','proxy'])if(m[k]!=null && (Array.isArray(m[k])?m[k].length:typeof m[k]==='object'?Object.values(m[k]).some(Boolean):true))loss(report,`items.${item.id}.${k}`,k);
        }
        const candidates=[], trackMap=new Map(), markers=[], linkCounts=new Map(), recombinedTracks=new Set();
        for(const kind of ['video','audio'])for(const [index,t] of array(seq[`${kind}_tracks`],kind).entries()) {
            const path=`${kind}_tracks.${index}`;
            if(!obj(t))refuse('invalid_track');
            const clips=array(t.items,`${path}.items`);
            for(const c of clips)if(c.link!=null){if(!Number.isSafeInteger(c.link)||c.link<0)refuse('invalid_link');linkCounts.set(c.link,(linkCounts.get(c.link)||0)+1);}
            if(kind==='audio' && /^veyrnox:solo-marker:\d+$/.test(t.name) && !clips.length && trackMap.get(Number(t.name.split(':').at(-1)))?.kind==='video') {markers.push(t);continue;}
            const allText=kind==='video' && (clips.length?clips.every(c=>items.get(c.item)?.kind.Graphic):trackOrder.get(t.id)?.kind==='text');
            const tk=allText?'text':kind;
            const dest={id:fresh(`${tk}-`),kind:tk,name:safe(t.name,40,`${tk} track`,`${path}.name`,report),locked:bool(t.locked,false,path),muted:bool(t.muted,false,path),solo:bool(t.solo,false,path),hidden:!bool(t.enabled,true,path)};
            tl.tracks.push(dest);trackMap.set(t.id,dest);
            if(kind==='audio' && t.enabled===false && !dest.muted){dest.muted=true;loss(report,`${path}.enabled`,'enabled','approximated','Disabled audio is represented as muted because v3 hidden does not silence sound.');}
            const pan=bounded((t.pan??0)/100,-1,1,`${path}.pan`,report),gain=number(t.volume_db??0,`${path}.volume_db`);
            reportUnknown(t,['id','kind','name','items','locked','muted','solo','enabled','pan','volume_db','sync_lock','channels','transitions'],path,report);
            if(t.transitions?.length)loss(report,`${path}.transitions`,'transition');
            if(t.channels && t.channels!=='Stereo')loss(report,`${path}.channels`,'channels');
            if(t.sync_lock===false)loss(report,`${path}.sync_lock`,'sync_lock');
            const sorted=clips.slice().sort((a,b)=>a.start-b.start);
            for(const [ci,original] of sorted.entries()) {
                const cp=`${path}.items.${ci}`,c={...original};
                checkedTicks(c.start,`${cp}.start`);checkedTicks(c.duration,`${cp}.duration`);checkedTicks(c.start+c.duration,`${cp}.end`);
                if(c.start+c.duration>MAX_SEQUENCE_TICKS)refuse('limit_exceeded',{dimension:'frames',count:Math.ceil((c.start+c.duration)/TICKS_PER_FRAME),limit:18000});checkedTicks(c.source_in,`${cp}.source_in`);
                c.speed=number(c.speed,`${cp}.speed`);if(!c.speed)refuse('invalid_speed',{path:cp});
                c.reverse=bool(c.reverse,false,cp);c.enabled=bool(c.enabled,true,cp);
                const originalFirst=sourceFirstTick(c);
                const next=sorted[ci+1];
                if(next && next.start<c.start+c.duration){c.duration=Math.max(0,next.start-c.start);loss(report,cp,'dropped:overlap','dropped','FilmCraft selects the latest-starting clip; the entire shadowed remainder is discarded.');}
                if(c.start+c.duration>MAX_SEQUENCE_TICKS)refuse('limit_exceeded',{dimension:'frames',count:Math.ceil((c.start+c.duration)/TICKS_PER_FRAME),limit:18000});
                const [start,endFrame,from0]=quantize([c.start,c.start+c.duration,originalFirst],cp,report),len=endFrame-start,from=c.reverse?Math.floor(originalFirst/TICKS_PER_FRAME):from0;
                if(!len){loss(report,cp,'dropped:zero_length');continue;}
                if(!c.enabled && t.enabled!==false){loss(report,cp,'disabled_clip','dropped','v3 has no per-clip enabled state.');continue;}
                const e=effectsFor(c,cp,report),item=items.get(c.item),g=e.get('graphic_text');
                if(item.kind.Graphic && g && kind==='video') {
                    let dt=dest;
                    if(tk!=='text') {dt=tl.tracks.find(x=>x.kind==='text') || {id:fresh('text-'),kind:'text',name:'Titles',locked:dest.locked,muted:dest.muted,solo:dest.solo,hidden:dest.hidden};if(!tl.tracks.includes(dt))tl.tracks.push(dt);loss(report,cp,'graphic_layering','approximated','Mixed graphic track moved above all video.');}
                    const pos=parameter(g,'position','Vec2',{x:width/2,y:height/2},cp),color=parameter(g,'fill_color','Color',[1,1,1,1],cp);
                    if(!Array.isArray(color)||color.length!==4||color.some(n=>!Number.isFinite(n)))refuse('invalid_color');
                    const hex='#'+color.slice(0,3).map(n=>Math.round(Math.max(0,Math.min(1,n))*255).toString(16).padStart(2,'0')).join('');
                    tl.text.push({id:fresh('t'),start,len,trackId:dt.id,text:safe(parameter(g,'text','Text','Title',cp),1000,'Title',cp,report,true),x:bounded(pos.x/width,0,1,cp,report),y:bounded(pos.y/height,0,1,cp,report),size:Math.round(bounded(parameter(g,'size','Float',100,cp)*100/height,2,40,cp,report)),style:{...TEXT_DEFAULTS,color:hex}});
                    loss(report,cp,'graphic_text','approximated','Text styling and metrics are approximated.');
                    visual({},e,width,height,cp,report);
                    for(const id of ['motion','opacity','crop','volume'])if(e.has(id))loss(report,`${cp}.effects.${id}`,id);
                    continue;
                }
                const mediaId=mediaIds.get(c.item);
                if(!mediaId){loss(report,cp,'unsupported_item');continue;}
                const m=tl.media[mediaId], speed=bounded(Math.abs(c.speed),.1,8,`${cp}.speed`,report);
                const volumeFx=e.get('volume'),level=parameter(volumeFx,'bypass','Bool',false,cp)?0:parameter(volumeFx,'level','Float',0,cp);
                const db=number(c.gain_db??0,`${cp}.gain_db`)+level+gain+number(seq.master_volume_db??0,'master_volume_db');
                const volume=kind==='video'?0:bounded(dbToVolume(db),0,2,`${cp}.volume`,report);
                const draft={id:fresh(kind[0]),mediaId,start,len,in:from,trackId:dest.id,volume,rate:speed,reverse:c.reverse,...(kind==='video'?{transition:0}:{}),...(pan?{pan}:{})};
                if(c.frame_hold!=null&&kind==='audio')loss(report,`${cp}.frame_hold`,'dropped:frame_hold','dropped','v3 audio clips cannot hold a frame.');
                else if(c.frame_hold!=null){draft.freezeFrame=quantize([checkedTicks(c.frame_hold)],`${cp}.frame_hold`,report)[0];draft.volume=0;
                    if(draft.freezeFrame>=m.frames){loss(report,cp,'approximated:clamped_source','approximated','Rounded held frame clamped to media.');draft.freezeFrame=m.frames-1;}
                }
                if(!['image','graphic'].includes(m.kind) && draft.freezeFrame===undefined) {
                    let span=(len-1)*speed;
                    if(span>=m.frames){const fit=Math.max(1,Math.floor((m.frames-1)/speed)+1);loss(report,cp,'approximated:clamped_length','approximated','Clip longer than its media was shortened to the media length.',{from:len,to:fit});draft.len=fit;span=(fit-1)*speed;}
                    const adjusted=Math.max(c.reverse?span:0,Math.min(m.frames-1-(c.reverse?0:span),draft.in));
                    if(adjusted!==draft.in){loss(report,cp,'approximated:clamped_source','approximated','Rounded source window clamped to available media.',{from:draft.in,to:adjusted});draft.in=adjusted;}
                }
                visual(draft,e,width,height,cp,report);
                loss(report,`${cp}.name`,'clip_name');loss(report,`${cp}.label`,'clip_label');
                if(c.scale_to_frame!==undefined)loss(report,`${cp}.scale_to_frame`,'scale_to_frame','approximated','v3 uses contain fitting by default.');
                reportUnknown(c,['id','item','name','label','start','duration','source_in','speed','reverse','enabled','effects','gain_db','frame_hold','link','scale_to_frame'],cp,report);
                tl[kind].push(draft);candidates.push({original,clip:draft,kind,track:t,dest,path:cp,effects:e});
            }
        }
        for(const marker of markers) {
            const dest=trackMap.get(Number(marker.name.split(':').at(-1)));
            if(dest){dest.solo=bool(marker.solo,false,'solo_marker.solo');loss(report,'audio_tracks','solo_marker','approximated','Restored solo marker to its video track.');}
            else loss(report,'audio_tracks','orphan_solo_marker');
        }
        // Link identity alone is insufficient: state and all source/timing fields must match.
        const links=new Map();for(const c of candidates)if(c.original.link!=null){const l=links.get(c.original.link)||[];l.push(c);links.set(c.original.link,l);}
        for(const group of links.values()) {
            const vs=group.filter(c=>c.kind==='video'),as=group.filter(c=>c.kind==='audio');
            if(vs.length!==1||as.length!==1||linkCounts.get(group[0].original.link)!==2){loss(report,group[0].path,'link','dropped','Ambiguous linked group remains separate.');continue;}
            const v=vs[0],a=as[0],same=['item','start','duration','source_in','speed','reverse','frame_hold'].every(k=>(v.original[k]??null)===(a.original[k]??null));
            const state=['muted','solo','locked'].every(k=>v.track[k]===a.track[k]) && !(a.track.pan??0) && !(a.track.volume_db??0) && (!a.track.channels || a.track.channels==='Stereo') && !(a.track.effects?.length) && a.track.enabled!==false && neutralMixer(a.track.mixer) && a.clip.freezeFrame===undefined;
            if(same&&state && ['start','len','in','rate','reverse'].every(k=>v.clip[k]===a.clip[k])){v.clip.volume=a.clip.volume;tl.audio=tl.audio.filter(c=>c!==a.clip);if(a.track.name===`veyrnox:audio:${v.track.id}`)recombinedTracks.add(a.dest.id);}
            else loss(report,a.path,'link_state','dropped','Linked clips kept separate because timing or audio-track state cannot be represented on the video track.');
        }
        // Only generated, now-empty companions disappear; ordinary empty tracks remain.
        tl.tracks=tl.tracks.filter(t=>!recombinedTracks.has(t.id) || tl.audio.some(c=>c.trackId===t.id));
        const destinationOrder=new Map([...trackMap].map(([id,t])=>[t.id,trackOrder.get(id)?.index ?? Infinity]));
        tl.tracks.sort((a,b)=>(destinationOrder.get(a.id)??Infinity)-(destinationOrder.get(b.id)??Infinity));
        for(const kind of ['video','audio','text'])if(!tl.tracks.some(t=>t.kind===kind))tl.tracks.push({id:fresh(`${kind}-`),kind,name:`${kind} track`,locked:false,muted:false,hidden:false,solo:false});
        for(const [i,m] of array(seq.markers??[],'markers').entries()) {
            const [frame]=quantize([checkedTicks(m.start,'marker.start',MAX_SEQUENCE_TICKS)],`markers.${i}`,report);
            tl.markers.push({id:fresh('m'),frame,label:safe(m.name,80,'Marker',`markers.${i}.name`,report),color:(typeof m.custom_color==='string'&&/^#[0-9a-f]{6}$/i.test(m.custom_color))?m.custom_color:(Object.hasOwn(LABELS,m.color)?LABELS[m.color]:'#ffffff')});
            reportUnknown(m,['id','start','name','color','custom_color'],`markers.${i}`,report);
        }
        reportUnknown(seq,['settings','video_tracks','audio_tracks','markers','master_volume_db'], 'sequence',report);
        reportUnknown(settings,['width','height','frame_rate'],'sequence.settings',report);
        reportUnknown(p,['name','settings','root','items','next_id'],'project',report);
        loss(report,'project.settings','project_settings');
        if(p.root.children?.some(c=>c.Bin))loss(report,'project.root','bins');
        tl.seq=counter;assertCounts(sequenceCounts(tl),refuse);assertManifest(manifest);
        const problem=validateSequence(tl);if(problem)refuse('invalid_sequence',{message:problem});
        return {draft:tl,manifest,report:boundReport(report)};
    });
}
