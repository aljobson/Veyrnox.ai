'use client';
import { useEffect,useRef,useState } from 'react';
import { Button } from '../Button';
import { voiceoverExtension,voiceoverMime,voiceoverProblem } from '../../_lib/editorVoiceover.mjs';

const clock=seconds=>`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
export function VoiceoverRecorder({disabled,onRecord,onError}){
    const recorder=useRef(null),stream=useRef(null),chunks=useRef([]),timer=useRef(null),started=useRef(0),[state,setState]=useState('idle'),[elapsed,setElapsed]=useState(0);
    const release=()=>{clearInterval(timer.current);stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;recorder.current=null;};
    useEffect(()=>release,[]);
    async function start(){
        if(!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder){onError('Microphone recording is unavailable in this browser.');return;}
        setState('starting');onError('');
        try{
            const input=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false}),mime=voiceoverMime();
            stream.current=input;chunks.current=[];const active=new MediaRecorder(input,mime?{mimeType:mime}:undefined);recorder.current=active;
            active.ondataavailable=event=>{if(event.data.size)chunks.current.push(event.data);};
            active.onerror=()=>{onError('The microphone recording stopped unexpectedly.');setState('idle');release();};
            active.onstop=async()=>{
                const type=active.mimeType || mime || chunks.current[0]?.type || 'audio/webm',blob=new Blob(chunks.current,{type});release();setState('saving');
                if(!blob.size){onError('No microphone sound was captured.');setState('idle');return;}
                try{const stamp=new Date().toISOString().replace(/[:.]/g,'-'),file=new File([blob],`voiceover-${stamp}.${voiceoverExtension(type)}`,{type});await onRecord(file,`Voiceover ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`);setState('idle');setElapsed(0);}
                catch(error){onError(error.message || 'The voiceover could not be added.');setState('idle');}
            };
            active.start(250);started.current=Date.now();setElapsed(0);setState('recording');timer.current=setInterval(()=>{const seconds=Math.floor((Date.now()-started.current)/1000);setElapsed(seconds);if(seconds>=600 && active.state==='recording')active.stop();},1000);
        }catch(error){release();setState('idle');onError(voiceoverProblem(error));}
    }
    function stop(){if(recorder.current?.state==='recording'){setState('stopping');recorder.current.stop();}}
    function cancel(){if(recorder.current?.state==='recording'){chunks.current=[];recorder.current.onstop=()=>{release();setState('idle');setElapsed(0);};recorder.current.stop();}}
    return <section aria-label="Record voiceover" className="space-y-2 rounded-xl border border-vx-border p-3">
        <h3 className="text-xs font-bold">Record voiceover</h3><p className="text-[10px] text-vx-fg-muted">Records from your microphone on this device and places the take at the playhead. Maximum 10 minutes.</p>
        <p role="status" aria-live="polite" className="text-xs">{state==='recording'?`Recording · ${clock(elapsed)}`:state==='starting'?'Requesting microphone…':state==='saving'||state==='stopping'?'Adding voiceover…':'Ready'}</p>
        {state==='idle'?<Button size="sm" disabled={disabled} onClick={start}>Start recording</Button>:<><Button size="sm" disabled={state!=='recording'} onClick={stop}>Stop and add</Button><Button size="sm" variant="ghost" disabled={state!=='recording'} onClick={cancel}>Cancel</Button></>}
    </section>;
}
