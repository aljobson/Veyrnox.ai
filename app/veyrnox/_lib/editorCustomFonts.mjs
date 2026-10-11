import {FONT_LIMITS,customFontFamily,fontMetadataProblem,isCustomFontFamily} from './editorOrganization.mjs';
export function fontFormat(bytes){
    if(bytes.length<12)return null;
    const signature=String.fromCharCode(...bytes.slice(0,4));
    if(bytes[0]===0&&bytes[1]===1&&bytes[2]===0&&bytes[3]===0)return 'ttf';
    return {OTTO:'otf',wOFF:'woff',wOF2:'woff2'}[signature]||null;
}
export async function customFontFromFile(file,{name,rights}){
    if(!file||file.size<12||file.size>FONT_LIMITS.bytes)throw new Error('Choose a TTF, OTF, WOFF or WOFF2 font up to 2 MiB.');
    const bytes=await file.arrayBuffer(),format=fontFormat(new Uint8Array(bytes));if(!format)throw new Error('This file is not a supported font.');
    const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
    const font={family:customFontFamily(sha256),name:name.trim(),sourceName:file.name,sha256,bytes:bytes.byteLength,format,rights};
    const error=fontMetadataProblem(font);if(error)throw new Error(error);return {font,bytes};
}
export function createFontRegistry({FontFaceCtor=globalThis.FontFace,fontSet=globalThis.document?.fonts}={}){
    const faces=new Map(),pending=new Set();let epoch=0;
    return {
        has:family=>faces.has(family),
        async install(font,bytes){
            const error=fontMetadataProblem(font);if(error)throw new Error(error);
            if(faces.has(font.family))return;
            if(pending.has(font.family))throw new Error('This font is already loading.');
            if(faces.size+pending.size>=FONT_LIMITS.count)throw new Error('Eight font files are loaded. Reopen the editor to start a new font session.');
            if(!FontFaceCtor||!fontSet)throw new Error('This browser cannot load local font files.');
            const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
            if(sha!==font.sha256||bytes.byteLength!==font.bytes)throw new Error('Choose the original font file with the matching SHA-256.');
            const generation=epoch;pending.add(font.family);
            try{const face=new FontFaceCtor(font.family,bytes);await face.load();if(generation!==epoch)throw new Error('The font session changed. Choose the font again.');fontSet.add(face);faces.set(font.family,face);}finally{pending.delete(font.family);}
        },
        clear(){epoch++;for(const face of faces.values())fontSet?.delete(face);faces.clear();pending.clear();},
    };
}
export function missingCustomFont(tl,registry){
    const used=new Set(tl.text.filter(c=>!tl.tracks.find(t=>t.id===c.trackId)?.hidden).map(c=>c.style?.font).filter(isCustomFontFamily));
    const missing=tl.fonts?.find(f=>used.has(f.family)&&!registry?.has(f.family));
    return missing?`Relink the custom font “${missing.name}” before export.`:null;
}
