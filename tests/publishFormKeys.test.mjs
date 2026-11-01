import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blocksImplicitSubmit } from '../lib/publishFormKeys.js';

const key = (tagName, type, extra = {}) => ({ key: 'Enter', isComposing: false, target: { tagName, type }, ...extra });

test('Enter in a single-line field is blocked, so it cannot trigger Post now', () => {
  for (const type of ['text', 'datetime-local', 'date', 'email', 'search', 'number', 'password']) {
    assert.equal(blocksImplicitSubmit(key('INPUT', type)), true, type);
  }
});

test('Enter is left alone in a textarea, on a button, a checkbox or a select, and other keys are ignored', () => {
  assert.equal(blocksImplicitSubmit(key('TEXTAREA', 'textarea')), false);
  assert.equal(blocksImplicitSubmit(key('BUTTON', 'submit')), false);
  assert.equal(blocksImplicitSubmit(key('INPUT', 'checkbox')), false);
  assert.equal(blocksImplicitSubmit(key('INPUT', 'radio')), false);
  assert.equal(blocksImplicitSubmit(key('INPUT', 'file')), false);
  assert.equal(blocksImplicitSubmit(key('SELECT', 'select-one')), false);
  assert.equal(blocksImplicitSubmit({ ...key('INPUT', 'text'), key: 'a' }), false);
  assert.equal(blocksImplicitSubmit({ ...key('INPUT', 'text'), isComposing: true }), false);
  assert.equal(blocksImplicitSubmit(null), false);
});

test('the composer form uses the guard and keeps the three explicit submit buttons', () => {
  const source = readFileSync('app/veyrnox/app/publish/Composer.js', 'utf8');
  assert.match(source, /<form onSubmit=\{onSubmit\} onKeyDown=\{\(e\) => \{ if \(blocksImplicitSubmit\(e\)\) e\.preventDefault\(\); \}\}/);
  for (const value of ['now', 'schedule', 'queue']) assert.match(source, new RegExp(`type="submit" value="${value}"`));
});
