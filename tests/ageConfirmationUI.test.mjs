import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { translator, tOr, pluralKey } from '../lib/i18n/translate.mjs';
import { localeTag } from '../lib/i18n/locales.mjs';
import en from '../lib/i18n/messages/app/en.mjs';
import { MINIMUM_AGE, AGE_CONFIRMATION_VERSION } from '../lib/minimumAge.js';
const require = createRequire(import.meta.url);
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)];
const text = node => typeof node === 'string' ? node : !node || typeof node !== 'object' ? '' : React.Children.toArray(node.props?.children).map(text).join(' ');
function harness(file, extra = '', mocks = {}) {
  let cursor = 0;
  const values = [], effects = [], timers = new Map();
  let timerId = 0, cleanup;
  const hooks = { ...React,
    useState(initial) { const i=cursor++; if (!(i in values)) values[i]=initial; return [values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v;}]; },
    useRef(initial) { const i=cursor++; if (!(i in values)) values[i]={current:initial}; return values[i]; },
    useEffect(fn) { effects.push(fn); },
  };
  const t = translator('en',en);
  const imports = {
    react: hooks,
    '../../../components/I18nProvider': {useI18n:()=>({t,locale:'en'})},
    '../../../lib/i18n/translate.mjs':{tOr,pluralKey},
    '../../../lib/i18n/locales.mjs':{localeTag},
    '../../../lib/minimumAge':{MINIMUM_AGE,AGE_CONFIRMATION_VERSION},
    './Modal':{Modal:()=>null}, './ConfirmDialog':{ConfirmDialog:()=>null}, './DeleteAccountPanel':{DeleteAccountPanel:()=>null},
    ...mocks,
  };
  const js = ts.transpileModule(readFileSync(file,'utf8')+extra,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports','setTimeout','clearTimeout',js)(
    id=>imports[id]??require(id), module, module.exports,
    (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, id => timers.delete(id),
  );
  return {
    component:module.exports, timers,
    render(name,props={}) { cursor=0; return module.exports[name](props); },
    async mount() { cleanup = effects[0](); await new Promise(r=>setImmediate(r)); },
    async retry() {
      const [id, { fn, delay }] = timers.entries().next().value;
      timers.delete(id); await fn(); return delay;
    },
    unmount() { cleanup?.(); },
  };
}
function age(fetcher, signOut=async()=>{}) {
 return harness('app/veyrnox/_components/AgeConfirmationGate.jsx','\nexport { Confirmation };',{
  '../_lib/gateway':{gatewayFetch:fetcher}, '../../lib/authClient':{signOut},
 });
}
const button = (tree,label) => nodes(tree).find(n=>n.type==='button'&&text(n)===label);
test('unconfirmed users start unchecked; Continue records only affirmative version; confirmed content opens',async()=>{
 const calls=[];
 const h=age(async(path,init)=>{calls.push([path,init]);return path==='/account'?{age_confirmation_required:true}:{age_confirmed:true};});
 h.render('Confirmation'); await h.mount();
 let tree=h.render('Confirmation',{children:'application'});
 const checkbox=nodes(tree).find(n=>n.type==='input');
 assert.equal(checkbox.props.checked,false);
 assert.equal(button(tree,'Continue').props.disabled,true);
 assert.equal(button(tree,'Continue').props.className,button(tree,'I’m under 18').props.className);
 checkbox.props.onChange({target:{checked:true}});
 tree=h.render('Confirmation',{children:'application'});
 await button(tree,'Continue').props.onClick();
 assert.deepEqual(JSON.parse(calls[1][1].body),{confirm:true,version:AGE_CONFIRMATION_VERSION});
 assert.equal(h.render('Confirmation',{children:'application'}),'application');
});
test('already confirmed users see content and make no confirmation write',async()=>{
 const calls=[];const h=age(async path=>{calls.push(path);return {age_confirmed:true};});
 h.render('Confirmation');await h.mount();
 assert.equal(h.render('Confirmation',{children:'application'}),'application');assert.deepEqual(calls,['/account']);
});
test('declining stays authenticated; deletion disabled offers email and sign-out only',async()=>{
 let signedOut=0;const calls=[];const h=age(async path=>{calls.push(path);return {age_confirmation_required:true};},async()=>{signedOut++;});
 h.render('Confirmation');await h.mount();
 button(h.render('Confirmation'),'I’m under 18').props.onClick();
 const tree=h.render('Confirmation',{deletionEnabled:false});
 assert.equal(signedOut,0);assert.deepEqual(calls,['/account']);
 assert.ok(!nodes(tree).some(n=>n.type?.name==='DeleteAccountPanel'));
 assert.match(text(tree),/privacy@veyrnox.com/);
 await button(tree,'Sign out').props.onClick();assert.equal(signedOut,1);
});
test('declining with deletion enabled mounts the existing explicit deletion flow inside the gate',async()=>{
 const h=age(async()=>({age_confirmation_required:true}));h.render('Confirmation');await h.mount();
 button(h.render('Confirmation'),'I’m under 18').props.onClick();
 const tree=h.render('Confirmation',{deletionEnabled:true});
 const panel=nodes(tree).find(n=>n.type?.name==='DeleteAccountPanel');
 assert.equal(panel.props.compact,true);assert.equal(panel.props.startLabel,'Delete my account');
 assert.ok(button(tree,'Sign out').props.className.startsWith(panel.props.actionClassName));
});
function deletion(prepareDeletion,confirmDeletion,signOut) {
 return harness('app/veyrnox/_components/DeleteAccountPanel.jsx','',{
  '../../lib/authClient':{signOut},'../_lib/accountDeletion':{prepareDeletion,confirmDeletion,BLOCKER_COPY:{active_subscription:'Cancel your active subscription first.'}},
 });
}
async function prepare(h) { await button(h.render('DeleteAccountPanel'),en['app.account.delete.start']).props.onClick(); }
async function erase(h) {
 let tree=h.render('DeleteAccountPanel');let dialog=nodes(tree).find(n=>n.type?.name==='ConfirmDialog');
 nodes(dialog.props.body).find(n=>n.type==='input').props.onChange({target:{value:'DELETE'}});
 tree=h.render('DeleteAccountPanel');dialog=nodes(tree).find(n=>n.type?.name==='ConfirmDialog');
 dialog.props.onConfirm();await new Promise(r=>setImmediate(r));
}
test('deletion succeeds before sign-out; blocked and incomplete flows keep session and allow retry',async()=>{
 const events=[];globalThis.window={location:{assign:path=>events.push(path)}};
 try {
  const ready=async()=>({state:'ready',token:'token',credits:0});
  const ok=deletion(ready,async()=>{events.push('erased');return {deleted:true};},async()=>events.push('signed-out'));
  await prepare(ok);await erase(ok);assert.deepEqual(events,['erased','signed-out','/']);
  events.length=0;
  const blocked=deletion(async()=>({state:'blocked',blockers:['active_subscription'],credits:0}),async()=>assert.fail(),async()=>assert.fail());
  await prepare(blocked);assert.match(text(blocked.render('DeleteAccountPanel')),/active subscription/i);
  let attempt=0;
  const retry=deletion(ready,async()=>{attempt++;if(attempt===1)throw {code:'deletion_incomplete'};return {deleted:true};},async()=>events.push('signed-out'));
  await prepare(retry);await erase(retry);assert.deepEqual(events,[]);
  assert.ok(nodes(retry.render('DeleteAccountPanel')).some(n=>n.props?.role==='alert'));
  await erase(retry);assert.deepEqual(events,['signed-out','/']);
 } finally { delete globalThis.window; }
});
test('failed confirmation keeps the gate closed and allows retry',async()=>{
 let writes=0;
 const h=age(async path=>{if(path==='/account')return {age_confirmation_required:true};if(++writes===1)throw Error('network');return {age_confirmed:true};});
 h.render('Confirmation');await h.mount();
 nodes(h.render('Confirmation')).find(n=>n.type==='input').props.onChange({target:{checked:true}});
 await button(h.render('Confirmation'),'Continue').props.onClick();
 const failed=h.render('Confirmation',{children:'private app'});
 assert.ok(nodes(failed).some(n=>n.props?.role==='alert'));
 assert.doesNotMatch(text(failed),/private app/);
 await button(h.render('Confirmation'),'Continue').props.onClick();
 assert.equal(h.render('Confirmation',{children:'private app'}),'private app');
});
test('a successful HTTP response without deletion success never signs the person out',async()=>{
 const h=deletion(async()=>({state:'ready',token:'token',credits:0}),async()=>({deleted:false}),async()=>assert.fail('signed out without deletion'));
 await prepare(h);await erase(h);
 assert.ok(nodes(h.render('DeleteAccountPanel')).some(n=>n.props?.role==='alert'));
});
test('unknown status, NOT_FOUND and rate-limited reads fail open with bounded backoff', async () => {
  for (const read of [
    async () => ({ age_confirmed: false }), // /account missing-row fallback, including limiter NOT_FOUND
    async () => ({}), // no confirmation projection available
    async () => { throw { code: 'rate_limited' }; },
    async () => { throw { code: 'NOT_FOUND' }; },
  ]) {
    let reads = 0;
    const h = age(async () => { reads++; return read(); });
    assert.equal(h.render('Confirmation', { children: 'application' }), 'application');
    await h.mount();
    for (const delay of [1000, 2000, 4000]) {
      assert.equal(h.render('Confirmation', { children: 'application' }), 'application');
      assert.equal(await h.retry(), delay);
    }
    assert.equal(h.render('Confirmation', { children: 'application' }), 'application');
    assert.equal(reads, 4);
    assert.equal(h.timers.size, 0);
  }
});
test('a silent retry blocks only after an explicit requirement; unmount cancels retries', async () => {
  let reads = 0;
  const h = age(async () => ++reads === 1 ? {} : { age_confirmation_required: true });
  h.render('Confirmation'); await h.mount();
  assert.equal(h.render('Confirmation', { children: 'application' }), 'application');
  await h.retry();
  assert.equal(nodes(h.render('Confirmation')).find(n => n.type === 'input').props.checked, false);
  assert.equal(h.timers.size, 0);
  const missing = age(async () => ({}));
  missing.render('Confirmation'); await missing.mount();
  assert.equal(missing.timers.size, 1);
  missing.unmount();
  assert.equal(missing.timers.size, 0);
});
test('account_not_found on confirmation fails open and retries reads without a submission loop', async () => {
  let reads = 0, writes = 0;
  const h = age(async path => {
    if (path === '/account') return ++reads === 1 ? { age_confirmation_required: true } : { age_confirmed: false };
    writes++; throw { code: 'account_not_found' };
  });
  h.render('Confirmation'); await h.mount();
  nodes(h.render('Confirmation')).find(n => n.type === 'input').props.onChange({ target: { checked: true } });
  await button(h.render('Confirmation'), 'Continue').props.onClick();
  for (const delay of [1000, 2000, 4000]) {
    assert.equal(h.render('Confirmation', { children: 'application' }), 'application');
    assert.equal(await h.retry(), delay);
  }
  assert.equal(writes, 1);
  assert.equal(reads, 4);
  assert.equal(h.timers.size, 0);
});
