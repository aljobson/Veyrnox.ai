import { TEXT_DEFAULTS,validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { emptySequence,addSequenceText } from '../app/veyrnox/_lib/editorSequence.mjs';
import { mediaDetailsProblem } from '../app/veyrnox/_lib/editorMediaDetails.mjs';
import { TEXT_FONTS } from '../app/veyrnox/_lib/editorTextStyle.mjs';
const object=v=>v && typeof v==='object' && !Array.isArray(v);
const exact=(v,k)=>object(v)&&Object.keys(v).length===k.length&&Object.keys(v).every(x=>k.includes(x));
const text=(v,n)=>typeof v==='string' && v.length<=n && !/[\u0000-\u001f\u007f]/.test(v);
const uuid=v=>typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const emptyBrandKit=()=>({schemaVersion:1,name:'My brand',palette:['#32d6c5','#ffffff','#101827'],fonts:['Arial'],textStyles:[],assets:[]});
export function brandKitProblem(v) {
    if(!exact(v,['schemaVersion','name','palette','fonts','textStyles','assets']) || v.schemaVersion!==1 || !text(v.name,80) || !v.name.trim() || !Array.isArray(v.palette) || v.palette.length>12 || !v.palette.length || v.palette.some(c=>typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c)) || !Array.isArray(v.fonts) || v.fonts.length>10 || !v.fonts.length || v.fonts.some(f=>!TEXT_FONTS.includes(f)) || !Array.isArray(v.textStyles) || v.textStyles.length>12 || !Array.isArray(v.assets) || v.assets.length>24)return 'Invalid brand kit.';
    for(const preset of v.textStyles){if(!exact(preset,['name','size','style']) || !text(preset.name,80) || !preset.name.trim() || !Number.isInteger(preset.size) || preset.size<2 || preset.size>40 || (!object(preset.style) || Object.keys(TEXT_DEFAULTS).some(k=>!Object.hasOwn(preset.style,k))))return 'Invalid brand text style.';const t=addSequenceText(emptySequence(),{text:'Brand style',size:preset.size,style:{...TEXT_DEFAULTS,...preset.style}});if(t.error || validateSequence(t))return 'Invalid brand text style.';}
    for(const asset of v.assets){if(!exact(asset,['projectId','assetId','name','credit','usage','url']) || !uuid(asset.projectId) || !uuid(asset.assetId) || !text(asset.name,120) || !asset.name.trim() || mediaDetailsProblem({attribution:{credit:asset.credit,usage:asset.usage,url:asset.url}}))return 'Invalid brand asset.';}
    if(new TextEncoder().encode(JSON.stringify(v)).byteLength>8192)return 'This brand kit exceeds the save limit.';
    return null;
}
export function reviewCommentProblem(v) {
    if(!exact(v,['revision','frame','body']) || !Number.isSafeInteger(v.revision) || v.revision<1 || v.revision>2147483646 || !Number.isInteger(v.frame) || v.frame<0 || v.frame>18000 || typeof v.body!=='string' || !v.body.trim() || v.body.length>2000 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(v.body))return 'Choose a saved revision, a valid frame and a comment up to 2,000 characters.';
    return null;
}
