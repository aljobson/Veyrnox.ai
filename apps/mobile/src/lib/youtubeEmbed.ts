import { WEB_ORIGIN } from './cinemaBrowse';

export const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const isYoutubeVideoId = (v: unknown): v is string => typeof v === 'string' && YOUTUBE_VIDEO_ID.test(v);
export const PLAYER_READY_TIMEOUT_MS = 15_000;
export const MIN_PLAYER_SIZE = 200;
export const PAUSE_SCRIPT = 'window.__vp&&window.__vp.pauseVideo&&window.__vp.pauseVideo();true;';
export const EMBED_ERROR_CODES = [2, 5, 100, 101, 150, 153] as const;
export type EmbedErrorCause = number | null | 'timeout' | 'load';

export function embedPlayerConfig(videoId: string, durationSeconds: number, locale: string, frameTitle: string) {
    if (!isYoutubeVideoId(videoId) || !Number.isInteger(durationSeconds) || durationSeconds <= 0) return null;
    return {
        videoId, host: 'https://www.youtube-nocookie.com', title: frameTitle,
        playerVars: { start: 0, end: durationSeconds, playsinline: 1, rel: 0,
            ...(/^[a-z]{2}$/.test(locale) ? { hl: locale } : {}), origin: WEB_ORIGIN },
    };
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
// Constant code: all data crosses the HTML boundary in an escaped attribute.
const PLAYER_SCRIPT = `window.onYouTubeIframeAPIReady = function () {
    var wrapper = document.getElementById('w');
    var config = JSON.parse(wrapper.dataset.config);
    window.__vp = new YT.Player('p', {
        videoId: config.videoId, host: config.host, playerVars: config.playerVars,
        width: '100%', height: '100%',
        events: {
            onReady: function () {
                wrapper.style.visibility = 'visible';
                window.ReactNativeWebView.postMessage(JSON.stringify({type:'ready'}));
            },
            onError: function (e) {
                window.ReactNativeWebView.postMessage(JSON.stringify({type:'error',code:e.data}));
            }
        }
    });
    window.__vp.getIframe().title = config.title;
};`;
export function embedHtml(config: NonNullable<ReturnType<typeof embedPlayerConfig>>) {
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><style>html,body{margin:0;height:100%;background:#000}</style></head><body><div id="w" style="visibility:hidden;width:100%;height:100%" data-config="${escapeHtml(JSON.stringify(config))}"><div id="p"></div></div><script>${PLAYER_SCRIPT}</script><script src="https://www.youtube.com/iframe_api"></script></body></html>`;
}
export function allowEmbedNavigation(req: { url: string; isTopFrame?: boolean }, _videoId: string): boolean {
    if (['about:blank', 'about:srcdoc', `${WEB_ORIGIN}/`].includes(req.url)) return true;
    try {
        const url = new URL(req.url);
        return url.origin === 'https://www.youtube-nocookie.com' && url.pathname.startsWith('/embed/');
    } catch { return false; }
}
export function parseEmbedMessage(data: unknown, sourceUrl: unknown): { type: 'ready' } | { type: 'error'; code: number | null } | null {
    try {
        if (typeof sourceUrl !== 'string' || new URL(sourceUrl).origin !== WEB_ORIGIN || typeof data !== 'string' || data.length > 200) return null;
        const value = JSON.parse(data);
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const keys = Object.keys(value);
        if (value.type === 'ready' && keys.length === 1) return { type: 'ready' };
        if (value.type === 'error' && keys.length === 2 && keys.includes('code')) {
            return { type: 'error', code: EMBED_ERROR_CODES.includes(value.code) ? value.code : null };
        }
    } catch { /* Untrusted bridge input is ignored. */ }
    return null;
}
export function embedErrorKey(cause: EmbedErrorCause) {
    if (cause === 100) return 'cinemaEmbed.error.unavailable';
    if (cause === 101 || cause === 150) return 'cinemaEmbed.error.notEmbeddable';
    return 'cinemaEmbed.error.playback';
}
export function playerSize(availableWidth: number) {
    const width = Math.max(MIN_PLAYER_SIZE, Math.floor(availableWidth));
    return { width, height: Math.max(MIN_PLAYER_SIZE, Math.round(width * 9 / 16)) };
}
