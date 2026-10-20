// Spike S1 (docs/mobile/spikes/S1-editor-export.md): can the web editor run inside a web view on a real
// iPhone? Everything here is pure so jest can pin it; the screen in src/components/dev/EditorSpikeHarness.tsx
// only wires it to a WebView. Dev-only: nothing outside the hidden route imports this file.

// Build with EXPO_PUBLIC_DEV_S1_EDITOR_SPIKE=1 to turn the harness on. Off in every normal build.
export const S1_FLAG = 'EXPO_PUBLIC_DEV_S1_EDITOR_SPIKE';

export function spikeEnabled(value: string | undefined): boolean {
    return value === '1';
}

// The pass line from PARITY-2026-10-19.md section 7 (S1) and the owner's brief.
export const S1_MAX_REALTIME_RATIO = 3;
export const S1_MIN_TIMELINE_SECONDS = 60;
// The page beats once a second; this long without a beat while the app is in front is a frozen page.
export const FROZEN_AFTER_MS = 8_000;

export const EDITOR_PATH = '/app/editor';

export function editorUrl(apiBase: string): string {
    return `${apiBase.replace(/\/+$/, '')}${EDITOR_PATH}`;
}

// The web view may only stay on the editor's own origin: the token is injected into whatever page loads.
export function allowSpikeNavigation(url: string, apiBase: string): boolean {
    try {
        const target = new URL(url);
        if (target.protocol === 'blob:' || target.protocol === 'about:') return true;
        return target.origin === new URL(apiBase).origin;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------------------------------------
// Session handoff. The web client treats a stored record with an access token and no refresh token as
// a live session until it expires (app/lib/authClient.js, getFreshAccessToken). So the harness hands in the
// access token only: the refresh token never leaves the app, and Supabase's rotation cannot sign the app out.
// The token goes in through injected script, never in a URL.
// ---------------------------------------------------------------------------------------------------------

const WEB_SESSION_KEY = 'veyrnox_supabase_session';
const WEB_SIGNED_OUT_KEY = 'veyrnox_session_signed_out';

export interface SessionSeed {
    readonly access_token: string;
    readonly refresh_token: null;
    readonly token_type: 'bearer';
    // Epoch seconds, as the web client compares it.
    readonly expires_at: number;
    readonly user: { readonly id: string; readonly email?: string };
}

function decodeBase64Url(part: string): string | null {
    try {
        const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
        const binary = atob(padded);
        // The payload is UTF-8; atob gives one char per byte.
        return decodeURIComponent(Array.from(binary, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
    } catch {
        return null;
    }
}

export function jwtClaims(token: string): { sub?: string; email?: string; exp?: number } | null {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = decodeBase64Url(part);
    if (!json) return null;
    try {
        const claims = JSON.parse(json) as unknown;
        if (!claims || typeof claims !== 'object') return null;
        const record = claims as Record<string, unknown>;
        return {
            sub: typeof record.sub === 'string' ? record.sub : undefined,
            email: typeof record.email === 'string' ? record.email : undefined,
            exp: typeof record.exp === 'number' && Number.isFinite(record.exp) ? record.exp : undefined,
        };
    } catch {
        return null;
    }
}

// Expiry comes from the token's own exp claim (seconds), so the caller passes the token and nothing else.
export function buildSessionSeed(accessToken: string): SessionSeed | null {
    const claims = jwtClaims(accessToken);
    if (!claims?.sub || claims.exp === undefined) return null;
    return {
        access_token: accessToken,
        refresh_token: null,
        token_type: 'bearer',
        expires_at: Math.floor(claims.exp),
        user: claims.email ? { id: claims.sub, email: claims.email } : { id: claims.sub },
    };
}

// Seconds the seed has left; the harness refuses to start under this so an export cannot outlive its token.
export function seedSecondsLeft(seed: SessionSeed, nowMs: number): number {
    return Math.floor(seed.expires_at - nowMs / 1000);
}

// JSON.stringify output is valid JS, but U+2028/2029 end a line in older engines; escape them and "<".
function jsLiteral(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

// Runs before the page's own scripts, main frame only. Writes the record only on the editor's own origin.
export function sessionInjection(seed: SessionSeed, origin: string): string {
    return `(function(){try{
if(location.origin!==${jsLiteral(origin)})return;
localStorage.removeItem(${jsLiteral(WEB_SIGNED_OUT_KEY)});
localStorage.setItem(${jsLiteral(WEB_SESSION_KEY)},JSON.stringify(${jsLiteral(seed)}));
}catch(e){}})();true;`;
}

// ---------------------------------------------------------------------------------------------------------
// Page to app messages. The instrumentation below posts these as JSON strings.
// ---------------------------------------------------------------------------------------------------------

export type PageMessage =
    | { readonly type: 'ready'; readonly href: string; readonly webcodecs: boolean; readonly offscreenCanvas: boolean }
    | { readonly type: 'beat'; readonly heapMb: number | null }
    | { readonly type: 'files'; readonly count: number; readonly bytes: number; readonly kinds: readonly string[] }
    | { readonly type: 'export-start' }
    | { readonly type: 'progress'; readonly value: number }
    | { readonly type: 'export-end' }
    | { readonly type: 'output'; readonly bytes: number; readonly mime: string }
    | { readonly type: 'error'; readonly message: string };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parsePageMessage(raw: string): PageMessage | null {
    if (raw.length > 4_000) return null;
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!data || typeof data !== 'object') return null;
    const m = data as Record<string, unknown>;
    switch (m.type) {
        case 'ready':
            if (typeof m.href !== 'string') return null;
            return { type: 'ready', href: m.href, webcodecs: m.webcodecs === true, offscreenCanvas: m.offscreenCanvas === true };
        case 'beat':
            return { type: 'beat', heapMb: num(m.heapMb) };
        case 'files': {
            const count = num(m.count);
            const bytes = num(m.bytes);
            if (count === null || bytes === null || !Array.isArray(m.kinds)) return null;
            return { type: 'files', count, bytes, kinds: m.kinds.filter((k): k is string => typeof k === 'string').slice(0, 20) };
        }
        case 'export-start':
            return { type: 'export-start' };
        case 'export-end':
            return { type: 'export-end' };
        case 'progress': {
            const value = num(m.value);
            return value === null ? null : { type: 'progress', value: Math.min(1, Math.max(0, value)) };
        }
        case 'output': {
            const bytes = num(m.bytes);
            return bytes === null || typeof m.mime !== 'string' ? null : { type: 'output', bytes, mime: m.mime.slice(0, 40) };
        }
        case 'error':
            return typeof m.message === 'string' ? { type: 'error', message: m.message.slice(0, 200) } : null;
        default:
            return null;
    }
}

// Injected after load. It reads the page and reports; it clicks nothing and changes nothing. File names are never sent.
export const INSTRUMENTATION = `(function(){
if(window.__s1)return;window.__s1=1;
function post(o){try{window.ReactNativeWebView.postMessage(JSON.stringify(o));}catch(e){}}
post({type:'ready',href:location.pathname,webcodecs:typeof VideoEncoder!=='undefined'&&typeof VideoDecoder!=='undefined',offscreenCanvas:typeof OffscreenCanvas!=='undefined'});
setInterval(function(){var m=performance&&performance.memory;post({type:'beat',heapMb:m?Math.round(m.usedJSHeapSize/1048576):null});},1000);
document.addEventListener('change',function(e){var t=e.target;if(!t||t.tagName!=='INPUT'||t.type!=='file'||!t.files)return;
var n=0,b=0,k=[];for(var i=0;i<t.files.length;i++){n++;b+=t.files[i].size;k.push((t.files[i].type||'unknown').slice(0,30));}post({type:'files',count:n,bytes:b,kinds:k});},true);
var make=URL.createObjectURL;URL.createObjectURL=function(o){try{if(o&&o.type&&o.type.indexOf('video/')===0&&o.size>0)post({type:'output',bytes:o.size,mime:o.type});}catch(e){}return make.apply(this,arguments);};
var running=false;
function scan(){var p=document.querySelector('progress');
if(p&&!running){running=true;post({type:'export-start'});}
else if(!p&&running){running=false;post({type:'export-end'});}
if(p&&typeof p.value==='number'&&p.max)post({type:'progress',value:p.value/p.max});}
new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['value']});
setInterval(scan,1000);
window.addEventListener('error',function(e){post({type:'error',message:String(e.message||'error')});});
window.addEventListener('unhandledrejection',function(e){post({type:'error',message:String(e.reason&&e.reason.message||e.reason||'rejection')});});
})();true;`;

// ---------------------------------------------------------------------------------------------------------
// Event log and the report.
// ---------------------------------------------------------------------------------------------------------

export type LogKind =
    | 'page'
    | 'files'
    | 'export-start'
    | 'export-end'
    | 'output'
    | 'error'
    | 'terminated'
    | 'background'
    | 'foreground'
    | 'frozen'
    | 'note';

export interface LogEvent {
    // Epoch milliseconds.
    readonly at: number;
    readonly kind: LogKind;
    readonly detail?: string;
}

export function appendEvent(log: readonly LogEvent[], event: LogEvent, max = 400): readonly LogEvent[] {
    const next = [...log, event];
    return next.length > max ? next.slice(next.length - max) : next;
}

export function describeMessage(message: PageMessage): { kind: LogKind; detail?: string } | null {
    switch (message.type) {
        case 'ready':
            return { kind: 'page', detail: `${message.href} webcodecs=${message.webcodecs} offscreen=${message.offscreenCanvas}` };
        case 'files':
            return { kind: 'files', detail: `${message.count} file(s), ${(message.bytes / 1048576).toFixed(1)} MB, ${message.kinds.join(',')}` };
        case 'export-start':
            return { kind: 'export-start' };
        case 'export-end':
            return { kind: 'export-end' };
        case 'output':
            return { kind: 'output', detail: `${(message.bytes / 1048576).toFixed(1)} MB ${message.mime}` };
        case 'error':
            return { kind: 'error', detail: message.message };
        default:
            return null;
    }
}

export interface Tracker {
    readonly lastBeatAt: number | null;
    readonly peakHeapMb: number | null;
    readonly frozenSince: number | null;
}

export const emptyTracker: Tracker = { lastBeatAt: null, peakHeapMb: null, frozenSince: null };

export function trackMessage(tracker: Tracker, message: PageMessage, now: number): Tracker {
    if (message.type !== 'beat') return tracker;
    const peak = message.heapMb === null ? tracker.peakHeapMb : Math.max(tracker.peakHeapMb ?? 0, message.heapMb);
    return { lastBeatAt: now, peakHeapMb: peak, frozenSince: null };
}

// Call on a timer while the app is in front. Returns the tracker with frozenSince set once, plus whether it just froze.
export function checkFrozen(tracker: Tracker, now: number): { tracker: Tracker; justFroze: boolean } {
    if (tracker.lastBeatAt === null || tracker.frozenSince !== null) return { tracker, justFroze: false };
    if (now - tracker.lastBeatAt < FROZEN_AFTER_MS) return { tracker, justFroze: false };
    return { tracker: { ...tracker, frozenSince: now }, justFroze: true };
}

export interface ExportRun {
    readonly startedAt: number;
    readonly endedAt: number | null;
    readonly outputBytes: number | null;
    // True when the app went to the background between start and end.
    readonly backgrounded: boolean;
    readonly terminatedDuring: boolean;
}

// Pair the log into export runs. A run ends at the first export-end after it starts; an output between them
// is attached. A run with no end is still open (or was killed).
export function exportRuns(log: readonly LogEvent[]): readonly ExportRun[] {
    const runs: ExportRun[] = [];
    // A holder, not a bare variable: the close helper below assigns it and TypeScript does not track that.
    const state: { open: Omit<ExportRun, 'endedAt'> | null } = { open: null };
    const close = (endedAt: number | null) => {
        if (state.open) runs.push({ ...state.open, endedAt });
        state.open = null;
    };
    for (const event of log) {
        if (event.kind === 'export-start') {
            close(null);
            state.open = { startedAt: event.at, outputBytes: null, backgrounded: false, terminatedDuring: false };
            continue;
        }
        const open = state.open;
        if (!open) continue;
        if (event.kind === 'output') {
            const mb = Number.parseFloat(event.detail ?? '');
            state.open = { ...open, outputBytes: Number.isFinite(mb) ? Math.round(mb * 1048576) : open.outputBytes };
        } else if (event.kind === 'background') {
            state.open = { ...open, backgrounded: true };
        } else if (event.kind === 'terminated') {
            state.open = { ...open, terminatedDuring: true };
        } else if (event.kind === 'export-end') {
            close(event.at);
        }
    }
    close(null);
    return runs;
}

export interface Verdict {
    readonly ratio: number | null;
    readonly ratioPass: boolean | null;
    readonly killCount: number;
    readonly killPass: boolean;
    readonly timelinePass: boolean;
    readonly finished: boolean;
    readonly pass: boolean;
}

// timelineSeconds is what the owner typed: the web editor does not expose it. The ratio uses the last
// finished run. Pass needs: finished, ratio <= 3, no kill anywhere in the session, timeline >= 60 s.
export function judge(log: readonly LogEvent[], timelineSeconds: number): Verdict {
    const runs = exportRuns(log);
    const finishedRuns = runs.filter((r) => r.endedAt !== null && r.outputBytes !== null);
    const last = finishedRuns[finishedRuns.length - 1];
    const killCount = log.filter((e) => e.kind === 'terminated').length;
    const timelinePass = timelineSeconds >= S1_MIN_TIMELINE_SECONDS;
    const ratio = last && timelineSeconds > 0 ? (last.endedAt! - last.startedAt) / 1000 / timelineSeconds : null;
    const ratioPass = ratio === null ? null : ratio <= S1_MAX_REALTIME_RATIO;
    const killPass = killCount === 0;
    return {
        ratio,
        ratioPass,
        killCount,
        killPass,
        timelinePass,
        finished: Boolean(last),
        pass: ratioPass === true && killPass && timelinePass,
    };
}

const fmtTime = (ms: number): string => new Date(ms).toISOString().slice(11, 23);

// Plain text the owner shares from the screen (Share sheet) and pastes back. No tokens, no file names.
export function buildReport(args: {
    readonly log: readonly LogEvent[];
    readonly timelineSeconds: number;
    readonly device: string;
    readonly appEnv: string;
    readonly peakHeapMb: number | null;
    readonly now: number;
}): string {
    const verdict = judge(args.log, args.timelineSeconds);
    const runs = exportRuns(args.log);
    const lines = [
        'S1 editor export report',
        `device: ${args.device}`,
        `environment: ${args.appEnv}`,
        `timeline seconds (typed): ${args.timelineSeconds}`,
        `exports: ${runs.length}`,
    ];
    runs.forEach((run, i) => {
        const wall = run.endedAt === null ? null : (run.endedAt - run.startedAt) / 1000;
        const ratio = wall !== null && args.timelineSeconds > 0 ? wall / args.timelineSeconds : null;
        lines.push(
            `  run ${i + 1}: ${wall === null ? 'did not finish' : `${wall.toFixed(1)} s`}` +
                `${ratio === null ? '' : `, ${ratio.toFixed(2)}x real time`}` +
                `${run.outputBytes === null ? ', no file seen' : `, ${(run.outputBytes / 1048576).toFixed(1)} MB`}` +
                `${run.backgrounded ? ', app backgrounded' : ''}${run.terminatedDuring ? ', web view killed' : ''}`,
        );
    });
    lines.push(
        `web view kills: ${verdict.killCount}`,
        `peak JS heap MB: ${args.peakHeapMb === null ? 'not reported by this web view' : args.peakHeapMb}`,
        `ratio: ${verdict.ratio === null ? 'n/a' : verdict.ratio.toFixed(2)} (pass at ${S1_MAX_REALTIME_RATIO}x or less)`,
        `harness verdict: ${verdict.pass ? 'PASS' : 'FAIL'} on speed, kills and 60 s timeline; frame count, audio sync and thumb trim are by hand`,
        '',
        'events:',
    );
    for (const event of args.log) lines.push(`${fmtTime(event.at)} ${event.kind}${event.detail ? ` ${event.detail}` : ''}`);
    lines.push(`(report made ${fmtTime(args.now)})`);
    return lines.join('\n');
}
