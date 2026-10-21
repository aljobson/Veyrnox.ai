import { nativeMessage, parsePageMessage, PROTOCOL, utf8Bytes, type ProjectDocument } from '../src/lib/editorBridge';
import { editorEnabled } from '../src/lib/editorFlag';
const id = '11111111-1111-1111-1111-111111111111';
const origin = 'https://example.test';
const document: ProjectDocument = { schema_version: 1, project_id: id, brief: '' };
const hello = { type: 'hello', protocol: PROTOCOL, engine: { kind: 'stub', version: '1' }, caps: { secureContext: true, webcodecs: false, offscreenCanvas: false } };
const parse = (m: object, url = `${origin}/app/editor-engine/`) => parsePageMessage(JSON.stringify({ v: 1, ...m }), url, origin, id);

test('flag only accepts the exact string true', () => {
    for (const value of [true, false, undefined, 'TRUE', '1', 'false', ' true']) expect(editorEnabled(value)).toBe(false);
    expect(editorEnabled('true')).toBe(true);
});
test.each([hello, { type: 'ready', projectId: id }, { type: 'changed', projectId: id, document },
    { type: 'flushed', projectId: id, document, nonce: 'nonce' }, { type: 'asset-request', reqId: 'req-1', mediaId: `j-${id}--vocals` },
    { type: 'beat' }, { type: 'error', code: 'load_failed' }])('accepts slice 1 $type', m => expect(parse(m)).toEqual({ v: 1, ...m }));
test.each(['export', 'export-ready', 'open-credits', 'paid-action', 'unknown'])('refuses %s', type => expect(parse({ type })).toBeNull());
test('origin, raw length, JSON, protocol and request ids are gated', () => {
    expect(parse(hello, 'https://evil.test')).toBeNull();
    expect(parse(hello, 'about:blank')).toBeNull();
    expect(parsePageMessage(' '.repeat(65537), origin, origin, id)).toBeNull();
    expect(parsePageMessage('{', origin, origin, id)).toBeNull();
    expect(parse({ ...hello, v: 2 })).toBeNull();
    for (const reqId of ['', 'a'.repeat(41), 'bad\n', {}]) expect(parse({ type: 'asset-request', reqId, mediaId: `j-${id}` })).toBeNull();
    for (const mediaId of ['j-not-uuid', `j-${id}--unknown`, `j-${'-'.repeat(36)}`]) expect(parse({ type: 'asset-request', reqId: 'ok', mediaId })).toBeNull();
});
test('hello can report a different protocol but must be well formed', () => {
    expect(parse({ ...hello, protocol: 2 })?.type).toBe('hello');
    for (const protocol of [0, 100, 1.5, '1']) expect(parse({ ...hello, protocol })).toBeNull();
    expect(parse({ ...hello, engine: { kind: 'stub', version: 'x'.repeat(41) } })).toBeNull();
    expect(parse({ ...hello, caps: { secureContext: true } })).toBeNull();
});
test('document belongs to the route, has only allowed keys and uses UTF-8 bytes', () => {
    const message = (doc: unknown, projectId = id) => parse({ type: 'changed', projectId, document: doc });
    expect(message({ ...document, project_id: 'other' }, 'other')).toBeNull();
    expect(message({ ...document, project_id: 'other' })).toBeNull();
    expect(parse({ type: 'ready', projectId: 'other' })).toBeNull();
    expect(message({ ...document, extra: true })).toBeNull();
    expect(message({ ...document, schema_version: 4 })).toBeNull();
    const large = { ...document, timeline: { text: 'é'.repeat(16000) } };
    large.timeline.text += 'x'.repeat(32769 - utf8Bytes(JSON.stringify(large)));
    expect(JSON.stringify(large).length).toBeLessThan(32768);
    expect(utf8Bytes(JSON.stringify(large))).toBe(32769);
    expect(message(large)).toBeNull();
});
test('native envelopes round-trip', () => expect(JSON.parse(nativeMessage({ type: 'flush', nonce: 'test' }))).toEqual({ v: 1, type: 'flush', nonce: 'test' }));
