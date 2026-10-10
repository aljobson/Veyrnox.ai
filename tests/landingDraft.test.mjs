import test from 'node:test';
import assert from 'node:assert/strict';
import { takeLandingDraft, LANDING_DRAFT_KEY } from '../app/veyrnox/_lib/landingDraft.js';

function store(value) {
    const map = new Map(value === undefined ? [] : [[LANDING_DRAFT_KEY, value]]);
    return { getItem: (k) => map.get(k) ?? null, removeItem: (k) => map.delete(k), map };
}
const NOW = 1_000_000;
const draft = (over = {}) => JSON.stringify({ prompt: 'a lantern on a lake', model: 'wan-2.5-kie', at: NOW - 1000, ...over });

test('returns the prompt when the studio opens on the model it was priced for', () => {
    const s = store(draft());
    assert.equal(takeLandingDraft(s, 'wan-2.5-kie', NOW), 'a lantern on a lake');
    assert.equal(s.map.has(LANDING_DRAFT_KEY), false, 'read once, then cleared');
});

test('ignores a draft for a different model, and still clears it', () => {
    const s = store(draft());
    assert.equal(takeLandingDraft(s, 'kling-2.6-pro-kie', NOW), null);
    assert.equal(s.map.has(LANDING_DRAFT_KEY), false);
});

test('ignores a draft when the studio opened without ?model=', () => {
    assert.equal(takeLandingDraft(store(draft()), null, NOW), null);
});

test('ignores a stale draft', () => {
    assert.equal(takeLandingDraft(store(draft({ at: NOW - 11 * 60 * 1000 })), 'wan-2.5-kie', NOW), null);
});

test('survives missing, empty and malformed storage', () => {
    assert.equal(takeLandingDraft(store(), 'wan-2.5-kie', NOW), null);
    assert.equal(takeLandingDraft(store(draft({ prompt: '' })), 'wan-2.5-kie', NOW), null);
    assert.equal(takeLandingDraft(store('{not json'), 'wan-2.5-kie', NOW), null);
    const throwing = { getItem: () => { throw new Error('denied'); }, removeItem() {} };
    assert.equal(takeLandingDraft(throwing, 'wan-2.5-kie', NOW), null);
});

test('a template draft carries its aspect ratio through to the studio', async () => {
    const { takeStudioDraft, writeStudioDraft } = await import('../app/veyrnox/_lib/landingDraft.js');
    const map = new Map();
    const s = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) };
    assert.equal(writeStudioDraft(s, { prompt: 'a portal', model: 'kling-2.6-pro-kie', aspect: '9:16' }, NOW), true);
    assert.deepEqual(takeStudioDraft(s, 'kling-2.6-pro-kie', NOW), { prompt: 'a portal', aspect: '9:16' });
    assert.equal(map.has(LANDING_DRAFT_KEY), false);
    assert.equal(writeStudioDraft({ setItem() { throw new Error('denied'); } }, { prompt: 'x', model: 'y' }), false);
});

test('a Film Studio draft carries its clip length without changing older drafts', async()=>{
    const {takeStudioDraft,writeStudioDraft}=await import('../app/veyrnox/_lib/landingDraft.js');
    const map=new Map();const s={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
    writeStudioDraft(s,{prompt:'a room',model:'wan',durationSeconds:10},NOW);
    assert.deepEqual(takeStudioDraft(s,'wan',NOW),{prompt:'a room',aspect:null,durationSeconds:10});
    writeStudioDraft(s,{prompt:'a room',model:'wan',durationSeconds:500},NOW);
    assert.deepEqual(takeStudioDraft(s,'wan',NOW),{prompt:'a room',aspect:null});
});
