import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');

test('inline prompt-help links are visually distinct without requiring hover', () => {
  for (const href of ['/app/chat?skill=prompt-writer', '/app/chat?skill=fix-my-prompt', '/app/chat']) {
    const link = page.split('\n').find((line) => line.includes(`href="${href}"`));
    const classes = link.match(/className="([^"]+)"/)[1].split(' ');
    assert.ok(classes.includes('underline'), href);
  }
});

test('model-kind text uses the readable foreground token on selected cards', () => {
  const label = page.split('\n').find((line) => line.includes('>{m.kind}</span>'));
  assert.match(label, /text-vx-fg-(?:muted|body)/);
  assert.doesNotMatch(label, /text-vx-fg-faint/);
});
