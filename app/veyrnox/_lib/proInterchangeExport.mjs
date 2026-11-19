import { validateSequence } from './editorSequenceValidation.mjs';
import { createMediaManifest, assertManifest, safeText } from './proMediaManifest.mjs';
import { result, refuse, loss, framesToTicks, sourceInClamped, volumeToDb, checkedTicks, MAX_SEQUENCE_TICKS } from './proInterchangeTime.mjs';
import { reportDispositions } from './proInterchangeDispositions.mjs';
import { mediaInfo, projectSettings, sequenceSettings, nearestLabel, visualEffects, textEffects, stackingLanes, assertCounts, sequenceCounts } from './proInterchangeFormat.mjs';
import { importProInterchange } from './proInterchangeImport.mjs';
import { scanProProject } from '../../../lib/proProjectScan.mjs';
export { stackingLanes } from './proInterchangeFormat.mjs';
export function exportProInterchange(tl, options = {}) {
    return result(() => {
        const counts = sequenceCounts(tl); assertCounts(counts,refuse);
        const bad = validateSequence(tl); if (bad) refuse('invalid_sequence',{message:bad});
        const report = []; reportDispositions(tl,'document','sequence',report);
        const manifest = options.manifest ? structuredClone(assertManifest(options.manifest)) : createMediaManifest(tl.media,report);
        const byMedia = new Map(manifest.entries.map(e=>[e.mediaId,e]));
        for (const m of Object.values(tl.media)) {
            const entry = byMedia.get(m.id);
            if (!entry || ['kind','frames','width','height','hasAudio'].some(k=>entry[k]!==m[k])) refuse('manifest_media_mismatch',{mediaId:m.id});
            if (m.kind === 'graphic') refuse('unsupported_graphic_media',{mediaId:m.id});
            reportDispositions(m,'media',`media.${m.id}`,report);
            if(m.kind!=='audio' && (!m.width||!m.height))loss(report,`media.${m.id}`,'dimensions','approximated','Unknown dimensions use the neutral MediaInfo defaults.');
        }
        const size = {'16:9':[1920,1080],'9:16':[1080,1920],'1:1':[1080,1080]}[tl.aspect];
        const first = Object.values(tl.media).find(m=>m.kind==='video');
        const [width,height] = size || [first?.width,first?.height];
        if (!width || !height) refuse('source_dimensions_missing');
        let next = 1; const allocate = () => next++;
        const items = {}, mediaIds = new Map();
        for (const e of manifest.entries) {
            const id = allocate(); mediaIds.set(e.mediaId,id);
            items[id] = {id,name:e.name,label:'Iris',kind:{Media:{media:{File:{path:e.virtualPath}},info:mediaInfo(e),interpret:{frame_rate:null,par:null,ignore_alpha:false,invert_alpha:false},mark_in:null,mark_out:null,markers:[],offline:true,proxy:null}}};
        }
        const sequenceId = allocate();
        const sequence = {settings:sequenceSettings(width,height),video_tracks:[],audio_tracks:[],markers:[],mark_in:null,mark_out:null,work_area:null,start_timecode:0};
        const track = (t, kind, name = t.name) => ({id:allocate(),kind:kind==='audio'?'Audio':'Video',name,items:[],transitions:[],locked:t.locked,sync_lock:true,enabled:!t.hidden,muted:t.muted,solo:!!t.solo,channels:'Stereo',volume_db:0,pan:0});
        const clip = (c,t,kind) => {
            const base = {id:allocate(),item:mediaIds.get(c.mediaId),name:safeText(tl.media[c.mediaId]?.name,120,'Title'),label:'Iris',start:framesToTicks(c.start),duration:framesToTicks(c.len),source_in:0,speed:c.rate ?? 1,reverse:!!c.reverse,enabled:!t.hidden,effects:[],gain_db:kind==='audio'?volumeToDb(c.volume):-96};
            if(kind!=='text'){const s=sourceInClamped(c);base.source_in=s.value;if(s.clamped)loss(report,`${kind}.${c.id}`,'approximated:clamped_source','approximated','Reversed window starts before source frame 0; source_in clamped to 0.');}
            checkedTicks(base.start+base.duration,'end',MAX_SEQUENCE_TICKS);
            if(c.freezeFrame!==undefined) base.frame_hold = framesToTicks(c.freezeFrame);
            if(kind==='text') {
                const id=allocate(); items[id]={id,name:safeText(c.text,120,'Title'),label:'Lavender',kind:{Graphic:{width,height,rate:{num:30,den:1}}}};
                base.item=id; base.effects=textEffects(c,width,height);
            } else if(kind==='video') {base.effects=visualEffects(c,width,height);base.scale_to_frame=true;}
            return base;
        };
        let companions=0;
        const order = new Map();
        // Text is drawn above ALL video in our renderer, regardless of the track array order.
        for (const kind of ['video','text','audio']) for (const t of tl.tracks.filter(t=>t.kind===kind)) {
            reportDispositions(t,'track',`tracks.${t.id}`,report);
            if(kind==='audio' && t.hidden) loss(report,`tracks.${t.id}.hidden`,'hidden','dropped','v3 hidden is visual only; the exported audio track stays enabled so it is not silenced.');
            const sourceClips=tl[kind].filter(c=>c.trackId===t.id);
            const lanes=stackingLanes(sourceClips);
            if(lanes.length>1) loss(report,`tracks.${t.id}`,'overlap_lanes','approximated','Overlaps become separate tracks; lane splitting is not reversible.',{lanes:lanes.length});
            for(const c of sourceClips) {
                reportDispositions(c,kind==='text'?'text':'clip',`${kind}.${c.id}`,report);
                if(kind==='text' && !c.style) loss(report,`text.${c.id}.style`,'style','approximated','Implicit v3 font, weight, stroke and layout defaults differ from FilmCraft.');
                if(kind==='video' && !c.transform) loss(report,`video.${c.id}.transform`,'transform','approximated','Default contain scaling is represented using FilmCraft scale-to-frame.');
            }
            const sourceTracks=[]; let audioBearing=false;
            for(const [laneIndex,lane] of lanes.entries()) {
                const ft=track(t,kind,laneIndex?`${t.name} lane ${laneIndex+1}`:t.name);if(kind==='audio')ft.enabled=true;
                sourceTracks.push(ft);
                const entries=order.get(t.id)||[];entries.push(`${ft.id}:${kind}`);order.set(t.id,entries);
                const pans=new Set(lane.map(c=>c.pan??0));
                if(pans.size===1) ft.pan=[...pans][0]*100;
                else if(pans.size>1) loss(report,`tracks.${t.id}.pan`,'pan','dropped','Nonuniform clip pan cannot be represented by one track pan.');
                const sounds=kind==='video'?lane.filter(c=>tl.media[c.mediaId].hasAudio && c.volume>0):[];
                const at=sounds.length?track(t,'audio',`veyrnox:audio:${ft.id}`):null;
                if(at){at.enabled=true;at.pan=ft.pan;sequence.audio_tracks.push(at);audioBearing=true;}
                for(const c of lane) {
                    const fc=clip(c,t,kind);ft.items.push(fc);
                    if(sounds.includes(c)) {
                        const ac=clip(c,t,'audio'),link=allocate();ac.enabled=true;fc.link=link;ac.link=link;at.items.push(ac);companions++;
                        loss(report,`video.${c.id}`,'generated:audio_companion','approximated','Video sound split into a linked audio companion.',{audioClip:ac.id});
                    }
                }
                (kind==='audio'?sequence.audio_tracks:sequence.video_tracks).push(ft);
            }
            if(kind==='video' && t.solo && !audioBearing) {
                const marker=track(t,'audio',`veyrnox:solo-marker:${sourceTracks[0].id}`);marker.solo=true;marker.enabled=true;sequence.audio_tracks.push(marker);
                loss(report,`tracks.${t.id}.solo`,'generated:solo_marker','approximated','Empty audio solo marker preserves global solo suppression.');
            }
        }
        for (const m of tl.markers || []) {
            reportDispositions(m,'marker',`markers.${m.id}`,report);
            sequence.markers.push({id:allocate(),start:framesToTicks(m.frame),duration:0,name:m.label,comment:'',kind:'Comment',color:nearestLabel(m.color),custom_color:m.color});
        }
        assertCounts({...counts,audio:counts.audio+companions,tracks:sequence.video_tracks.length+sequence.audio_tracks.length},refuse);
        items[sequenceId]={id:sequenceId,name:safeText(options.name,120,'Sequence'),label:'Forest',kind:{Sequence:sequence},metadata:{'veyrnox.tracks.v1':tl.tracks.flatMap(t=>order.get(t.id)||[]).join(',')}};
        const project={name:safeText(options.name,120,'Veyrnox sequence'),settings:projectSettings(),root:{id:0,name:'Root',children:Object.keys(items).map(id=>({Item:Number(id)}))},items,next_id:next};
        const bytes=new TextEncoder().encode(JSON.stringify({format:'filmcraft.project',schema_version:17,generator:'Veyrnox P3 interchange (experimental)',project}));
        const scan=scanProProject(bytes,{duplicateKeys:'all'});if(!scan.ok)refuse(scan.reason);
        const reimport=importProInterchange(bytes,{manifest});
        if(!reimport.ok) refuse('reimport_refused',reimport.error);
        return {bytes,manifest,report};
    });
}
