import { buildSessionSeed, seedSecondsLeft, sessionInjection } from './webEditorSession';
import type { SessionSeed } from './webEditorSession';

export { buildSessionSeed, seedSecondsLeft, sessionInjection };

export const HOSTED_EDITOR_PATH = '/app/editor';
export const MIN_EDITOR_TOKEN_SECONDS = 5 * 60;
export const EDITOR_PRIVACY_NOTICE_KEY = 'veyrnox.editorPrivacyNotice.v1';

// The hosted page runs inside an incognito WebView. Record an explicit off preference before its
// JavaScript starts so the website analytics SDK remains opted out and never asks inside the app.
export function nativeEditorSessionInjection(seed: SessionSeed, origin: string, theme: 'light' | 'dark'): string {
    const preference = JSON.stringify({ version: 1, analytics: false, replay: false });
    return `${sessionInjection(seed, origin)}(function(){try{
if(location.origin!==${JSON.stringify(origin)})return;
window.__veyrnoxNativeEditor=1;
localStorage.setItem('veyrnox_analytics_preference_v1',${JSON.stringify(preference)});
localStorage.setItem('veyrnox_theme',${JSON.stringify(theme)});
document.documentElement.setAttribute('data-theme',${JSON.stringify(theme)});
}catch(e){}})();true;`;
}

export function hostedEditorUrl(apiBase: string, projectId: string): string {
    const url = new URL(HOSTED_EDITOR_PATH, apiBase);
    url.searchParams.set('project', projectId);
    return url.toString();
}

// Top-level navigation stays on the editor. Subresources are unaffected by this WebView callback.
export function allowHostedEditorNavigation(url: string, apiBase: string): boolean {
    try {
        const target = new URL(url);
        if (target.protocol === 'about:' || target.protocol === 'blob:') return true;
        const origin = new URL(apiBase).origin;
        return target.origin === origin && target.pathname === HOSTED_EDITOR_PATH;
    } catch {
        return false;
    }
}

export type HostedEditorMessage =
    | { readonly type: 'ready' }
    | { readonly type: 'open-credits' }
    | { readonly type: 'error'; readonly message: string };

export function parseHostedEditorMessage(raw: string): HostedEditorMessage | null {
    if (raw.length > 1_000) return null;
    try {
        const data = JSON.parse(raw) as unknown;
        if (!data || typeof data !== 'object') return null;
        const message = data as Record<string, unknown>;
        if (message.type === 'ready' || message.type === 'open-credits') return { type: message.type };
        if (message.type === 'error' && typeof message.message === 'string') return { type: 'error', message: message.message.slice(0, 160) };
    } catch {
        // An untrusted page message is ignored.
    }
    return null;
}

// Credits are bought with native in-app purchase on mobile. Capture the web control before React opens its
// browser purchase dialog, then hand the user to the native Credits screen instead.
export const HOSTED_EDITOR_INJECTION = `(function(){
if(window.__veyrnoxNativeEditorInstrumentation)return;window.__veyrnoxNativeEditorInstrumentation=1;
window.__veyrnoxNativeEditor=1;
function post(value){try{window.ReactNativeWebView.postMessage(JSON.stringify(value));}catch(e){}}
function installNativeEditorStyle(){
  if(document.getElementById('veyrnox-native-editor-style'))return;
  var style=document.createElement('style');style.id='veyrnox-native-editor-style';
  style.textContent='[data-storage-notice],body>button[data-print="hide"]{display:none!important}';
  (document.head||document.documentElement).appendChild(style);
}
// The incognito editor WebView keeps website analytics opted out. Its consent controls belong to the
// browser surface and otherwise cover the phone timeline, so embedded mode hides them.
installNativeEditorStyle();
function isCreditsControl(node){
  var control=node&&node.closest&&node.closest('button,a');if(!control)return false;
  var href=control.getAttribute&&control.getAttribute('href');
  return (href&&href.indexOf('/app/credits')===0)||String(control.textContent||'').trim().toLowerCase()==='credits';
}
document.addEventListener('click',function(event){
  if(!isCreditsControl(event.target))return;
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();post({type:'open-credits'});
},true);
post({type:'ready'});
window.addEventListener('error',function(event){post({type:'error',message:String(event.message||'error')});});
window.addEventListener('unhandledrejection',function(event){post({type:'error',message:String(event.reason&&event.reason.message||event.reason||'rejection')});});
})();true;`;
