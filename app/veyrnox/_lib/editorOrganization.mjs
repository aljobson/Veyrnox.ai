const text=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
export const FONT_LIMITS=Object.freeze({count:8,bytes:2*1024*1024});
export const customFontFamily=sha=>`VXFont_${sha}`;
export const isCustomFontFamily=v=>typeof v==='string'&&/^VXFont_[a-f0-9]{64}$/.test(v);
export function folderProblem(value){
    return !text(value,80)||!value||value.split('/').length>4||value.split('/').some(p=>!p||p!==p.trim()||p==='.'||p==='..'||/[\\:*?<>|]/.test(p))?'Use a folder path up to 80 characters and four levels.':null;
}
export function fontMetadataProblem(f){
    if(!exact(f,['family','name','sourceName','sha256','bytes','format','rights'])||!text(f.name,80)||!f.name.trim()||!text(f.sourceName,255)||!f.sourceName||!/^[a-f0-9]{64}$/.test(f.sha256)||f.family!==customFontFamily(f.sha256)||!Number.isInteger(f.bytes)||f.bytes<12||f.bytes>FONT_LIMITS.bytes||!['ttf','otf','woff','woff2'].includes(f.format))return 'Invalid custom font metadata.';
    const r=f.rights;if(!exact(r,['credit','usage','url'])||!text(r.credit,120)||!text(r.usage,240)||!r.usage.trim()||!text(r.url,1000))return 'Record the font source and permission to use it.';
    if(r.url){try{const u=new URL(r.url);if(u.protocol!=='https:'||u.username||u.password)return 'Use an HTTPS font licence URL.';}catch{return 'Use an HTTPS font licence URL.';}}
    return null;
}
export function organizationProblem(tl){
    if(tl.folders!==undefined&&(!Array.isArray(tl.folders)||tl.folders.length>40||new Set(tl.folders).size!==tl.folders.length||tl.folders.some(folderProblem)))return 'Use up to 40 distinct valid folder paths.';
    if(tl.fonts!==undefined&&(!Array.isArray(tl.fonts)||tl.fonts.length>FONT_LIMITS.count||new Set(tl.fonts.map(f=>f?.family)).size!==tl.fonts.length||tl.fonts.some(fontMetadataProblem)))return 'Use up to eight valid custom fonts with recorded rights.';
    for(const c of Array.isArray(tl.text)?tl.text:[])if(isCustomFontFamily(c?.style?.font)&&!tl.fonts?.some(f=>f.family===c.style.font))return 'Relink a declared custom font before using it.';
    return null;
}
export function folderPaths(tl){
    const paths=[...(tl.folders||[]),...Object.values(tl.media).map(m=>m.folder).filter(Boolean)];
    return [...new Set(paths.flatMap(path=>path.split('/').map((_,i,parts)=>parts.slice(0,i+1).join('/'))))].sort((a,b)=>a.localeCompare(b));
}
function canonicalFolders(tl){
    const paths=[...(tl.folders||[]),...Object.values(tl.media).map(m=>m.folder)].filter(p=>!folderProblem(p));
    return folderPaths({folders:paths,media:{}});
}
export function createFolder(tl,path){
    const error=folderProblem(path);if(error)return {error};
    if(folderPaths(tl).includes(path))return {error:'That folder already exists.'};
    const folders=canonicalFolders({...tl,folders:[...(tl.folders||[]),path]});return folders.length>40?{error:'A project holds up to 40 folder paths.'}:{...tl,folders};
}
export function moveFolder(tl,from,to){
    const error=folderProblem(to);if(error)return {error};
    if(!folderPaths(tl).includes(from))return {error:'Choose an existing folder.'};
    if(to===from)return tl;
    if(to.startsWith(`${from}/`))return {error:'Move a folder outside its own children.'};
    if(folderPaths(tl).some(p=>p===to||p.startsWith(`${to}/`)))return {error:'The destination folder already exists.'};
    const move=p=>p===from||p?.startsWith(`${from}/`)?to+p.slice(from.length):p;
    const moved=canonicalFolders(tl).map(move),media=Object.fromEntries(Object.entries(tl.media).map(([id,m])=>[id,m.folder?{...m,folder:move(m.folder)}:m]));
    if(moved.some(folderProblem))return {error:'The moved folder exceeds the path limits.'};
    const folders=canonicalFolders({...tl,folders:moved,media});
    if(folders.length>40)return {error:'The moved folder exceeds the path limits.'};
    return {...tl,folders,media};
}
export function deleteEmptyFolder(tl,path){
    if(!folderPaths(tl).includes(path))return {error:'Choose an existing folder.'};
    if(Object.values(tl.media).some(m=>m.folder===path||m.folder?.startsWith(`${path}/`)))return {error:'Move the media out of this folder and its children first.'};
    return {...tl,folders:canonicalFolders(tl).filter(p=>p!==path&&!p.startsWith(`${path}/`))};
}
export function addCustomFont(tl,font){
    const error=fontMetadataProblem(font);if(error)return {error};
    if(tl.fonts?.some(f=>f.family===font.family))return tl;
    if((tl.fonts?.length||0)>=FONT_LIMITS.count)return {error:'A project holds up to eight custom fonts.'};
    return {...tl,fonts:[...(tl.fonts||[]),font]};
}
export function removeCustomFont(tl,family){
    if(tl.text.some(c=>c.style?.font===family))return {error:'Choose another font for text using this font first.'};
    return {...tl,fonts:(tl.fonts||[]).filter(f=>f.family!==family)};
}
