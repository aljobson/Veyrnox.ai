import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REFERRAL_KEY, REFERRAL_TTL_MS, rememberReferral, recallReferral, forgetReferral, attachIsFinal } from '../app/veyrnox/_lib/referralCapture.js';

const CODE = '2345679ABC';
const memory = (seed = {}) => {
    const data = { ...seed };
    return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
};
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('rememberReferral keeps a good code, upper-cased, and returns the address without it', () => {
    const store = memory();
    const seen = rememberReferral(store, `?utm_source=x&ref=${CODE.toLowerCase()}&a=1`, 1000);
    assert.deepEqual(seen, { code: CODE, search: 'utm_source=x&a=1' });
    assert.deepEqual(JSON.parse(store.data[REFERRAL_KEY]), { code: CODE, at: 1000 });
});

test('rememberReferral stores nothing for a missing or malformed ref, but still tidies the address', () => {
    for (const bad of ['?ref=', '?ref=short', '?ref=IIIIIIIIII', '?ref=2345679AB1']) {
        const store = memory();
        assert.deepEqual(rememberReferral(store, bad, 1000), { code: null, search: '' }, bad);
        assert.equal(store.getItem(REFERRAL_KEY), null);
    }
    const store = memory();
    assert.equal(rememberReferral(store, '?a=1', 1000), null);
    assert.equal(rememberReferral(store, '', 1000), null);
    assert.equal(store.getItem(REFERRAL_KEY), null);
});

test('rememberReferral survives storage that refuses to write', () => {
    const blocked = { setItem() { throw new Error('blocked'); }, getItem() { return null; }, removeItem() {} };
    assert.deepEqual(rememberReferral(blocked, `?ref=${CODE}`, 1), { code: CODE, search: '' });
});

test('recallReferral returns a fresh code, and removes an expired, future-dated or broken record', () => {
    const at = 1_000_000;
    assert.equal(recallReferral(memory({ [REFERRAL_KEY]: JSON.stringify({ code: CODE, at }) }), at + REFERRAL_TTL_MS), CODE);
    for (const raw of [
        JSON.stringify({ code: CODE, at }), // expired below
        JSON.stringify({ code: 'nope', at }), '{', 'null', '[]', JSON.stringify({ code: CODE }), JSON.stringify({ code: CODE, at: 'x' }),
    ]) {
        const store = memory({ [REFERRAL_KEY]: raw });
        const now = raw.includes('"at":1000000') ? at + REFERRAL_TTL_MS + 1 : at;
        assert.equal(recallReferral(store, now), null, raw);
        assert.equal(store.getItem(REFERRAL_KEY), null, `removed: ${raw}`);
    }
    const future = memory({ [REFERRAL_KEY]: JSON.stringify({ code: CODE, at: at + 10 * REFERRAL_TTL_MS }) });
    assert.equal(recallReferral(future, at), null);
    assert.equal(recallReferral(memory(), at), null);
});

test('forgetReferral removes the record and tolerates blocked storage', () => {
    const store = memory({ [REFERRAL_KEY]: '{}' });
    forgetReferral(store);
    assert.equal(store.getItem(REFERRAL_KEY), null);
    forgetReferral({ removeItem() { throw new Error('blocked'); } });
});

test('attachIsFinal: an answer about the code or account is final; sign-in, limits, outages and an unprovisioned account are retried', () => {
    for (const [status, code] of [[404, 'not_found'], [400, 'invalid_code'], [400, 'self_referral'], [409, 'not_new'], [409, 'already_attached']]) assert.equal(attachIsFinal({ status, code }), true, `${status} ${code}`);
    for (const e of [{ status: 409, code: 'user_not_provisioned' }, { status: 401 }, { status: 429 }, { status: 502 }, { status: 503 }, { status: undefined }, new Error('network'), null]) assert.equal(attachIsFinal(e), false, JSON.stringify(e));
});

test('the disclosure cannot drift from the storage: the notice, the privacy policy, the Terms and the refund policy all say it', () => {
    const chrome = read('../app/veyrnox/_components/SiteChrome.js');
    assert.match(chrome, /<ReferralBridge \/>/);
    assert.match(chrome, /referral code for up to three days/);
    const privacy = read('../app/legal/privacy/page.js');
    assert.match(privacy, /referral link[\s\S]{0,80}local storage for up to three days/);
    assert.match(privacy, /<h2>Referrals<\/h2>/);
    assert.match(read('../app/legal/terms/page.js'), /Referral rewards:[\s\S]{0,200}10% of that pack/);
    assert.match(read('../app/legal/refund/page.js'), /reverses the referral reward/);
    assert.equal(REFERRAL_TTL_MS, 3 * 24 * 60 * 60 * 1000, 'three days, as the copy says');
});

test('the panel promises Credits only, never money, and the account page mounts it', () => {
    const panel = read('../app/veyrnox/_components/ReferralPanel.js');
    assert.match(panel, /Nothing is paid out as money/);
    assert.doesNotMatch(panel, /\bwallet\b|\bfunds\b|withdraw|payout|earnings/i);
    assert.match(read('../app/veyrnox/app/account/page.js'), /<ReferralPanel \/>/);
});

test('the storage notice is re-prompted once when it gains an item: the acknowledgement value is versioned, not the old "ack"', () => {
  const chrome = read('../app/veyrnox/_components/SiteChrome.js');
  assert.match(chrome, /const NOTICE_ACK = 'ack-2026-10-referral'/);
  assert.match(chrome, /getItem\(NOTICE_KEY\) !== NOTICE_ACK/);
  assert.match(chrome, /setItem\(NOTICE_KEY, NOTICE_ACK\)/);
  assert.doesNotMatch(chrome, /!== 'ack'/, 'an old "ack" no longer counts as having seen the referral wording');
});
