import { resolveI18nSource } from '../scripts/lib/vey-knowledge-i18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const client = readFileSync(new URL('../app/lib/authClient.js', import.meta.url), 'utf8');
const panel = resolveI18nSource(readFileSync(new URL('../app/veyrnox/_components/OAuthGrantsPanel.js', import.meta.url), 'utf8'));
const account = readFileSync(new URL('../app/veyrnox/app/account/page.js', import.meta.url), 'utf8');

test('account security exposes OAuth grant review and revocation', () => {
  assert.match(client, /authed\('\/auth\/v1\/user\/oauth\/grants', \{ method: 'GET' \}\)/);
  assert.match(client, /user\/oauth\/grants\?client_id=/);
  assert.match(client, /method: 'DELETE'/);
  assert.match(panel, /Connected assistants/);
  assert.match(panel, /Revoke access/);
  assert.match(account, /<OAuthGrantsPanel \/>/);
});

test('grant UI only creates outbound links for HTTPS client metadata', () => {
  assert.match(panel, /url\.protocol === 'https:'/);
  assert.match(panel, /rel="noreferrer"/);
});
