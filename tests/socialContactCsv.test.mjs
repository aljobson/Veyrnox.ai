import test from 'node:test';
import assert from 'node:assert/strict';
import { parseContactCsv } from '../lib/social/contactCsv.js';

test('parses quoted contact CSV fields and normalizes tags and consent', () => {
  assert.deepEqual(parseContactCsv('external_id,name,tags,subscription_status,notes\r\nalex,"Alex, Customer","VIP|Lead|vip",subscribed,"Asked ""when?"""\r\n'), [{
    externalId: 'alex', name: 'Alex, Customer', tags: ['vip', 'lead'], subscriptionStatus: 'subscribed', notes: 'Asked "when?"',
  }]);
});

test('defaults missing optional contact fields safely', () => {
  assert.deepEqual(parseContactCsv('name,external_id\nSam,sam-42\n'), [{
    externalId: 'sam-42', name: 'Sam', tags: [], subscriptionStatus: 'unknown', notes: '',
  }]);
});

test('rejects unknown headers, malformed rows, duplicate identities and unclosed quotes', () => {
  for (const csv of ['name,email\nAlex,a@test\n', 'external_id,name\nalex\n',
    'external_id,name\nalex,Alex\nalex,Other\n', 'external_id,name\nalex,"Alex\n']) {
    assert.throws(() => parseContactCsv(csv));
  }
});
