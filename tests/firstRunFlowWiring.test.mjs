import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FIRST_ROLES, FIRST_DESTINATIONS } from '../app/veyrnox/_lib/firstProfile.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh'];

test('the flow is a modal dialog mounted on the app home, inside the age gate\'s children, and skippable on every screen', async () => {
  const flow = await read('app/veyrnox/_components/FirstRunFlow.js');
  assert.match(flow, /role="dialog"/);
  assert.match(flow, /aria-modal="true"/);
  assert.match(flow, /data-testid="first-run-skip"/);
  assert.match(flow, /Escape/);
  const home = await read('app/veyrnox/app/page.js');
  assert.match(home, /<FirstRunFlow \/>/);
  const template = await read('app/veyrnox/app/template.js');
  assert.ok(template.indexOf('<AgeConfirmationGate') < template.indexOf('{children}'), 'the page, and so the flow, renders inside the age gate');
  assert.ok(!/FirstRunFlow/.test(template), 'the flow is not mounted outside the gate');
});

test('Create reads the answers through one hook and the page stays small', async () => {
  const create = await read('app/veyrnox/app/create/page.js');
  assert.match(create, /useFirstRunCreate\(/);
  assert.ok(!/firstProfile|firstRun/i.test(create.replace(/useFirstRunCreate/g, '')), 'no first-run logic grows the Create page');
});

test('every first-run word has copy in all 11 locales', async () => {
  const keys = [
    'personalise', 'label', 'roleTitle', 'destTitle', 'suggested',
    ...FIRST_ROLES.map((id) => `role.${id}`), ...FIRST_DESTINATIONS.map((id) => `dest.${id}`),
    'example.work.image', 'example.work.video', 'example.work.audio',
  ].map((k) => `app.create.firstRun.${k}`);
  for (const code of LOCALES) {
    const { default: messages } = await import(`../lib/i18n/messages/app/${code}/create.mjs`);
    for (const key of keys) assert.ok(typeof messages[key] === 'string' && messages[key].length > 0, `${code} is missing ${key}`);
  }
});
