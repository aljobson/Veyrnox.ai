'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import { getStoredUserId,onSessionChange } from '../../../lib/authClient';
import { gatewayFetch,makeIdempotencyKey } from '../../_lib/gateway';
const message=e=>e.status===401?'Sign in to open your workspace.':e.status===409?'A newer version was saved. Reload the saved version before retrying.':e.status===404?'This resource is unavailable or you no longer have access.':e.status===429?'Too many changes. Try again in a minute.':'Could not complete this request. Your draft is kept.';
export function useEditorResource(path) {
    const [accountId,setAccountId]=useState(()=>getStoredUserId()),[record,setRecord]=useState({identity:null,data:null,error:''}),[busy,setBusy]=useState(false),current=useRef(null),ticket=useRef(0),pending=useRef(null),actor=useRef(accountId);
    const identity=`${accountId || ''}:${path || ''}`;current.current=identity;
    const data=record.identity===identity?record.data:null,error=record.identity===identity?record.error:'';
    const read=useCallback(async signal=>{
        if(!path)return;const id=++ticket.current;
        try{const value=await gatewayFetch(path,{signal});if(!signal?.aborted && id===ticket.current && current.current===identity)setRecord({identity,data:value,error:''});}
        catch(e){if(!signal?.aborted && id===ticket.current && current.current===identity)setRecord(previous=>({identity,data:previous.identity===identity?previous.data:null,error:message(e)}));}
        finally{if(!signal?.aborted && id===ticket.current && current.current===identity)setBusy(false);}
    },[path,identity]);
    useEffect(()=>onSessionChange(s=>{const next=s?.user?.id || null;if(next===actor.current)return;actor.current=next;ticket.current++;current.current=null;pending.current=null;setBusy(false);setAccountId(next);}),[]);
    useEffect(()=>{pending.current=null;const controller=new AbortController();void read(controller.signal);return()=>controller.abort();},[read]);
    const reload=()=>{if(path){setBusy(true);void read();}};
    const setData=value=>setRecord(previous=>({identity,data:typeof value==='function'?value(previous.identity===identity?previous.data:null):value,error:''}));
    const mutate=async(body,method)=>{
        if(!path || busy || actor.current!==accountId || getStoredUserId()!==accountId)return null;const id=++ticket.current,signature=JSON.stringify({identity,method,body});
        if(pending.current?.signature!==signature)pending.current={signature,key:makeIdempotencyKey()};setBusy(true);
        try{const value=await gatewayFetch(path,{method,body:JSON.stringify(body),headers:{'idempotency-key':pending.current.key}});if(id!==ticket.current || current.current!==identity)return null;pending.current=null;return value;}
        catch(e){if(id===ticket.current && current.current===identity)setRecord(previous=>({...previous,error:message(e)}));return null;}
        finally{if(id===ticket.current && current.current===identity)setBusy(false);}
    };
    const loadMore=async cursor=>{
        if(!path || !cursor || busy)return;const id=++ticket.current;setBusy(true);
        try{const page=await gatewayFetch(`${path}&before=${encodeURIComponent(cursor)}`);if(id===ticket.current && current.current===identity)setData(previous=>previous?{...page,comments:[...previous.comments,...page.comments.filter(c=>!previous.comments.some(p=>p.id===c.id))]}:page);}
        catch(e){if(id===ticket.current && current.current===identity)setRecord(previous=>({...previous,error:message(e)}));}
        finally{if(id===ticket.current && current.current===identity)setBusy(false);}
    };
    return {data,busy:!!path && (busy || record.identity!==identity),error,reload,mutate,setData,accountId,loadMore};
}
