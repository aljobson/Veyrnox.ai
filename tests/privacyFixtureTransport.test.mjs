import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { installInteractiveAnalyticsNavigator } from '../e2e/fixtures/interactive-analytics.mjs';

const require = createRequire(import.meta.url);
const { isLikelyBot } = require('@posthog/browser-common/utils/blocked-uas');

test('isolated interactive analytics navigator reaches the actual SDK capture path without changing production config', async () => {
  const navigator = { userAgent: 'Mozilla/5.0 Chrome/153.0.0.0 Safari/537.36', webdriver: true,
    userAgentData: { brands: [{ brand: 'HeadlessChrome', version: '153' }] } };
  assert.equal(isLikelyBot(navigator), true, 'the pinned SDK suppresses real automated navigators');
  let callback;
  await installInteractiveAnalyticsNavigator({ addInitScript: async script => { callback = script; } }, 'http://127.0.0.1:3100');
  vm.runInNewContext(`(${callback.toString()})()`, { navigator });
  assert.equal(isLikelyBot(navigator), false, 'the isolated interactive fixture must not silently drop every capture');
  assert.equal(navigator.userAgent, 'Mozilla/5.0 Chrome/153.0.0.0 Safari/537.36');
});

test('interactive analytics simulation cannot be installed for production or another non-loopback origin', async () => {
  for (const origin of [undefined, 'https://veyrnox.ai', 'https://localhost:3100', 'http://localhost.evil.test',
    'http://user@localhost:3100', 'http://127.1:3100', 'http://127.0.0.1:3100/path', 'http://127.0.0.1:3100?test=1']) {
    await assert.rejects(installInteractiveAnalyticsNavigator({ addInitScript: async () => assert.fail('No script may be installed') }, origin), /loopback/);
  }
});
