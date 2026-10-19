import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkPair, lockedVersion, KNOWN_PAIRS } from '../scripts/check-next-adapter-pair.mjs';

test('the outage pair (next 16.4.2 + adapter 1.20.8) is refused with a clear message', () => {
    const [msg] = checkPair('16.4.2', '1.20.8');
    assert.match(msg, /next 16\.4\.2 \(16\.4\.x\).*1\.20\.8.*known: next 16\.3\.x/);
});
test('known pairs pass, any patch of the next line', () => {
    assert.deepEqual(checkPair('16.3.8', '1.20.8'), []);
    assert.deepEqual(checkPair('16.3.0', '1.20.8'), []);
    assert.deepEqual(checkPair('16.4.2', '1.20.12'), []);
});
test('an adapter version missing from the table fails and names the table', () => {
    assert.match(checkPair('16.4.2', '1.20.9')[0], /not in KNOWN_PAIRS/);
});
test('an unknown next line fails', () => {
    assert.equal(checkPair('16.5.0', '1.20.12').length, 1);
});
test('the committed lockfile is a known pair', () => {
    const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
    assert.deepEqual(checkPair(lockedVersion(lock, 'next'), lockedVersion(lock, '@opennextjs/cloudflare')), []);
});
test('table rows are next major.minor strings', () => {
    for (const lines of Object.values(KNOWN_PAIRS)) for (const l of lines) assert.match(l, /^\d+\.\d+$/);
});
