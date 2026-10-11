const text=(v,max)=>typeof v==='string' && v.length<=max && !/[\u0000-\u001f\u007f]/.test(v);
export function mediaDetailsProblem(m) {
    if(m.sourceName!==undefined && (!text(m.sourceName,255)||!m.sourceName))return 'Invalid original source name.';
    if(m.folder!==undefined && (!text(m.folder,80)||m.folder.split('/').length>4||m.folder.split('/').some(part=>part && (!part.trim()||part==='.'||part==='..'||/[\\:*?<>|]/.test(part)))))return 'Use a folder name up to 80 characters and four levels.';
    const note=m.attribution;
    if(note!==undefined){if(!note||typeof note!=='object'||Object.keys(note).length!==3||!text(note.credit,120)||!text(note.usage,240)||!text(note.url,1000))return 'Invalid media attribution.';if(note.url){try{const u=new URL(note.url);if(u.protocol!=='https:'||u.username||u.password)return 'Use an HTTPS source or licence URL.';}catch{return 'Use an HTTPS source or licence URL.';}}}
    return null;
}
export const mediaFolders=tl=>[...new Set(Object.values(tl.media).map(m=>m.folder).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
export function matchingMedia(tl,{search='',kind='all',folder='*'}={}) {
    const q=search.toLowerCase();return Object.values(tl.media).filter(m=>(kind==='all'||m.kind===kind)&&(folder==='*'||(m.folder||'')===folder)&&[m.name,m.folder,m.attribution?.credit,m.attribution?.usage].filter(Boolean).some(s=>s.toLowerCase().includes(q)));
}
