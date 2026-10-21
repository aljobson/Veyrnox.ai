import { stubEngineHtml, STUB_ENGINE_VERSION } from '../src/lib/editorStubEngine';
import { PROTOCOL } from '../src/lib/editorBridge';

test('self-contained stub CSP, no network address, protocol from the shared contract', () => {
    const html = stubEngineHtml();
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("media-src 'none'");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain(`var protocol=${PROTOCOL}`);
    expect(html).toContain(STUB_ENGINE_VERSION);
});

test('typing then flush within 100ms returns the latest brief, counts and assets without fetching', () => {
    jest.useFakeTimers();
    const listeners: Record<string, (event: { data?: string }) => void> = {};
    const nodes: Record<string, { value: string; textContent: string; disabled: boolean; addEventListener: jest.Mock; appendChild: jest.Mock }> = {};
    for (const name of ['brief', 'counts', 'assets']) nodes[name] = { value: '', textContent: '', disabled: true, addEventListener: jest.fn((type, fn) => { listeners[type] = fn; }), appendChild: jest.fn() };
    const posts: Record<string, any>[] = [];
    const window = { ReactNativeWebView: { postMessage: (raw: string) => posts.push(JSON.parse(raw)) }, addEventListener: (type: string, fn: typeof listeners[string]) => { listeners[type] = fn; } };
    const document = { getElementById: (id: string) => nodes[id], addEventListener: jest.fn(), createElement: () => ({ textContent: '' }) };
    const script = stubEngineHtml().match(/<script>([\s\S]*)<\/script>/)![1];
    // Execute the shipped stub, using just its DOM surface; no browser dependency.
    new Function('window', 'document', script)(window, document);
    expect(posts[0]).toMatchObject({ v: PROTOCOL, type: 'hello', engine: { kind: 'stub' } });
    const send = (message: object) => listeners.message({ data: JSON.stringify({ v: 1, ...message }) });
    send({ type: 'init', protocol: 1 });
    send({ type: 'load', projectId: 'p', document: { schema_version: 1, project_id: 'p', brief: 'original', timeline: { video: [1, 2] } }, imports: [{ mediaId: 'j-id', kind: 'video' }] });
    expect(nodes.counts.textContent).toBe('video: 2 · audio: 0 · text: 0');
    expect(posts.filter(p => p.type === 'asset-request')).toHaveLength(1);
    nodes.brief.value = 'typed'; listeners.input({}); jest.advanceTimersByTime(100);
    send({ type: 'flush', nonce: 'leave' });
    expect(posts.at(-1)).toMatchObject({ type: 'flushed', nonce: 'leave', document: { brief: 'typed' } });
    jest.advanceTimersByTime(500);
    expect(posts.filter(p => p.type === 'changed')).toHaveLength(0);
    send({ type: 'asset', reqId: 'import-0', url: 'unused' });
    expect(nodes.assets.appendChild.mock.calls[0][0].textContent).toBe('asset ok');
    jest.clearAllTimers(); jest.useRealTimers();
});
