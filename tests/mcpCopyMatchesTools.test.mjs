import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import en from '../lib/i18n/messages/en.mjs';
import { CATALOGS } from '../lib/i18n/translate.mjs';

const registered = file => [...readFileSync(file, 'utf8').matchAll(/registerTool\(\s*'([a-z_]+)'/g)].map(match => match[1]);
const tools = [...registered('lib/veyrnoxMcp.js'), ...registered('lib/veyrnoxPublishMcp.js')];
const WORDS = { 13: 'Thirteen', 14: 'Fourteen', 15: 'Fifteen', 16: 'Sixteen', 17: 'Seventeen' };

test('the /mcp title states the number of tools the connector registers', () => {
  assert.equal(new Set(tools).size, tools.length, 'a tool is registered twice');
  assert.ok(WORDS[tools.length], `add ${tools.length} to WORDS`);
  assert.match(en['mcp.pub.what.title'], new RegExp(`\\b${WORDS[tools.length]} tools\\b`));
});

test('the consent text does not deny what the registered tools can do', () => {
  assert.ok(tools.includes('generate_video') && tools.includes('edit_video'));
  for (const [code, messages] of [['en', en], ...Object.entries(CATALOGS)]) {
    for (const key of ['oauth.restrictions', 'oauth.restrictionsPublish']) {
      assert.match(messages[key], /\S/, `${code} ${key}`);
    }
  }
  for (const key of ['oauth.restrictions', 'oauth.restrictionsPublish']) {
    assert.doesNotMatch(en[key], /video|edit/i, key);
    assert.match(en[key], /audio/, key);
  }
});
