import { allowsVisionNavigation } from '../src/lib/liveEdit/navigation';
const doc = 'file:///data/user/0/ai.veyrnox.app/cache/runtime.html';
test('the hidden views load the document with no fragment, and only that', () => {
    expect(allowsVisionNavigation(doc, doc)).toBe(true);
    expect(allowsVisionNavigation('about:blank', doc)).toBe(true);
    expect(allowsVisionNavigation(`${doc}#live`, doc)).toBe(false); // the camera fragment is never reachable from a hidden view
    expect(allowsVisionNavigation(`${doc}#anything`, doc)).toBe(false);
});
test('the camera view loads the document with exactly #live', () => {
    expect(allowsVisionNavigation(`${doc}#live`, doc, '#live')).toBe(true);
    expect(allowsVisionNavigation(doc, doc, '#live')).toBe(false);
    expect(allowsVisionNavigation(`${doc}#Live`, doc, '#live')).toBe(false);
});
test('every other URL is rejected, including external addresses and other local files', () => {
    for (const url of ['https://example.com/', 'http://localhost/', 'intent://x', 'javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'file://host/data/x/runtime.html', 'ai.veyrnox.app://auth/callback', ''])
        expect(allowsVisionNavigation(url, doc)).toBe(false);
    expect(allowsVisionNavigation(doc, 'https://example.com/runtime.html')).toBe(false); // an asset that is not a local file allows nothing
});
