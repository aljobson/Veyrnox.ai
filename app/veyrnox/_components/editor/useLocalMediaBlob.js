'use client';
import {useEffect,useState} from 'react';
export function useLocalMediaBlob(blobs,id,loaded){
    const [value,setValue]=useState({id:null,blob:null});
    useEffect(()=>{
        let active=true;const blob=blobs.current.get(id)||null;
        queueMicrotask(()=>{if(active)setValue(previous=>previous.id===id&&previous.blob===blob?previous:{id,blob});});
        return()=>{active=false;};
    },[blobs,id,loaded]);
    return value.id===id?value.blob:null;
}
