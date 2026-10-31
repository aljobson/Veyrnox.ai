import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import ts from 'typescript';
import { yourWinsEnabled } from '../lib/yourWins.js';
import { pluralKey } from '../lib/i18n/translate.mjs';
import { translator } from '../lib/i18n/translate.mjs';
import messages from '../lib/i18n/messages/app/en/wins.mjs';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
const { GET } = await import('../app/api/v1/wins/route.js');
const auth = '11111111-1111-4111-8111-111111111111';
const req = (id = auth) => new Request('https://v.test/api/v1/wins', { headers: id == null ? {} : { 'x-veyrnox-auth-id': id } });
const period = { creations: { total: 12, by_type: { image: 7, video: 3, audio: 1, other: 1 } }, video_seconds: 13, credits_used: 30, posts: 1, views: null };
const milestone = (key, reached_at = null) => ({ key, reached_at, progress: reached_at ? 1 : 0, target: 1 });
const fixture = () => ({ ok: true, week_start: '2026-10-26T00:00:00Z', week: structuredClone(period), all: structuredClone(period), streak: { current: 2, best: 7, last7: [true,true,true,true,true,true,true] }, milestones: ['first_image','first_video','creations_10','creations_50','first_post','first_cinema_upload','streak_7'].map(k => milestone(k)) });
async function setup(fn) {
    const saved = { ...process.env }, fetch = globalThis.fetch, log = console.error;
    let result = fixture(), rate = { ok: true }; const calls = [], logs = [];
    Object.assign(process.env, { YOUR_WINS_ENABLED: 'true', CHECKIN_ENABLED: 'true', CINEMA_ENABLED: 'true', CREATOR_CONTENT_ENABLED: 'true', CREATOR_UPLOADS_ENABLED: 'true', SOCIAL_CINEMA_PROFILES_ENABLED: 'true', SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', ACCOUNT_READ_RATE_LIMIT_ENABLED: 'false' });
    console.error = (...args) => logs.push(args);
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/rpc/')[1]; calls.push({ name, body: JSON.parse(init.body) });
        const value = name === 'consume_account_read_request' ? rate : result;
        if (value instanceof Error) throw value;
        return Response.json(value);
    };
    try { await fn({ calls, logs, result: v => { result = v; }, rate: v => { rate = v; } }); }
    finally { globalThis.fetch = fetch; console.error = log; for (const key of new Set([...Object.keys(process.env), ...Object.keys(saved)])) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } }
}
test('wins only enables on exact true; unauthenticated and disabled reads do no DB work', () => setup(async ({ calls }) => {
    assert.equal(yourWinsEnabled({ YOUR_WINS_ENABLED: 'true' }), true);
    for (const value of [undefined, null, '', 'TRUE', '1', true, 'false']) assert.equal(yourWinsEnabled({ YOUR_WINS_ENABLED: value }), false);
    for (const id of [null, '', 'invalid']) { const r = await GET(req(id)); assert.equal(r.status,401); assert.equal(r.headers.get('Cache-Control'),'no-store'); }
    for (const flag of ['false','TRUE','1','']) { process.env.YOUR_WINS_ENABLED=flag; const r=await GET(req()); assert.equal(r.status,404); assert.deepEqual(await r.json(),{error:'not_found'}); }
    assert.equal(calls.length,0);
}));
test('wins returns 403, configured/rpc failures are 502 with no payload in logs', () => setup(async ({ result, logs }) => {
    for (const [value,status,error] of [[{ok:false,code:'ACCOUNT_UNAVAILABLE'},403,'account_unavailable'],[new Error('private'),502,'wins_unavailable'],[{ok:false,code:'private'},502,'wins_unavailable']]) {
        result(value); const r=await GET(req()); assert.equal(r.status,status); assert.deepEqual(await r.json(),{error}); assert.equal(r.headers.get('Cache-Control'),'no-store');
    }
    assert.ok(logs.every(args => JSON.stringify(args) === '["[wins] request failed"]'));
    delete process.env.SUPABASE_SERVICE_ROLE_KEY; assert.equal((await GET(req())).status,502);
}));
test('wins uses the shared account rate bucket and preserves 429 headers', () => setup(async ({ rate, calls }) => {
    process.env.ACCOUNT_READ_RATE_LIMIT_ENABLED='true'; rate({ok:false,code:'RATE_LIMITED',retry_after_seconds:12});
    const r=await GET(req()); assert.equal(r.status,429); assert.equal(r.headers.get('Retry-After'),'12'); assert.equal(r.headers.get('Cache-Control'),'no-store');
    assert.ok(calls.every(c => c.name === 'consume_account_read_request'));
    rate({ok:false,code:'NOT_FOUND'}); assert.equal((await GET(req())).status,403);
}));
test('wins projection recursively removes undocumented keys and respects existing flags', () => setup(async ({ result, calls }) => {
    const value=fixture(); value.secret='no'; value.all.secret='no'; value.all.creations.secret='no'; value.all.creations.by_type.secret='no'; value.streak.secret='no'; value.milestones[0].secret='no';
    value.all.views={total:8,networks:['instagram'],secret:'no'}; result(value);
    const r=await GET(req()); assert.equal(r.status,200); assert.equal(r.headers.get('Cache-Control'),'no-store');
    const body=await r.json(); assert.doesNotMatch(JSON.stringify(body),/secret/); assert.equal(body.milestones.length,7);
    assert.deepEqual(calls[0],{name:'read_your_wins',body:{p_auth_id:auth}});
    process.env.CHECKIN_ENABLED='false'; process.env.CREATOR_UPLOADS_ENABLED='false';
    const hidden=await (await GET(req())).json(); assert.equal('streak' in hidden,false); assert.equal(hidden.milestones.length,5);
    assert.ok(!hidden.milestones.some(m=>['streak_7','first_cinema_upload'].includes(m.key)));
}));
function load(source, stubs) {
    const output=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText;
    const exports={};new Function('require','exports',output)(name=>{assert.ok(name in stubs,name);return stubs[name];},exports);return exports;
}
const helpers=load('app/veyrnox/_lib/yourWins.js',{react:React,'../../lib/authClient.js':{},'./gateway.js':{}});
test('web first read seeds all reached, then chooses newest unseen and first locked in server order',()=>{
    const items=[milestone('first_image','2026-10-26'),milestone('creations_10','2026-10-28'),milestone('creations_50')];
    assert.equal(helpers.seenDiff(items,null).newest,null); assert.deepEqual(helpers.seenDiff(items,null).seen,['first_image','creations_10']);
    assert.equal(helpers.seenDiff(items,[]).newest.key,'creations_10'); assert.equal(helpers.nextMilestone({milestones:items}).key,'creations_50');
    assert.equal(helpers.nextMilestone({milestones:[]}),null);
});
test('web seen key is a SHA-256 hash and contains no auth id',async()=>{
    const key=await helpers.seenStorageKey(auth);assert.match(key,/^veyrnox\.wins\.v1\.[0-9a-f]{64}$/);assert.ok(!key.includes(auth));
});
test('real web card hides unavailable data and omits all streak content when absent',()=>{
    let data=null;
    const Card=load('app/veyrnox/_components/YourWinsCard.jsx',{
        react:React,'react/jsx-runtime':jsx,'next/link':{__esModule:true,default:({children,...props})=>createElement('a',props,children)},
        '../../../lib/i18n/translate.mjs':{pluralKey},
        '../../../components/I18nProvider':{useI18n:()=>({t:translator('en',messages),locale:'en'})},
        '../_lib/yourWins':{useYourWins:()=>({data,owner:auth}),nextMilestone:helpers.nextMilestone},
        './VeyCardPeek':{VeyCardPeek:()=>null},'./YourWinsCelebration':{YourWinsCelebration:()=>null},
    }).YourWinsCard;
    assert.equal(renderToStaticMarkup(createElement(Card)),'');data=fixture();delete data.streak;data.milestones=data.milestones.filter(m=>m.key!=='streak_7');
    const html=renderToStaticMarkup(createElement(Card));assert.match(html,/Your wins/);assert.match(html,/Posts published/);assert.match(html,/aria-label="Your wins\. Creations: 12\. Posts published: 1\. Next: First image · 0 of 1"/);assert.doesNotMatch(html,/streak|check-in/i);
});

test('web does not acknowledge a reserved celebration until displayed; canceled navigation can retry',async()=>{
    const storage=globalThis.localStorage;
    const saved=new Map();globalThis.localStorage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
    const client=load('app/veyrnox/_lib/yourWins.js',{react:React,'../../lib/authClient.js':{getStoredUserId:()=>auth},'./gateway.js':{}});
    try {
        const key=await client.seenStorageKey(auth);
        assert.equal(await client.claimWinsCelebration(auth,[]),null);
        const items=[milestone('first_image','2026-10-26'),milestone('creations_10','2026-10-28')];
        const abandoned=await client.claimWinsCelebration(auth,items);
        assert.equal(abandoned.milestone.key,'creations_10');assert.deepEqual(JSON.parse(saved.get(key)),[]);
        assert.equal(await client.claimWinsCelebration(auth,items),null,'only one reservation at a time');
        abandoned.onCancel();
        const shown=await client.claimWinsCelebration(auth,items);assert.equal(shown.milestone.key,'creations_10');
        shown.onShown();assert.deepEqual(JSON.parse(saved.get(key)),['first_image','creations_10']);
        assert.equal(await client.claimWinsCelebration(auth,[...items,milestone('first_post','2026-10-29')]),null,'one displayed per page load');
        assert.ok(!JSON.parse(saved.get(key)).includes('first_post'),'later milestones are not acknowledged without display');
    }finally { if(storage===undefined)delete globalThis.localStorage;else globalThis.localStorage=storage; }
});
test('web caches per-account successes and refusals for five minutes and checks celebrations only on fetch',async()=>{
    let owner=auth,now=1000,calls=0,fails=false;const original=Date.now;Date.now=()=>now;
    const client=load('app/veyrnox/_lib/yourWins.js',{react:React,'../../lib/authClient.js':{getStoredUserId:()=>owner},'./gateway.js':{gatewayFetch:async()=>{calls++;if(fails)throw Error('offline');return fixture();}}});
    let checked=0;const check=()=>checked++;
    try{
        await Promise.all([client.fetchYourWins(owner,check),client.fetchYourWins(owner)]);assert.equal(calls,1);assert.equal(checked,1);
        now+=299999;await client.fetchYourWins(owner,check);assert.equal(calls,1);assert.equal(checked,1);
        now++;fails=true;assert.equal(await client.fetchYourWins(owner,check),null);assert.equal(calls,2);assert.equal(checked,2);
        await client.fetchYourWins(owner,check);assert.equal(calls,2);
        owner='second-account';fails=false;assert.ok(await client.fetchYourWins(owner,check));assert.equal(calls,3);
    }finally{Date.now=original;}
});

test('web page distinguishes initial loading from an unavailable response',()=>{
    let loading=true;
    const Page=load('app/veyrnox/app/account/wins/page.js',{
        react:React,'react/jsx-runtime':jsx,
        '../../../../../components/I18nProvider':{useI18n:()=>({t:translator('en',messages),locale:'en'})},
        '../../../../../lib/i18n/translate.mjs':{pluralKey},
        '../../../_components/NavBar':{AppNav:()=>null},
        '../../../_components/Main':{Main:({children})=>createElement('main',null,children)},
        '../../../_components/YourWinsCelebration':{YourWinsCelebration:()=>null},
        '../../../_lib/yourWins':{useYourWins:()=>({owner:auth,data:null,loading})},
    }).default;
    assert.match(renderToStaticMarkup(createElement(Page)),/Loading…/);
    assert.doesNotMatch(renderToStaticMarkup(createElement(Page)),/Not available yet/);
    loading=false;assert.match(renderToStaticMarkup(createElement(Page)),/Not available yet/);
});

test('real web wins hook reports loading during server rendering and the initial hydration snapshot',()=>{
    const client=load('app/veyrnox/_lib/yourWins.js',{react:React,'../../lib/authClient.js':{getStoredUserId:()=>auth,onSessionChange:()=>()=>{}},'./gateway.js':{}});
    function Probe(){ const {owner,loading}=client.useYourWins();return createElement('output',null,JSON.stringify({owner,loading})); }
    const html=renderToString(createElement(Probe));
    assert.match(html,/&quot;owner&quot;:&quot;&quot;/);
    assert.match(html,/&quot;loading&quot;:true/);
});
test('web check-in visibility notifies a waiting wins candidate on close without acknowledging it early',async()=>{
    const original={document:globalThis.document,MutationObserver:globalThis.MutationObserver,localStorage:globalThis.localStorage};
    let open=true,changed,disconnected=false;const saved=new Map();
    globalThis.document={body:{},querySelector:selector=>{assert.equal(selector,'dialog[aria-labelledby="checkin-title"][open]');return open?{}:null;}};
    globalThis.MutationObserver=class {constructor(callback){changed=callback;}observe(){}disconnect(){disconnected=true;}};
    globalThis.localStorage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
    const client=load('app/veyrnox/_lib/yourWins.js',{react:React,'../../lib/authClient.js':{getStoredUserId:()=>auth},'./gateway.js':{}});
    let stop;
    try {
        const key=await client.seenStorageKey(auth);saved.set(key,'[]');
        const candidate=await client.claimWinsCelebration(auth,[milestone('creations_10','2026-10-28')]);
        // Exercise the real celebration component with its pending event already reserved.
        const Celebration=load('app/veyrnox/_components/YourWinsCelebration.jsx',{
            react:{...React,useState:()=>[{owner:auth,...candidate},()=>{}],useEffect:()=>{},useRef:()=>({current:null})},
            'react/jsx-runtime':jsx,'motion/react':{useReducedMotion:()=>true},
            'next/link':{__esModule:true,default:({children,...props})=>createElement('a',props,children)},
            '../../../components/I18nProvider':{useI18n:()=>({t:translator('en',messages)})},
            '../_lib/yourWins':{claimWinsCelebration:client.claimWinsCelebration,useCheckinDialogOpen:()=>client.checkinDialogOpen()},
            './Modal':{Modal:({children})=>createElement('dialog',null,children)},
            './VeyCharacter':{__esModule:true,default:()=>null},
        }).YourWinsCelebration;
        const render=()=>renderToStaticMarkup(createElement(Celebration,{owner:auth,data:fixture()}));
        let visible=false;const recheck=()=>{visible=render()!=='';};
        stop=client.subscribeCheckinDialog(recheck);recheck();
        assert.equal(visible,false);assert.deepEqual(JSON.parse(saved.get(key)),[]);
        open=false;changed();assert.equal(visible,true);assert.deepEqual(JSON.parse(saved.get(key)),[]);
        candidate.onShown();assert.deepEqual(JSON.parse(saved.get(key)),['creations_10']);
    }finally{stop?.();for(const [key,value] of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
    assert.equal(disconnected,true);
});
