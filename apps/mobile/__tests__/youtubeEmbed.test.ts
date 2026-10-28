// The installed RN Jest setup redefines window, which jsdom's environment forbids.
// Keep the native preset and exercise the constant page script in an isolated DOM.
import { EDITORIAL_SERIES } from '../src/lib/cinemaEditorialData';
import { allowEmbedNavigation, embedErrorKey, embedHtml, embedPlayerConfig, isYoutubeVideoId, parseEmbedMessage, playerSize } from '../src/lib/youtubeEmbed';

const { JSDOM } = require('jsdom');
const dom = new JSDOM('', { runScripts: 'outside-only' });
const window = dom.window;
const document = window.document as Document;
afterAll(() => window.close());
const id = 'hqp141XgyOE';
const config = embedPlayerConfig(id, 504, 'de', 'T')!;
test('video ids, duration and locale are validated', () => {
    expect(isYoutubeVideoId(id)).toBe(true);
    for (const bad of ['', 'short', 'abcdefghijkl', 'abc/def?ghi', '<script>xx', 123, null]) expect(isYoutubeVideoId(bad)).toBe(false);
    expect(embedPlayerConfig('bad', 504, 'de', 'T')).toBeNull();
    for (const duration of [0, 1.5, -1, NaN, Infinity]) expect(embedPlayerConfig(id, duration, 'de', 'T')).toBeNull();
    expect(config).toEqual({ videoId: id, host: 'https://www.youtube-nocookie.com', title: 'T', playerVars: { start: 0, end: 504, playsinline: 1, rel: 0, hl: 'de', origin: 'https://veyrnox.ai' } });
    expect(embedPlayerConfig(id, 504, 'pt-BR', 'T')!.playerVars).not.toHaveProperty('hl');
    for (const series of EDITORIAL_SERIES) for (const episode of series.episodes) expect(isYoutubeVideoId(episode.videoId)).toBe(true);
});
test('HTML escapes config, has two constant scripts and no static iframe', () => {
    const hostile = embedPlayerConfig('abcdefghijk', 12, 'en', '\"><script>&\'')!;
    const html = embedHtml(hostile);
    expect(html).not.toContain('<iframe'); expect(html).not.toContain('\"><script>');
    document.documentElement.innerHTML = html;
    expect(JSON.parse(document.getElementById('w')!.dataset.config!)).toEqual(hostile);
    expect(document.getElementById('w')!.style.visibility).toBe('hidden');
    expect(document.querySelector('#w > #p')).not.toBeNull();
    expect(document.querySelector('meta[name="referrer"]')!.getAttribute('content')).toBe('strict-origin-when-cross-origin');
    const scripts = document.querySelectorAll('script');
    expect(scripts).toHaveLength(2); expect(scripts[1].src).toBe('https://www.youtube.com/iframe_api');
    expect(scripts[0].textContent).toContain('window.onYouTubeIframeAPIReady');
    expect(scripts[0].textContent).toContain("new YT.Player('p'");
    const first = scripts[0].textContent;
    document.documentElement.innerHTML = embedHtml(config);
    expect(document.querySelector('script')!.textContent).toBe(first);
});
test('fake API creates a controlled iframe, reveals only on ready and posts health messages', () => {
    document.documentElement.innerHTML = embedHtml(config);
    const postMessage = jest.fn(); let options: any;
    Object.assign(window, { ReactNativeWebView: { postMessage }, YT: { Player: class {
        frame: HTMLIFrameElement;
        constructor(target: string, value: any) {
            options = value; this.frame = document.createElement('iframe');
            document.getElementById(target)!.replaceWith(this.frame);
        }
        getIframe() { return this.frame; }
    } } });
    window.eval(document.querySelector('script')!.textContent!);
    const wrapper = document.getElementById('w')!;
    expect(wrapper.style.visibility).toBe('hidden'); expect(wrapper.querySelector('iframe')).toBeNull();
    (window as any).onYouTubeIframeAPIReady();
    expect(options).toMatchObject({ videoId: config.videoId, host: config.host, playerVars: config.playerVars, width: '100%', height: '100%' });
    expect(wrapper.querySelector('iframe')!.title).toBe(config.title);
    expect(wrapper.style.visibility).toBe('hidden'); expect(postMessage).not.toHaveBeenCalled();
    options.events.onReady(); expect(wrapper.style.visibility).toBe('visible');
    expect(postMessage).toHaveBeenLastCalledWith('{"type":"ready"}');
    options.events.onError({ data: 150 }); expect(postMessage).toHaveBeenLastCalledWith('{"type":"error","code":150}');
});
test.each([true, false, undefined])('navigation policy is independent of frame flag %s', isTopFrame => {
    for (const url of ['about:blank', 'about:srcdoc', 'https://veyrnox.ai/', `https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1`, 'https://www.youtube-nocookie.com/embed/nested']) {
        expect(allowEmbedNavigation({ url, isTopFrame }, id)).toBe(true);
    }
    for (const url of ['https://www.youtube.com/watch?v='+id, 'https://youtu.be/'+id, 'https://m.youtube.com', 'https://accounts.google.com', 'http://www.youtube-nocookie.com/embed/'+id, 'intent://watch', 'youtube://watch', 'vnd.youtube:'+id, 'javascript:alert(1)', 'https://evil.test/embed/'+id, 'https://www.youtube-nocookie.com.evil.test/embed/'+id, 'https://veyrnox.ai/account', 'bad url']) {
        expect(allowEmbedNavigation({ url, isTopFrame }, id)).toBe(false);
    }
});
test('bridge requires trusted origin and exact short schema', () => {
    for (const source of ['https://veyrnox.ai/', 'https://veyrnox.ai']) expect(parseEmbedMessage('{"type":"ready"}', source)).toEqual({ type: 'ready' });
    for (const code of [2, 5, 100, 101, 150, 153, 999, '150', null]) {
        expect(parseEmbedMessage(JSON.stringify({ type: 'error', code }), 'https://veyrnox.ai/')).toEqual({ type: 'error', code: typeof code === 'number' && code !== 999 ? code : null });
    }
    for (const source of ['https://www.youtube-nocookie.com', 'https://veyrnox.ai.evil.test', 'about:blank', undefined]) expect(parseEmbedMessage('{"type":"ready"}', source)).toBeNull();
    for (const data of ['no JSON', '{"type":"ready","extra":1}', '{"type":"error","code":150,"extra":1}', '{"type":"error"}', ' '.repeat(201), 150, null, 'null', '[]']) expect(parseEmbedMessage(data, 'https://veyrnox.ai/')).toBeNull();
});
test('error copy and minimum dimensions', () => {
    for (const cause of [2, 5, 153, null, 'timeout', 'load'] as const) expect(embedErrorKey(cause)).toBe('cinemaEmbed.error.playback');
    expect(embedErrorKey(100)).toBe('cinemaEmbed.error.unavailable');
    for (const cause of [101, 150]) expect(embedErrorKey(cause)).toBe('cinemaEmbed.error.notEmbeddable');
    expect(playerSize(320)).toEqual({ width: 320, height: 200 });
    expect(playerSize(402)).toEqual({ width: 402, height: 226 });
    expect(playerSize(150)).toEqual({ width: 200, height: 200 });
    for (let width = 100; width <= 1000; width++) {
        expect(playerSize(width).width).toBeGreaterThanOrEqual(200); expect(playerSize(width).height).toBeGreaterThanOrEqual(200);
    }
});
