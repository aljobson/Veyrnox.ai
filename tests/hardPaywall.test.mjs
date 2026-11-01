import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hardPaywallEnabled } from '../lib/hardPaywall.js';
import { hardPaywallState, isHardPaywallExempt, isLivePlan } from '../app/veyrnox/_lib/hardPaywall.mjs';

const live = { status: 'active' };
const base = { enabled: true, signedIn: true, generation: null, publish: null, failed: false };

test('the flag is on only for the exact string "true"', () => {
  assert.equal(hardPaywallEnabled({ HARD_PAYWALL_ENABLED: 'true' }), true);
  for (const value of [undefined, '', 'false', 'TRUE', '1', 'true ']) assert.equal(hardPaywallEnabled({ HARD_PAYWALL_ENABLED: value }), false);
});

test('the flag is off in production (omitted, the binding cap is full) and "false" on staging', () => {
  const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const hits = text.match(/^\s*"HARD_PAYWALL_ENABLED":\s*"([^"]*)"/gm) || [];
  assert.equal(hits.length, 1);
  assert.match(hits[0], /"false"$/);
  assert.ok(text.indexOf('"HARD_PAYWALL_ENABLED"') > text.indexOf('"env"'), 'only the staging block sets it');
});

test('flag off or signed out is always open', () => {
  assert.equal(hardPaywallState({ ...base, enabled: false }), 'open');
  assert.equal(hardPaywallState({ ...base, signedIn: false }), 'open');
});

test('no plan locks; a live AI Generation or Publish plan opens', () => {
  assert.equal(hardPaywallState(base), 'locked');
  assert.equal(hardPaywallState({ ...base, generation: live }), 'open');
  assert.equal(hardPaywallState({ ...base, publish: { status: 'past_due' } }), 'open');
});

test('pending, flagged and ended plans do not open the gate', () => {
  for (const status of ['pending', 'flagged', 'ended', 'cancelled']) {
    assert.equal(isLivePlan({ status }), false);
    assert.equal(hardPaywallState({ ...base, generation: { status } }), 'locked');
  }
});

test('a read still loading is checking, a failed read is unknown, a paid plan wins over both', () => {
  assert.equal(hardPaywallState({ ...base, generation: undefined, publish: undefined }), 'checking');
  assert.equal(hardPaywallState({ ...base, generation: null, publish: undefined }), 'checking');
  assert.equal(hardPaywallState({ ...base, generation: undefined, failed: true }), 'unknown');
  assert.equal(hardPaywallState({ ...base, generation: undefined, publish: live, failed: true }), 'open');
});

test('only admin tools are exempt inside the app', () => {
  assert.equal(isHardPaywallExempt('/app/admin'), true);
  assert.equal(isHardPaywallExempt('/app/admin/metrics'), true);
  for (const path of ['/app', '/app/create', '/app/credits', '/app/account', '/app/administrator', null, undefined]) assert.equal(isHardPaywallExempt(path), false);
});

test('the dismissible paywall prompt steps aside while the gate is on', () => {
  const prompt = readFileSync(new URL('../app/veyrnox/_components/PaywallPrompt.js', import.meta.url), 'utf8');
  assert.match(prompt, /useHardPaywallEnabled\(\)/);
  assert.match(prompt, /if \(hardPaywall \|\| !ready/);
});

test('the app template wraps the page and the check-in in the gate', () => {
  const template = readFileSync(new URL('../app/veyrnox/app/template.js', import.meta.url), 'utf8');
  assert.match(template, /<HardPaywallGate enabled=\{hardPaywallEnabled\(\)\}>\{children\}<CheckInHost \/><\/HardPaywallGate>/);
});

test('the gate reads the Publish plan from entitlement, uses the stored identity and keeps only the newest check', () => {
  const gate = readFileSync(new URL('../app/veyrnox/_components/HardPaywallGate.jsx', import.meta.url), 'utf8');
  assert.match(gate, /publish\.value\.entitlement\?\.subscription/);
  assert.match(gate, /getStoredUserId\(\)/);
  assert.match(gate, /seq !== latest\.current/);
});

test('the shared Vey assistant steps aside while the paywall is up', () => {
  const layout = readFileSync(new URL('../app/veyrnox/layout.js', import.meta.url), 'utf8');
  assert.match(layout, /<HideWhileHardPaywall><MascotAssistant \/><\/HideWhileHardPaywall>/);
});
