// Turnstile site key: public, the same one the web app ships (next.config.mjs, ADR-0026).
export const TURNSTILE_SITE_KEY = '0x4AAAAAAE-nahDRUDwD5HEx';

const SITE_KEY_RE = /^[0-9A-Za-z_-]{1,64}$/;

// The page the web view renders. It is loaded with the app's web origin as its
// base URL so Turnstile sees an allowed hostname, and reports back only through
// postMessage.
export function turnstileHtml(siteKey: string): string {
    if (!SITE_KEY_RE.test(siteKey)) throw new Error('invalid_site_key');
    return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;background:transparent}body{display:flex;justify-content:center;align-items:center;min-height:70px}</style>
<script>
function post(m){window.ReactNativeWebView.postMessage(JSON.stringify(m))}
function init(){
  post({type:'ready'});
  turnstile.render('#w',{sitekey:'${siteKey}',theme:'dark',
    callback:function(t){post({type:'token',token:t})},
    'error-callback':function(c){post({type:'error',code:String(c)})},
    'unsupported-callback':function(){post({type:'error',code:'unsupported'})},
    'expired-callback':function(){post({type:'expired'})}});
}
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=init" async defer></script>
</head><body><div id="w"></div></body></html>`;
}

export type TurnstileMessage =
    | { readonly type: 'token'; readonly token: string }
    | { readonly type: 'error'; readonly code: string }
    | { readonly type: 'expired' }
    | { readonly type: 'ready' };

export function parseTurnstileMessage(raw: string): TurnstileMessage | null {
    let m: unknown;
    try {
        m = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!m || typeof m !== 'object') return null;
    const o = m as Record<string, unknown>;
    if (o.type === 'token' && typeof o.token === 'string' && o.token.length > 0 && o.token.length < 4096) {
        return { type: 'token', token: o.token };
    }
    if (o.type === 'error' && typeof o.code === 'string') return { type: 'error', code: o.code.slice(0, 40) };
    if (o.type === 'expired') return { type: 'expired' };
    if (o.type === 'ready') return { type: 'ready' };
    return null;
}

// Only Cloudflare's challenge origins, the page's own base URL (the initial load) and a blank page
// may load inside the check.
export function allowTurnstileNavigation(url: string, baseUrl: string): boolean {
    if (url === 'about:blank' || url === baseUrl || url === `${baseUrl}/`) return true;
    try {
        const u = new URL(url);
        return u.protocol === 'https:' && (u.hostname === 'challenges.cloudflare.com' || u.hostname.endsWith('.cloudflare.com'));
    } catch {
        return false;
    }
}
