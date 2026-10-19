import { helperEnglish } from '../../../lib/helperMessages.mjs';
const normal=s=>s.trim().replace(/\s+/g,' ');
export const WORD_STYLE=Object.freeze({mode:'highlight',color:'#ffe66d'});
export function wordTimingProblem(clip) {
    const words=clip.words;
    if(clip.wordsEstimated!==undefined && typeof clip.wordsEstimated!=='boolean')return helperEnglish('invalid_word_timing_source');
    if(clip.wordStyle!==undefined && (!clip.wordStyle || Object.keys(clip.wordStyle).length!==2 || !['none','highlight','karaoke','word'].includes(clip.wordStyle.mode) || !/^#[0-9a-fA-F]{6}$/.test(clip.wordStyle.color)))return helperEnglish('invalid_word_highlight_style');
    if(words===undefined || (Array.isArray(words)&&!words.length))return null;
    if(!clip.caption || !Array.isArray(words)||words.length>100 || words.some((w,i)=>!w||typeof w!=='object'||Object.keys(w).length!==3||typeof w.text!=='string'||!w.text.trim()||w.text.length>1000||!Number.isInteger(w.start)||w.start < -18000 || w.start>18000||!Number.isInteger(w.len)||w.len<1||w.len>18000||w.start+w.len>18000||(i>0&&w.start<words[i-1].start+words[i-1].len)) || normal(words.map(w=>w.text).join(' '))!==normal(clip.text))return helperEnglish('word_text_or_timing_does_not_match_this');
    return null;
}
export function distributeWords(clip) {
    const parts=clip.text.trim().split(/\s+/);
    if(parts.length>100||parts.length>clip.len)return {error:'Give each word at least one frame; use a longer caption or fewer words.'};
    return {words:parts.map((text,i)=>({text,start:Math.floor(i*clip.len/parts.length),len:Math.floor((i+1)*clip.len/parts.length)-Math.floor(i*clip.len/parts.length)})),wordsEstimated:true};
}
export const slicedWords=(clip,from)=>clip.words?{words:clip.words.map(w=>({...w,start:w.start-from}))}:{};
export function timestampSeconds(value) {
    const m=/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(value);
    return !m||Number(m[2])>=60||Number(m[3])>=60?NaN:Number(m[1]||0)*3600+Number(m[2])*60+Number(m[3])+Number(`0.${m[4]||0}`);
}
/** WebVTT / enhanced LRC timestamps mark the start of the following timed word or segment. */
export function inlineWordTiming(text,from,to,clean) {
    const re=/<((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)>/g,matches=[...text.matchAll(re)];
    if(!matches.length)return {};
    const segments=[],prefix=clean(text.slice(0,matches[0].index));
    if(prefix)segments.push({text:prefix,from,to:timestampSeconds(matches[0][1])});
    matches.forEach((m,i)=>{const words=clean(text.slice(m.index+m[0].length,matches[i+1]?.index??text.length));if(words)segments.push({text:words,from:timestampSeconds(m[1]),to:matches[i+1]?timestampSeconds(matches[i+1][1]):to});});
    return {words:segments.map(s=>({text:s.text,start:Math.round((s.from-from)*30),len:Math.round(s.to*30)-Math.round(s.from*30)})),wordsEstimated:false};
}
/** A bounded local import contract: {words:[{word,start,end}]} with seconds on the source timeline. */
export function parseWordJson(input) {
    let value;try{value=JSON.parse(input);}catch{return {error:'Word timing JSON is invalid.'};}
    const words=value?.words;
    if(!Array.isArray(words)||!words.length||words.length>3000)return {error:'Word timing JSON needs 1–3000 word/start/end entries.'};
    let previous=0;const list=[];
    for(const w of words){if(!w||typeof w.word!=='string'||!w.word.trim()||w.word.length>100||!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.start<0||w.end>600||w.end<=w.start)return {error:'A word text or timing is invalid.'};const start=Math.round(w.start*30),end=Math.round(w.end*30);if(start<previous||end<=start)return {error:'Word timings must be ordered, non-overlapping and at least one frame long.'};previous=end;list.push({text:normal(w.word),start,len:end-start});}
    const groups=[];
    for(const w of list){let last=groups.at(-1);if(!last||last.length>=12||w.start+w.len-last[0].start>180||w.start-(last.at(-1).start+last.at(-1).len)>18){last=[];groups.push(last);}last.push(w);}
    if(groups.length>150)return {error:'This file needs more than 150 caption cues; split it into shorter parts.'};
    return {cues:groups.map(group=>({caption:true,text:group.map(w=>w.text).join(' '),start:group[0].start,len:group.at(-1).start+group.at(-1).len-group[0].start,words:group.map(w=>({...w,start:w.start-group[0].start})),wordsEstimated:false}))};
}
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function captionPresentation(item,offset) {
    const style={...WORD_STYLE,...item.wordStyle},words=item.words || [],active=words.filter(w=>offset>=w.start&&offset<w.start+w.len);
    if(!words.length||style.mode==='none')return {text:item.text,ranges:[]};
    if(style.mode==='word'){const text=active[0]?.text||'';return {text,ranges:text?[{from:0,to:text.length}]:[]};}
    const eligible=style.mode==='karaoke'?words.filter(w=>offset>=w.start):active,ranges=[];let cursor=0;
    for(const w of words){const re=new RegExp(w.text.trim().split(/\s+/).map(escape).join('\\s+'),'g');re.lastIndex=cursor;const m=re.exec(item.text);if(m){if(eligible.includes(w))ranges.push({from:m.index,to:m.index+m[0].length});cursor=m.index+m[0].length;}}
    return {text:item.text,ranges};
}
