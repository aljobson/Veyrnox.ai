import test from 'node:test';
import assert from 'node:assert/strict';
import { effectivePostText, parsePostVariants } from '../lib/social/postVariants.js';

test('platform variants accept selected networks and preserve exact copy', () => {
    assert.deepEqual(parsePostVariants({ instagram: 'Instagram copy', twitter: 'X copy' }, ['instagram', 'twitter']), {
        variants: { instagram: 'Instagram copy', twitter: 'X copy' },
    });
    assert.equal(effectivePostText('twitter', 'Fallback', { twitter: 'X copy' }), 'X copy');
    assert.equal(effectivePostText('instagram', 'Fallback', {}), 'Fallback');
});

test('platform variants reject unselected, blank, malformed and over-limit copy', () => {
    for (const value of [[], 'copy', { facebook: 'not selected' }, { instagram: '   ' }, { twitter: 'x'.repeat(281) }]) {
        assert.deepEqual(parsePostVariants(value, ['instagram', 'twitter']), { error: value?.twitter ? 'caption_too_long' : 'invalid_network_text' });
    }
});

test('Bluesky uses grapheme length rather than Unicode code-point length', () => {
    const combined = 'e\u0301'.repeat(300);
    assert.deepEqual(parsePostVariants({ bluesky: combined }, ['bluesky']), { variants: { bluesky: combined } });
    assert.deepEqual(parsePostVariants({ bluesky: `${combined}x` }, ['bluesky']), { error: 'caption_too_long' });
});
