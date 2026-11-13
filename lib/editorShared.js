import { helperEnglish } from './helperMessages.mjs';
import { TEXT_DEFAULTS,validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { emptySequence,addSequenceText } from '../app/veyrnox/_lib/editorSequence.mjs';
import { mediaDetailsProblem } from '../app/veyrnox/_lib/editorMediaDetails.mjs';
import { TEXT_FONTS } from '../app/veyrnox/_lib/editorTextStyle.mjs';
const object=v=>v && typeof v==='object' && !Array.isArray(v);
const exact=(v,k)=>object(v)&&Object.keys(v).length===k.length&&Object.keys(v).every(x=>k.includes(x));
const text=(v,n)=>typeof v==='string' && v.length<=n && !/[\u0000-\u001f\u007f]/.test(v);
const uuid=v=>typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
// The ten colours a brand kit offers. Mobile keeps the same list in apps/mobile/src/lib/brandKit.ts.
export const BRAND_SWATCHES=[{id:'teal',hex:'#32d6c5'},{id:'blue',hex:'#2563eb'},{id:'purple',hex:'#7c3aed'},{id:'pink',hex:'#ec4899'},{id:'red',hex:'#ef4444'},{id:'orange',hex:'#f97316'},{id:'yellow',hex:'#facc15'},{id:'green',hex:'#22c55e'},{id:'white',hex:'#ffffff'},{id:'navy',hex:'#101827'}];
export const emptyBrandKit=()=>({schemaVersion:2,logo:null,voice:'',hashtags:[],name:'My brand',palette:['#32d6c5','#ffffff','#101827'],fonts:['Arial'],textStyles:[],assets:[]});
export const normalizeBrandKit=v=>({...v,schemaVersion:2,logo:v.logo??null,voice:v.voice??'',hashtags:(v.hashtags??[]).map(tag=>tag.replace(/^#/,''))});
// Form drafts keep raw text; only valid whole-number sizes enter a saved kit.
export function brandTextStyleSize(value) {
    if(typeof value!=='number' && (typeof value!=='string' || !/^\d+$/.test(value)))return null;
    const size=Number(value);
    return Number.isInteger(size) && size>=2 && size<=40 ? size : null;
}
export function brandKitProblem(v) {
    if(!object(v) || !['schemaVersion','name','palette','fonts','textStyles','assets'].every(k=>Object.hasOwn(v,k)) || Object.keys(v).some(k=>!['schemaVersion','name','palette','fonts','textStyles','assets','logo','voice','hashtags'].includes(k)) || ![1,2].includes(v.schemaVersion) || !text(v.name,80) || !v.name.trim() || !Array.isArray(v.palette) || v.palette.length>12 || !v.palette.length || v.palette.some(c=>typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c)) || !Array.isArray(v.fonts) || v.fonts.length>10 || !v.fonts.length || v.fonts.some(f=>!TEXT_FONTS.includes(f)) || !Array.isArray(v.textStyles) || v.textStyles.length>12 || !Array.isArray(v.assets) || v.assets.length>24)return helperEnglish('invalid_brand_kit');
    if(v.voice !== undefined && (!text(v.voice,500) || /\p{Cc}/u.test(v.voice)))return helperEnglish('invalid_brand_voice');
    if(v.hashtags !== undefined && (!Array.isArray(v.hashtags) || v.hashtags.length>30 || v.hashtags.some(tag=>typeof tag!=='string'||!/^#?[\p{L}\p{N}_]{1,60}$/u.test(tag))))return helperEnglish('invalid_brand_hashtags');
    if(v.logo != null && (!exact(v.logo,['projectId','assetId']) || !uuid(v.logo.projectId) || !uuid(v.logo.assetId) || !v.assets.some(a=>a?.projectId===v.logo.projectId&&a.assetId===v.logo.assetId)))return helperEnglish('invalid_brand_logo');
    for(const preset of v.textStyles){if(!exact(preset,['name','size','style']) || !text(preset.name,80) || !preset.name.trim() || !Number.isInteger(preset.size) || preset.size<2 || preset.size>40 || (!object(preset.style) || Object.keys(TEXT_DEFAULTS).some(k=>!Object.hasOwn(preset.style,k))))return helperEnglish('invalid_brand_text_style');const t=addSequenceText(emptySequence(),{text:'Brand style',size:preset.size,style:{...TEXT_DEFAULTS,...preset.style}});if(t.error || validateSequence(t))return helperEnglish('invalid_brand_text_style');}
    for(const asset of v.assets){if(!exact(asset,['projectId','assetId','name','credit','usage','url']) || !uuid(asset.projectId) || !uuid(asset.assetId) || !text(asset.name,120) || !asset.name.trim() || mediaDetailsProblem({attribution:{credit:asset.credit,usage:asset.usage,url:asset.url}}))return helperEnglish('invalid_brand_asset');}
    if(new TextEncoder().encode(JSON.stringify(v)).byteLength>8192)return helperEnglish('this_brand_kit_exceeds_the_save_limit');
    return null;
}
export function reviewCommentProblem(v) {
    if(!exact(v,['revision','frame','body']) || !Number.isSafeInteger(v.revision) || v.revision<1 || v.revision>2147483646 || !Number.isInteger(v.frame) || v.frame<0 || v.frame>18000 || typeof v.body!=='string' || !v.body.trim() || v.body.length>2000 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(v.body))return 'Choose a saved revision, a valid frame and a comment up to 2,000 characters.';
    return null;
}
